#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
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
  const args = { commit: "HEAD", maxAgeHours: 48 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      continue;
    } else if (arg === "--commit") {
      args.commit = argv[++i] ?? "";
    } else if (arg === "--max-age-hours") {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error("--max-age-hours must be a positive integer");
      }
      args.maxAgeHours = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.commit.trim() || args.commit === "--") {
    throw new Error("--commit must be a commit ref");
  }
  return args;
}

function readMarker(path) {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("approval marker must be a JSON object");
  }
  return parsed;
}

function validateMarker(marker, expectedSha, maxAgeHours) {
  if (marker.commit !== expectedSha) {
    throw new Error(`marker commit mismatch: expected ${expectedSha}, got ${String(marker.commit)}`);
  }
  if (marker.verdict !== "APPROVE") {
    throw new Error(`marker verdict must be APPROVE, got ${String(marker.verdict)}`);
  }
  if (!marker.approvedAt || typeof marker.approvedAt !== "string") {
    throw new Error("marker approvedAt is missing");
  }
  const approvedAt = Date.parse(marker.approvedAt);
  if (Number.isNaN(approvedAt)) {
    throw new Error("marker approvedAt is not a valid ISO timestamp");
  }
  const ageHours = (Date.now() - approvedAt) / 1000 / 60 / 60;
  if (ageHours < -0.1) {
    throw new Error("marker approvedAt is in the future");
  }
  if (ageHours > maxAgeHours) {
    throw new Error(`marker is stale: ${ageHours.toFixed(1)}h old, max ${maxAgeHours}h`);
  }
  if (marker.blockerHighCount !== 0) {
    throw new Error(`marker blockerHighCount must be 0, got ${String(marker.blockerHighCount)}`);
  }
}

try {
  const args = parseArgs(process.argv.slice(2));
  const sha = git(["rev-parse", args.commit]);
  const markerPath = resolve(markerRoot, `${sha}.json`);
  if (!existsSync(markerPath)) {
    throw new Error(
      `review approval marker not found for ${sha}. Run @code-reviewer, then pnpm review:approve.`,
    );
  }
  const marker = readMarker(markerPath);
  validateMarker(marker, sha, args.maxAgeHours);
  console.log(`[ReviewGate] approved: ${sha} (${marker.approvedAt})`);
} catch (error) {
  const err = error instanceof Error ? error : new Error(String(error));
  console.error(`[ReviewGate] failed: ${err.message} → Run @code-reviewer and create a fresh approval marker`);
  process.exit(1);
}
