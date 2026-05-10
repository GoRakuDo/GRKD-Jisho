import type { RoleKey } from "../types.js";

const ROLE_ORDER: RoleKey[] = ["pemula", "pemula-atas", "menengah", "mahir"];

/**
 * Cached DB bindings keyed by guildId, with 30-minute TTL.
 * Populated lazily on first resolveRoleKey call per guild.
 * Expired entries are refreshed on the next resolveRoleKey call.
 */
const CACHE_TTL_MS = 30 * 60 * 1000;

interface CacheEntry {
  map: Record<string, RoleKey>;
  timestamp: number;
}

const bindingCache = new Map<string, CacheEntry>();

function isCacheValid(entry: CacheEntry): boolean {
  return Date.now() - entry.timestamp < CACHE_TTL_MS;
}

/**
 * Load role bindings from the database for a given guild.
 * Role ID mappings are guild-specific; if no binding exists, the default role key is used.
 */
async function loadBindings(guildId: string): Promise<Record<string, RoleKey>> {
  try {
    const { getRoleBindings } = await import("@grkd-jisho/db");
    const bindings = await getRoleBindings(guildId);
    const map: Record<string, RoleKey> = {};

    for (const b of bindings) {
      if (ROLE_ORDER.includes(b.systemRoleKey as RoleKey)) {
        map[b.discordRoleId] = b.systemRoleKey as RoleKey;
      }
    }

    return map;
  } catch {
    return {};
  }
}

/**
 * Resolve the highest-priority system role key for a set of role IDs.
 *
 * Tries DB bindings first (lazy loaded per guild), falls back to pemula.
 */
export async function resolveRoleKey(
  roleIds: string[],
  guildId?: string,
): Promise<RoleKey> {
  const cacheKey = guildId ?? "__default__";

  const cached = bindingCache.get(cacheKey);
  if (!cached || !isCacheValid(cached)) {
    const map = await loadBindings(cacheKey);
    bindingCache.set(cacheKey, { map, timestamp: Date.now() });
  }

  const map = bindingCache.get(cacheKey)!.map;
  let best: RoleKey = "pemula";
  let bestIndex = 0;

  for (const roleId of roleIds) {
    const key = map[roleId];
    if (key) {
      const idx = ROLE_ORDER.indexOf(key);
      if (idx > bestIndex) {
        best = key;
        bestIndex = idx;
      }
    }
  }

  return best;
}

/**
 * Invalidate the binding cache for a guild.
 * Called after an admin updates bindings via the WebUI or MCP.
 */
export function invalidateBindingCache(guildId?: string): void {
  if (guildId) {
    bindingCache.delete(guildId);
  } else {
    bindingCache.clear();
  }
}
