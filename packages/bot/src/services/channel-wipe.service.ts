import { randomUUID } from "node:crypto";
import { type TextChannel } from "discord.js";
import { db, schema } from "@grkd-jisho/db";
import { eq } from "drizzle-orm";
import { traceEvent } from "./observability.service.js";

interface WipeResult {
  deletedCount: number;
}

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export async function wipeChannel(channel: TextChannel): Promise<WipeResult> {
  const traceId = `wipe-${randomUUID()}`;
  console.log(`[Wipe] trace_id=${traceId} start channel=${channel.id}`);

  // Step 1: ピン留めIDを取得（除外対象）
  const pins = await channel.messages.fetchPinned();
  const pinnedIds = new Set(pins.map((p) => p.id));

  // 24時間前を UTC 基準で計算（cron は 00:00 GMT+7 発火 = 17:00 UTC）
  // Date.now() と createdTimestamp は共に UTC なので比較にタイムゾーンは影響しない。
  // このフィルターの目的は「長期停止後の初回wipeで全メッセージを消さない安全策」。
  // 「GMT+7の日付境界ぴったり」にする必要はない。
  const cutoff = Date.now() - TWENTY_FOUR_HOURS_MS;

  // 観測性: wipe開始を記録
  await traceEvent(traceId, "wipe.started", "info", {
    channelId: channel.id,
    pinnedCount: pins.size,
  });

  // Step 2: バルク削除可能なメッセージを100件ずつバッチ処理
  let lastId: string | undefined;
  let totalDeleted = 0;

  while (true) {
    const messages = lastId
      ? await channel.messages.fetch({
          limit: 100,
          cache: false,
          before: lastId,
        })
      : await channel.messages.fetch({ limit: 100, cache: false });
    if (messages.size === 0) break;

    // 24時間以内 かつ ピン留め以外 を抽出
    const toDelete = messages.filter(
      (m) => !pinnedIds.has(m.id) && m.createdTimestamp >= cutoff,
    );

    if (toDelete.size > 0) {
      try {
        // bulkDelete は最低2件必要。1件の場合は個別削除
        if (toDelete.size === 1) {
          await toDelete.first()!.delete();
        } else {
          // filterOld: true → 14日以上前のメッセージは自動スキップ
          await channel.bulkDelete(toDelete, true);
        }
        totalDeleted += toDelete.size;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(
          `[Wipe] trace_id=${traceId} batch failed (${totalDeleted} done): ${reason} → Check permissions and 429 rate limits`,
        );
        // discord.js が429を自動リトライするため、ここでは記録のみ
        // どうしても失敗する場合は上位でキャッチされる
        throw err;
      }
    }

    // 今回の取得が100件未満 = 残りなし
    if (messages.size < 100) break;
    lastId = messages.last()!.id;
  }

  // Step 3: DB の lastWipeAt を更新
  if (totalDeleted > 0) {
    await db
      .update(schema.channelSettings)
      .set({ lastWipeAt: new Date() })
      .where(eq(schema.channelSettings.channelId, channel.id));
  }

  // Step 4: 観測性
  await traceEvent(traceId, "wipe.completed", "info", {
    channelId: channel.id,
    deletedCount: totalDeleted,
  });

  console.log(
    `[Wipe] trace_id=${traceId} completed: ${totalDeleted} messages deleted`,
  );
  return { deletedCount: totalDeleted };
}
