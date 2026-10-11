import { describe, expect, it } from "vitest";
import { findSecretCandidates } from "../scripts/secret-scanner.mjs";

describe("tracked-source secret regression scanner", () => {
  it("detects provider credentials without returning the credential text", () => {
    const secret = "sk-" + "q".repeat(32);
    const findings = findSecretCandidates("const key = '" + secret + "';", "src/leak.ts");

    expect(findings).toEqual([{ path: "src/leak.ts", line: 1, rule: "provider API key" }]);
    expect(JSON.stringify(findings)).not.toContain(secret);
  });

  it("detects Google keys and reports the source line", () => {
    const secret = "AIza" + "A".repeat(35);
    const findings = findSecretCandidates("// configuration\nconst key = '" + secret + "';", "config.ts");

    expect(findings).toEqual([{ path: "config.ts", line: 2, rule: "Google API key" }]);
  });

  it("detects private-key headers", () => {
    const findings = findSecretCandidates("config:\n-----BEGIN PRIVATE KEY-----\n...", "private.pem");
    expect(findings).toEqual([{ path: "private.pem", line: 2, rule: "private-key PEM header" }]);
  });

  it("allows only the exact fake API-key fixtures needed by existing redaction tests", () => {
    expect(findSecretCandidates('const fake = "sk-openai-test-key-000000";', "providers_test.ts")).toEqual([]);
    expect(findSecretCandidates('const fake = "AIzaTESTKEY123456789012345678901234567890";', "image-search.test.ts")).toEqual([]);
  });

  it("does not flag short redaction sentinels or normal code", () => {
    expect(findSecretCandidates('redact("sk-should-not-leak");\nconst retries = 3;', "providers_test.ts")).toEqual([]);
  });
});
