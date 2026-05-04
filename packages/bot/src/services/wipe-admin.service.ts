import { eq, sql } from "drizzle-orm";
import { db, schema } from "@grkd-jisho/db";

export async function setWipeEnabled(
  guildId: string,
  channelId: string,
  enabled: boolean,
): Promise<void> {
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

export async function getChannelSettings() {
  return db.select().from(schema.channelSettings);
}

export async function getChannelSetting(channelId: string) {
  const [row] = await db
    .select()
    .from(schema.channelSettings)
    .where(eq(schema.channelSettings.channelId, channelId))
    .limit(1);
  return row ?? null;
}
