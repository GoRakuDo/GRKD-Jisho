/**
 * pnpm db:backup — PostgreSQL logical backup CLI
 *
 * Creates a pg_dump custom-format archive without exposing the database
 * password in process arguments. Old backups are pruned only after a
 * successful dump, and only files matching the configured prefix are touched.
 */
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDotEnv } from "../env-schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..", "..", "..", "..");
const DEFAULT_BACKUP_DIR = resolve(PROJECT_ROOT, "backups", "postgres");
const DEFAULT_PREFIX = "grkd-jisho";
const DEFAULT_RETENTION_DAYS = 30;
const NON_FATAL_CHMOD_CODES = new Set(["ENOTSUP", "EOPNOTSUPP", "EPERM", "ENOSYS"]);

interface ParsedDatabaseUrl {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
  pgEnv: Record<string, string>;
}

interface BackupConfig {
  databaseUrl: string;
  backupDir: string;
  prefix: string;
  retentionDays: number;
}

interface BackupFile {
  name: string;
  path: string;
  sizeBytes: number;
  createdAt: Date;
}

interface CliArgs {
  dryRun: boolean;
  list: boolean;
  json: boolean;
}

type CommandError = Error & {
  stderr?: Buffer;
  stdout?: Buffer;
};

function loadEnv(): Record<string, string> {
  const envPath = resolve(PROJECT_ROOT, ".env");
  return {
    ...loadDotEnv(envPath),
    ...process.env,
  } as Record<string, string>;
}

function parseArgs(argv: string[]): CliArgs {
  if (argv.includes("--list") && argv.includes("--dry-run")) {
    throw new Error("--list and --dry-run cannot be used together");
  }
  return {
    dryRun: argv.includes("--dry-run"),
    list: argv.includes("--list"),
    json: argv.includes("--json"),
  };
}

function parseNonNegativeInteger(value: string | undefined, fallback: number): number {
  if (!value || value.trim().length === 0) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid non-negative integer: ${value}`);
  }
  return parsed;
}

function validatePrefix(prefix: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(prefix)) {
    throw new Error("DB_BACKUP_PREFIX may only contain letters, numbers, dot, underscore, and hyphen");
  }
  return prefix;
}

function loadConfig(): BackupConfig {
  const env = loadEnv();
  const databaseUrl = env["DATABASE_URL"];
  if (!databaseUrl || databaseUrl.trim().length === 0) {
    throw new Error("DATABASE_URL is not set");
  }

  return {
    databaseUrl,
    backupDir: resolve(env["DB_BACKUP_DIR"] ?? DEFAULT_BACKUP_DIR),
    prefix: validatePrefix(env["DB_BACKUP_PREFIX"] ?? DEFAULT_PREFIX),
    retentionDays: parseNonNegativeInteger(env["DB_BACKUP_RETENTION_DAYS"], DEFAULT_RETENTION_DAYS),
  };
}

function parseDatabaseUrl(databaseUrl: string): ParsedDatabaseUrl {
  const url = new URL(databaseUrl);
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("DATABASE_URL must use postgresql:// or postgres://");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!url.hostname || !url.username || !database) {
    throw new Error("DATABASE_URL must include host, username, and database name");
  }
  const pgEnv: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (value.length === 0) continue;
    const envKey = `PG${key.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
    pgEnv[envKey] = value;
  }
  return {
    host: url.hostname,
    port: url.port || "5432",
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    pgEnv,
  };
}

function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function getBackupRegex(prefix: string): RegExp {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}-\\d{8}T\\d{6}Z\\.dump$`);
}

function listBackupFiles(config: BackupConfig): BackupFile[] {
  if (!existsSync(config.backupDir)) return [];
  const backupRegex = getBackupRegex(config.prefix);
  return readdirSync(config.backupDir)
    .filter((name) => backupRegex.test(name))
    .map((name): BackupFile | null => {
      const path = resolve(config.backupDir, name);
      let stats: ReturnType<typeof statSync>;
      try {
        stats = statSync(path);
      } catch (e: unknown) {
        const err = e as NodeJS.ErrnoException;
        if (err.code === "ENOENT") return null;
        throw e;
      }
      return {
        name,
        path,
        sizeBytes: stats.size,
        createdAt: stats.mtime,
      };
    })
    .filter((file): file is BackupFile => file !== null)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

function ensurePgDumpAvailable(): string {
  try {
    return execFileSync("pg_dump", ["--version"], {
      encoding: "utf-8",
      timeout: 5000,
    }).toString().trim();
  } catch (e: unknown) {
    const err = e as CommandError;
    throw new Error(`pg_dump is not available: ${err.message}`);
  }
}

function runPgDump(parsed: ParsedDatabaseUrl, tmpPath: string): void {
  const args = [
    "-h", parsed.host,
    "-p", parsed.port,
    "-U", parsed.user,
    "-d", parsed.database,
    "--format=custom",
    "--compress=9",
    "--no-owner",
    "--no-privileges",
    "--file", tmpPath,
  ];

  try {
    execFileSync("pg_dump", args, {
      encoding: "utf-8",
      timeout: 30 * 60 * 1000,
      env: {
        ...process.env,
        ...parsed.pgEnv,
        PGPASSWORD: parsed.password,
      },
    });
  } catch (e: unknown) {
    const err = e as CommandError;
    const stderr = err.stderr?.toString().trim();
    throw new Error(stderr || err.message);
  }
}

function verifyDumpArchive(dumpPath: string): void {
  try {
    execFileSync("pg_restore", ["--list", dumpPath], {
      encoding: "utf-8",
      timeout: 5 * 60 * 1000,
    });
  } catch (e: unknown) {
    const err = e as CommandError;
    const stderr = err.stderr?.toString().trim();
    throw new Error(`pg_restore --list failed: ${stderr || err.message}`);
  }
}

function chmodIfPossible(path: string, mode: number, label: string): void {
  try {
    chmodSync(path, mode);
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err.code && NON_FATAL_CHMOD_CODES.has(err.code)) {
      process.stderr.write(
        `[DBBackup] warning: chmod ${mode.toString(8)} on ${label} failed (${err.code}); ` +
        "filesystem may not support POSIX permissions — backup is saved but may be readable by the mount's permission mask.\n",
      );
      return;
    }
    throw e;
  }
}

function pruneOldBackups(config: BackupConfig, now: Date): BackupFile[] {
  if (config.retentionDays === 0) return [];
  const cutoff = now.getTime() - config.retentionDays * 24 * 60 * 60 * 1000;
  const oldFiles = listBackupFiles(config).filter((file) => file.createdAt.getTime() < cutoff);
  for (const file of oldFiles) {
    rmSync(file.path, { force: true });
  }
  return oldFiles;
}

function printList(config: BackupConfig, json: boolean): void {
  const files = listBackupFiles(config);
  if (json) {
    console.log(JSON.stringify({ backupDir: config.backupDir, files }, null, 2));
    return;
  }

  console.log(`Backup dir: ${config.backupDir}`);
  if (files.length === 0) {
    console.log("No backups found.");
    return;
  }
  for (const file of files) {
    const sizeMb = (file.sizeBytes / 1024 / 1024).toFixed(1);
    console.log(`${file.createdAt.toISOString()}  ${sizeMb}MB  ${file.name}`);
  }
}

function runBackup(config: BackupConfig, dryRun: boolean, json: boolean): void {
  const parsed = parseDatabaseUrl(config.databaseUrl);
  const now = new Date();
  const fileName = `${config.prefix}-${formatTimestamp(now)}.dump`;
  const finalPath = resolve(config.backupDir, fileName);
  const tmpPath = `${finalPath}.tmp-${process.pid}`;

  if (dryRun) {
    const result = {
      dryRun: true,
      backupDir: config.backupDir,
      fileName,
      retentionDays: config.retentionDays,
      target: `${parsed.host}:${parsed.port}/${parsed.database}`,
      user: parsed.user,
    };
    console.log(json ? JSON.stringify(result, null, 2) : `DRY RUN: would create ${finalPath}`);
    return;
  }

  const pgDumpVersion = ensurePgDumpAvailable();
  mkdirSync(config.backupDir, { recursive: true });
  const previousUmask = process.umask(0o077);
  try {
    chmodIfPossible(config.backupDir, 0o700, "backup dir");
    runPgDump(parsed, tmpPath);
    chmodIfPossible(tmpPath, 0o600, "tmp dump");
    renameSync(tmpPath, finalPath);
    chmodIfPossible(finalPath, 0o600, "dump");
    verifyDumpArchive(finalPath);
  } catch (e: unknown) {
    rmSync(tmpPath, { force: true });
    rmSync(finalPath, { force: true });
    throw e;
  } finally {
    process.umask(previousUmask);
  }

  const stats = statSync(finalPath);
  const pruned = pruneOldBackups(config, now);
  const result = {
    backupPath: finalPath,
    sizeBytes: stats.size,
    pgDumpVersion,
    retentionDays: config.retentionDays,
    pruned: pruned.map((file) => file.name),
  };

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const sizeMb = (stats.size / 1024 / 1024).toFixed(1);
  console.log(`✅ Backup created: ${finalPath} (${sizeMb}MB)`);
  if (pruned.length > 0) {
    console.log(`🧹 Pruned ${pruned.length} old backup(s): ${pruned.map((file) => file.name).join(", ")}`);
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  try {
    const config = loadConfig();
    if (args.list) {
      printList(config, args.json);
      return;
    }
    runBackup(config, args.dryRun, args.json);
  } catch (e: unknown) {
    const err = e as Error;
    console.error(`[DBBackup] failed: ${err.message} → Check DATABASE_URL, pg_dump, and DB_BACKUP_DIR permissions`);
    process.exit(1);
  }
}

main();
