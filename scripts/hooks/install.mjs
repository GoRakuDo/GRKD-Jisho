#!/usr/bin/env node
import { chmodSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");
const hooksDir = join(repoRoot, ".git", "hooks");
const source = join(__dirname, "pre-push");
const target = join(hooksDir, "pre-push");

if (!existsSync(hooksDir)) {
  console.error(`[Hooks] .git/hooks not found: ${hooksDir}`);
  process.exit(1);
}

if (existsSync(target)) {
  const backup = `${target}.bak`;
  copyFileSync(target, backup);
  console.log(`[Hooks] backed up existing pre-push: ${backup}`);
}

copyFileSync(source, target);
if (process.platform !== "win32") {
  chmodSync(target, 0o755);
}
console.log(`[Hooks] installed pre-push: ${target}`);
