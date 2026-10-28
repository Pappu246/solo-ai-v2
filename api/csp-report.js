/**
 * Vercel CSP violation-report receiver.
 *
 * The policy is enforced; this endpoint only receives violation reports. Reports are treated as untrusted input and only
 * minimal, path-free metadata is logged. Never log the report body, sample,
 * original policy, full URL, query string, referrer, or user agent.
 */
export const config = { api: { bodyParser: false } };

const MAX_BODY_BYTES = 32 * 1024;
const MAX_REPORTS_PER_REQUEST = 8;
const MAX_LOGS_PER_MINUTE_PER_INSTANCE = 20;
const PRODUCTION_ORIGIN = "https://solo-ai-v2-mu.vercel.app";

let logWindowStartedAt = Date.now();
let logCountInWindow = 0;

function canLogReport() {
  const now = Date.now();
  if (now - logWindowStartedAt >= 60_000) {
    logWindowStartedAt = now;
    logCountInWindow = 0;
  }
  if (logCountInWindow >= MAX_LOGS_PER_MINUTE_PER_INSTANCE) return false;
  logCountInWindow += 1;
  return true;
}

function asRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function shortString(value, limit = 120) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, limit)
    : "";
}

/** Return only an origin/sentinel; paths and query strings may contain user data. */
export function normalizeReportedOrigin(value) {
  const input = shortString(value, 2048);
  if (!input) return undefined;
  if (/^(inline|eval|wasm-eval|self|unknown)$/i.test(input)) return input.toLowerCase();
  if (/^data:/i.test(input)) return "data:";
  if (/^blob:/i.test(input)) return "blob:";
  try {
    const url = new URL(input);
    if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
  } catch {
    // Ignore opaque/invalid values rather than logging raw report content.
  }
  return undefined;
}

/** Extract only safe, bounded CSP diagnostics from legacy or Reporting API reports. */
export function sanitizeCspReport(value) {
  const outer = asRecord(value);
  if (!outer) return null;

  const legacyBody = asRecord(outer["csp-report"]);
  const reportingBody = asRecord(outer.body);
  if (!legacyBody && outer.type && outer.type !== "csp-violation") return null;
  const body = legacyBody || reportingBody || outer;

  const directive = shortString(
    body.effectiveDirective ||
      body["effective-directive"] ||
      body.violatedDirective ||
      body["violated-directive"],
    120,
  );
  if (!directive) return null;

  const dispositionValue = shortString(body.disposition, 24).toLowerCase();
  const disposition = dispositionValue === "enforce" || dispositionValue === "report"
    ? dispositionValue
    : undefined;

  const statusCandidate = Number(body.statusCode ?? body["status-code"]);
  const statusCode = Number.isInteger(statusCandidate) && statusCandidate >= 100 && statusCandidate <= 599
    ? statusCandidate
    : undefined;

  return {
    directive,
    disposition,
    documentOrigin: normalizeReportedOrigin(body.documentURL || body["document-uri"] || outer.url),
    blockedOrigin: normalizeReportedOrigin(body.blockedURL || body["blocked-uri"]),
    sourceOrigin: normalizeReportedOrigin(body.sourceFile || body["source-file"]),
    statusCode,
  };
}

async function readLimitedBody(request) {
  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return { tooLarge: true };

  const chunks = [];
  let byteLength = 0;
  let tooLarge = false;
  for await (const part of request) {
    const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
    byteLength += chunk.length;
    if (byteLength > MAX_BODY_BYTES) {
      tooLarge = true;
      chunks.length = 0;
      continue;
    }
    if (!tooLarge) chunks.push(chunk);
  }
  return tooLarge ? { tooLarge: true } : { body: Buffer.concat(chunks).toString("utf8") };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.statusCode = 405;
    response.end();
    return;
  }

  const contentType = String(request.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (!["application/csp-report", "application/reports+json", "application/json"].includes(contentType)) {
    response.statusCode = 415;
    response.end();
    return;
  }

  let received;
  try {
    received = await readLimitedBody(request);
  } catch {
    response.statusCode = 400;
    response.end();
    return;
  }
  if (received.tooLarge) {
    response.statusCode = 413;
    response.end();
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(received.body);
  } catch {
    response.statusCode = 400;
    response.end();
    return;
  }

  const reports = Array.isArray(parsed) ? parsed.slice(0, MAX_REPORTS_PER_REQUEST) : [parsed];
  for (const candidate of reports) {
    const report = sanitizeCspReport(candidate);
    if (!report || report.documentOrigin !== PRODUCTION_ORIGIN || !canLogReport()) continue;
    console.log(JSON.stringify({ event: "csp_violation_report_only", ...report }));
  }

  // CSP delivery is best-effort; never return report contents to the caller.
  response.statusCode = 204;
  response.end();
}
