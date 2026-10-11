import { describe, expect, it } from "vitest";
import { normalizeReportedOrigin, sanitizeCspReport } from "./csp-report.js";

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
      sourceOrigin: "https://solo-ai-v2.vercel.app",
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
