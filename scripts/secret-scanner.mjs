/**
 * High-confidence secret-pattern scanner for tracked first-party text files.
 * It reports only file, line and rule; matched credential text is never printed.
 *
 * Exact fake values used by provider redaction tests are allow-listed so those
 * regression fixtures can remain while genuine credential-shaped values fail.
 */
const SECRET_RULES = [
  { name: "provider API key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{32,}\b/g },
  { name: "GitHub access token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{50,})\b/g },
  { name: "Slack access token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
  { name: "AWS access key ID", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "private-key PEM header", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
];

const KNOWN_TEST_FIXTURES = new Set([
  "sk-openai-test-key-000000",
  "sk-deepseek-test-key-000",
  "AIzaSyA1234567890abcdefghijklmnopqrstuv",
  "AIzaTESTKEY123456789012345678901234567890",
]);

export function findSecretCandidates(text, filePath = "<text>") {
  if (typeof text !== "string") throw new TypeError("text must be a string");
  const findings = [];

  for (const rule of SECRET_RULES) {
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
    for (const match of text.matchAll(pattern)) {
      if (KNOWN_TEST_FIXTURES.has(match[0])) continue;
      const line = text.slice(0, match.index).split(/\r\n|\r|\n/).length;
      findings.push({ path: filePath, line, rule: rule.name });
    }
  }

  return findings;
}
