import { parseArgs } from "node:util";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { importYomitanDictionaryFromBuffer } from "../src/services/admin/yomitan-import.js";

const { values } = parseArgs({
  options: {
    file: { type: "string" },
    name: { type: "string" },
    priority: { type: "string" },
  },
});

if (!values.file || !values.priority) {
  console.error("[ImportYomitanCLI] Invalid arguments: missing --file or --priority → Usage: import-yomitan --file <path> [--name <name>] --priority <number>");
  process.exit(1);
}

const filePath = path.resolve(values.file);
const priority = Number.parseInt(values.priority, 10);

if (Number.isNaN(priority)) {
  console.error("[ImportYomitanCLI] Invalid priority: NaN → Set --priority to an integer value");
  process.exit(1);
}

try {
  console.log(`[ImportYomitanCLI] Reading ZIP: ${filePath}`);
  const zipBuffer = await readFile(filePath);

  const result = await importYomitanDictionaryFromBuffer(zipBuffer, {
    dictionaryName: values.name,
    priority,
  });

  console.log(`[ImportYomitanCLI] Import completed: dictionary=${result.dictionaryName} entries=${result.importedEntries} skipped=${result.skippedMalformed}`);
  process.exit(0);
} catch (err) {
  const reason = err instanceof Error ? err.message : String(err);
  console.error(`[ImportYomitanCLI] Import failed: ${reason} → Check ZIP structure, file path, and DATABASE_URL connectivity`);
  process.exit(1);
}
