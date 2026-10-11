#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { findSecretCandidates } from "./secret-scanner.mjs";

const TEXT_EXTENSIONS = new Set([
  ".cjs", ".css", ".html", ".js", ".jsx", ".json", ".md", ".mjs",
  ".sh", ".sql", ".toml", ".ts", ".tsx", ".txt", ".yaml", ".yml",
]);
const SKIP_BASENAMES = new Set(["package-lock.json", "deno.lock"]);
const trackedPaths = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

let scanned = 0;
const findings = [];

for (const filePath of trackedPaths) {
  const basename = path.basename(filePath);
  const extension = path.extname(filePath).toLowerCase();
  if (SKIP_BASENAMES.has(basename)) continue;
  if (!TEXT_EXTENSIONS.has(extension) && ![".env.example", ".env.sample"].includes(basename)) continue;

  let bytes;
  try {
    bytes = readFileSync(filePath);
  } catch {
    console.error("[secret-scan] Unable to read tracked file: " + filePath);
    process.exitCode = 2;
    continue;
  }
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
