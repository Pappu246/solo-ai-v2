#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { findSecretCandidates } from "./secret-scanner.mjs";

const SKIP_BASENAMES = new Set(["package-lock.json", "deno.lock"]);
const trackedPaths = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

let scanned = 0;
const findings = [];

for (const filePath of trackedPaths) {
  if (SKIP_BASENAMES.has(path.basename(filePath))) continue;

  let bytes;
  try {
    bytes = readFileSync(filePath);
  } catch {
    console.error("[secret-scan] Unable to read tracked file: " + filePath);
    process.exitCode = 2;
    continue;
  }
  // Skip binary assets; scan all text files regardless of extension, including
  // extensionless files and .env-style filenames if they were tracked.
  if (bytes.includes(0)) continue;

  scanned += 1;
  findings.push(...findSecretCandidates(bytes.toString("utf8"), filePath));
}

if (findings.length) {
  console.error("[secret-scan] Potential hard-coded credentials found. Values are intentionally redacted:");
  for (const finding of findings) {
    console.error("  " + finding.path + ":" + finding.line + " — " + finding.rule);
  }
  console.error("[secret-scan] Reviewed " + scanned + " tracked text files.");
  process.exitCode = 1;
} else {
  console.log("[secret-scan] PASS — reviewed " + scanned + " tracked text files; no high-confidence credential patterns found.");
}
