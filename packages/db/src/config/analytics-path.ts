import { resolve } from "node:path";

export const ANALYTICS_DB_PATH = resolve(process.cwd(), "..", "..", "analytics", "stats.db");
