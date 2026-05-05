/**
 * Re-export from shared @grkd-jisho/db service.
 *
 * Kept for backward compatibility — bot commands still import from this path.
 * Future refactoring: update commands to import directly from @grkd-jisho/db.
 */
export {
  searchResponse,
  getResponseById,
  updateResponse,
  deleteCacheByQuery,
  getLookupSource,
  getDictionaryList,
} from "@grkd-jisho/db";

export type { SearchResult, SourceResult } from "@grkd-jisho/db";
