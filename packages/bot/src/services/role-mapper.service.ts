import { isOutputBucketKey } from "@grkd-jisho/db";
import type { RoleKey } from "../types.js";

const DAILY_JAPANESE_OUTPUT_BUCKET_KEY: RoleKey = "daily-japanese";
const DEFAULT_OUTPUT_BUCKET_KEY: RoleKey = "indonesian";

/**
 * Load role bindings from the database for a given guild.
 * Role ID mappings are guild-specific; invalid legacy values are ignored.
 */
async function loadBindings(guildId: string): Promise<Record<string, RoleKey>> {
  try {
    const { getRoleBindings } = await import("@grkd-jisho/db");
    const bindings = await getRoleBindings(guildId);
    const map: Record<string, RoleKey> = {};

    for (const b of bindings) {
      if (isOutputBucketKey(b.outputBucketKey)) {
        map[b.discordRoleId] = b.outputBucketKey;
      }
    }

    return map;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      `[RoleMapper] Failed to load role bindings for guild=${guildId}: ${reason} → Check DB connectivity and role_bindings rows`,
    );
    throw new Error(`Failed to load role bindings for guild ${guildId}`);
  }
}

/**
 * Resolve the output bucket for a set of role IDs.
 *
 * daily-japanese wins when any bound role matches.
 * If nothing matches, indonesian is the fallback bucket.
 */
export async function resolveOutputBucketKey(
  roleIds: string[],
  guildId?: string,
): Promise<RoleKey> {
  if (!guildId) {
    return DEFAULT_OUTPUT_BUCKET_KEY;
  }

  const map = await loadBindings(guildId);

  for (const roleId of roleIds) {
    if (map[roleId] === DAILY_JAPANESE_OUTPUT_BUCKET_KEY) {
      return DAILY_JAPANESE_OUTPUT_BUCKET_KEY;
    }
  }

  return DEFAULT_OUTPUT_BUCKET_KEY;
}
