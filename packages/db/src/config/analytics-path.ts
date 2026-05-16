import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const ANALYTICS_DB_PATH = resolve(__dirname, "..", "..", "..", "..", "analytics", "stats.db");
