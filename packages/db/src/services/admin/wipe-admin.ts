import { eq, asc, sql } from "drizzle-orm";
import { db } from "../../index";
import * as schema from "../../schema";

export async function setWipeEnabled(
  guildId: string,
  channelId: string,
  enabled: boolean,
): Promise<void> {
  // Discord channel IDs are globally unique, so channelId is the natural upsert key.
  await db
    .insert(schema.channelSettings)
    .values({
      guildId,
      channelId,
      wipeEnabled: enabled,
    })
    .onConflictDoUpdate({
      target: schema.channelSettings.channelId,
      set: {
        wipeEnabled: enabled,
        updatedAt: sql`now()`,
      },
    });
}

export async function getChannelSettings(guildId: string) {
  return db
    .select()
    .from(schema.channelSettings)
    .where(eq(schema.channelSettings.guildId, guildId))
    .orderBy(asc(schema.channelSettings.channelId));
}

export async function getChannelSetting(channelId: string) {
  const [row] = await db
    .select()
    .from(schema.channelSettings)
    .where(eq(schema.channelSettings.channelId, channelId))
    .limit(1);
  return row ?? null;
}
