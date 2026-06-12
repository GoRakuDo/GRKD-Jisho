#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const markerRoot = resolve(repoRoot, ".review", "approved");

function git(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function parseArgs(argv) {
  const args = {
    commit: "HEAD",
    approver: process.env["REVIEW_APPROVER"] || process.env["USERNAME"] || process.env["USER"] || "unknown",
    summary: "code-reviewer APPROVE",
    blockerHighCount: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      continue;
    } else if (arg === "--commit") {
      args.commit = argv[++i] ?? "";
    } else if (arg === "--approver") {
      args.approver = argv[++i] ?? "";
    } else if (arg === "--summary") {
      args.summary = argv[++i] ?? "";
    } else if (arg === "--blocker-high-count") {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value < 0) {
        throw new Error("--blocker-high-count must be a non-negative integer");
      }
      args.blockerHighCount = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.commit.trim() || args.commit === "--") {
    throw new Error("--commit must be a commit ref");
  }
  if (!args.approver.trim()) {
    throw new Error("approver is required");
  }
  if (!args.summary.trim()) {
    throw new Error("summary is required");
  }
  if (args.blockerHighCount === null) {
    throw new Error("--blocker-high-count is required; pass 0 only after @code-reviewer APPROVE");
  }
  if (args.blockerHighCount > 0) {
    throw new Error("refusing to create APPROVE marker with blocker/high findings remaining");
  }
  return args;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const sha = git(["rev-parse", args.commit]);
  const marker = {
    commit: sha,
    verdict: "APPROVE",
    blockerHighCount: args.blockerHighCount,
    approvedAt: new Date().toISOString(),
    approver: args.approver,
    summary: args.summary,
  };
  mkdirSync(markerRoot, { recursive: true, mode: 0o700 });
  const markerPath = resolve(markerRoot, `${sha}.json`);
  writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 });
  console.log(`[ReviewGate] approval marker created: ${markerPath}`);
} catch (error) {
  const err = error instanceof Error ? error : new Error(String(error));
  console.error(`[ReviewGate] failed: ${err.message} → Run @code-reviewer before approving`);
  process.exit(1);
}
