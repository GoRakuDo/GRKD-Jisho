import { type APIEmbed, type TextChannel } from "discord.js";
import { db, schema } from "@grkd-jisho/db";
import { eq } from "drizzle-orm";

interface WipeResult {
  newChannelId: string;
  pinCount: number;
}

export async function wipeChannel(channel: TextChannel): Promise<WipeResult> {
  const pins = await channel.messages.fetchPinned();

  // Step 1: 固定メッセージの内容を退避（content が空文字の場合は送信しない）
  const pinContents: Array<{ content: string; embedJSONs: APIEmbed[] }> = [];
  for (const pin of pins.values()) {
    pinContents.push({
      content: pin.content,
      embedJSONs: pin.embeds.map((e) => e.toJSON()),
    });
  }

  // Step 2: チャンネルをクローン
  const newChannel = await channel.clone({
    name: channel.name,
    nsfw: channel.nsfw,
    rateLimitPerUser: channel.rateLimitPerUser,
    parent: channel.parentId ?? null,
    position: channel.position,
    permissionOverwrites: channel.permissionOverwrites.cache.map((o) => ({
      id: o.id,
      allow: o.allow.bitfield,
      deny: o.deny.bitfield,
      type: o.type,
    })),
    reason: "Daily channel wipe (GRKD-Jisho)",
    ...(channel.topic ? { topic: channel.topic } : {}),
  });

  // Step 3: 固定メッセージを新チャンネルへ復元
  try {
    for (const pin of pinContents) {
      const payload: { content?: string; embeds?: APIEmbed[] } = {};
      if (pin.content) {
        payload.content = pin.content;
      }
      if (pin.embedJSONs.length > 0) payload.embeds = pin.embedJSONs;

      if (Object.keys(payload).length === 0) {
        payload.content = "\u200B";
      }

      const sent = await newChannel.send(payload);
      await sent.pin();
    }
  } catch (err) {
    await newChannel.delete("Failed to restore pinned messages during wipe");
    throw err;
  }

  // Step 4: 古いチャンネルを削除
  await channel.delete("Daily channel wipe (GRKD-Jisho)");

  // Step 5: DB の channel_settings を新しいチャンネルIDに更新
  await db
    .update(schema.channelSettings)
    .set({
      channelId: newChannel.id,
      lastWipeAt: new Date(),
    })
    .where(eq(schema.channelSettings.channelId, channel.id));

  return {
    newChannelId: newChannel.id,
    pinCount: pinContents.length,
  };
}
