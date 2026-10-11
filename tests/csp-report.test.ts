import { describe, expect, it, vi } from "vitest";
import { normalizeReportedOrigin, sanitizeCspReport } from "../api/csp-report.js";
import { Buffer } from "node:buffer";
import handler from "../api/csp-report.js";

function mockRequest(method: string, headers: Record<string, string> = {}, body = "") {
  return {
    method,
    headers,
    async *[Symbol.asyncIterator]() {
      if (body) yield Buffer.from(body);
    },
  };
}

function mockResponse() {
  const headers: Record<string, string> = {};
  return {
    headers,
    statusCode: 200,
    ended: false,
    setHeader(name: string, value: string) { headers[name.toLowerCase()] = value; },
    end() { this.ended = true; },
  };
}

describe("CSP report endpoint handler", () => {
  it("is POST-only and sends no-store response headers", async () => {
    const response = mockResponse();
    await handler(mockRequest("GET") as never, response as never);

    expect(response.statusCode).toBe(405);
    expect(response.headers.allow).toBe("POST");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.ended).toBe(true);
  });

  it("rejects unsupported content types before parsing", async () => {
    const response = mockResponse();
    await handler(mockRequest("POST", { "content-type": "text/plain" }, "{}") as never, response as never);
    expect(response.statusCode).toBe(415);
  });

  it("rejects malformed JSON", async () => {
    const response = mockResponse();
    await handler(mockRequest("POST", { "content-type": "application/reports+json" }, "{") as never, response as never);
    expect(response.statusCode).toBe(400);
  });

  it("rejects oversized declared bodies before consuming the stream", async () => {
    const response = mockResponse();
    await handler(mockRequest("POST", {
      "content-type": "application/reports+json",
      "content-length": String(32 * 1024 + 1),
    }) as never, response as never);
    expect(response.statusCode).toBe(413);
  });

  it("accepts a synthetic non-production report without logging it", async () => {
    const response = mockResponse();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await handler(mockRequest("POST", { "content-type": "application/reports+json" }, JSON.stringify([{
        type: "csp-violation",
        url: "https://csp-smoke.invalid/",
        body: {
          documentURL: "https://csp-smoke.invalid/",
          blockedURL: "https://asset-smoke.invalid/test.js",
          effectiveDirective: "script-src-elem",
          disposition: "report",
          statusCode: 200,
          sample: "must not be logged",
        },
      }])) as never, response as never);
      expect(response.statusCode).toBe(204);
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it("logs only normalized metadata for canonical production reports", async () => {
    const response = mockResponse();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await handler(mockRequest("POST", { "content-type": "application/csp-report" }, JSON.stringify({
        "csp-report": {
          "document-uri": "https://solo-ai-v2-mu.vercel.app/chat?token=must-not-be-logged",
          "blocked-uri": "https://tracker.example/pixel?user=private",
          "effective-directive": "connect-src",
          "original-policy": "must not be logged",
          "script-sample": "must not be logged",
          "status-code": 200,
        },
      })) as never, response as never);
      expect(response.statusCode).toBe(204);
      expect(log).toHaveBeenCalledTimes(1);
      const record = JSON.parse(String(log.mock.calls[0][0]));
      expect(record).toMatchObject({
        event: "csp_violation_report_only",
        directive: "connect-src",
        documentOrigin: "https://solo-ai-v2-mu.vercel.app",
        blockedOrigin: "https://tracker.example",
        statusCode: 200,
      });
      expect(JSON.stringify(record)).not.toContain("token=");
      expect(JSON.stringify(record)).not.toContain("private");
      expect(JSON.stringify(record)).not.toContain("must not be logged");
    } finally {
      log.mockRestore();
    }
  });
});


describe("CSP report sanitization", () => {
  it("keeps legacy report metadata but removes URL paths, query strings, and payload samples", () => {
    const report = sanitizeCspReport({
      "csp-report": {
        "document-uri": "https://solo-ai-v2-mu.vercel.app/chat?token=must-not-be-logged",
        "blocked-uri": "https://tracker.example/pixel?user=private",
        "source-file": "https://solo-ai-v2-mu.vercel.app/assets/app.js?cache=bust",
        "effective-directive": "connect-src",
        "violated-directive": "connect-src",
        "original-policy": "full policy must not be copied to logs",
        "script-sample": "sensitive snippet must not be copied to logs",
        "status-code": 200,
      },
    });

    expect(report).toEqual({
      directive: "connect-src",
      disposition: undefined,
      documentOrigin: "https://solo-ai-v2-mu.vercel.app",
      blockedOrigin: "https://tracker.example",
      sourceOrigin: "https://solo-ai-v2-mu.vercel.app",
      statusCode: 200,
    });
    expect(JSON.stringify(report)).not.toContain("token=");
    expect(JSON.stringify(report)).not.toContain("private");
    expect(JSON.stringify(report)).not.toContain("sensitive snippet");
  });

  it("accepts modern Reporting API envelopes and normalizes inline sentinels", () => {
    const report = sanitizeCspReport({
      type: "csp-violation",
      url: "https://solo-ai-v2-mu.vercel.app/dashboard",
      body: {
        documentURL: "https://solo-ai-v2-mu.vercel.app/dashboard",
        blockedURL: "inline",
        sourceFile: "blob:https://solo-ai-v2-mu.vercel.app/worker-id",
        effectiveDirective: "script-src-elem",
        disposition: "report",
        statusCode: 200,
        sample: "never log sample",
        user_agent: "never log user agent",
      },
    });

    expect(report).toEqual({
      directive: "script-src-elem",
      disposition: "report",
      documentOrigin: "https://solo-ai-v2-mu.vercel.app",
      blockedOrigin: "inline",
      sourceOrigin: "blob:",
      statusCode: 200,
    });
  });

  it("rejects irrelevant report types and reports without a directive", () => {
    expect(sanitizeCspReport({ type: "deprecation", body: { effectiveDirective: "script-src" } })).toBeNull();
    expect(sanitizeCspReport({ "csp-report": { "blocked-uri": "https://bad.example" } })).toBeNull();
    expect(sanitizeCspReport(null)).toBeNull();
  });

  it("bounds directive length and never returns arbitrary non-http origins", () => {
    const report = sanitizeCspReport({
      type: "csp-violation",
      body: {
        documentURL: "https://solo-ai-v2-mu.vercel.app/path",
        effectiveDirective: "a".repeat(300),
        blockedURL: "file:///etc/passwd",
      },
    });

    expect(report?.directive).toHaveLength(120);
    expect(report?.blockedOrigin).toBeUndefined();
    expect(normalizeReportedOrigin("data:text/html,<script>nope</script>")).toBe("data:");
    expect(normalizeReportedOrigin("blob:https://example.com/opaque-id")).toBe("blob:");
  });
});
