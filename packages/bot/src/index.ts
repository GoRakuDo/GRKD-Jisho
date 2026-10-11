import { env } from "./config/env.js";
import { Client, GatewayIntentBits, Events, Status, TextChannel } from "discord.js";
import cron from "node-cron";
import { eq } from "drizzle-orm";
import { db, schema } from "@grkd-jisho/db";
import { messageCreateHandler } from "./events/messageCreate.js";
import { messageUpdateHandler } from "./events/messageUpdate.js";
import { interactionCreateHandler } from "./events/interactionCreate.js";
import { recordHeartbeat, traceEvent } from "./services/observability.service.js";
import { wipeChannel } from "./services/channel-wipe.service.js";
import { pollAndExecuteJobs } from "./services/ops-job.service.js";
import { purgeOldLogs } from "./services/log-purge.service.js";
import { aggregateHourly } from "./services/analytics.service.js";

const client = new Client({
  // Note: MessageContent は要求しない。mention/DM/reply 経路は privileged intent 無しで本文が届く。
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

// Gateway watchdog（ゾンビ化防止）。切断継続が5分を超えたら process.exit(1) し、
// systemd の Restart=on-failure に再起動を任せる。無限ループは RestartSec + StartLimit 側で抑止。
const GATEWAY_DISCONNECT_EXIT_AFTER_MS = 5 * 60 * 1000;
let gatewayDisconnectedSince: number | null = null;

function getShardStatusName(): string {
  const shard = client.ws.shards.first();
  return shard ? (Status[shard.status] ?? String(shard.status)) : "no-shard";
}

function isGatewayDisconnected(): boolean {
  if (client.readyAt === null) return true;
  const shards = [...client.ws.shards.values()];
  if (shards.length === 0) return true;
  return shards.some((s) => s.status !== Status.Ready);
}

client.once("ready", () => {
  console.log(`Bot logged in as ${client.user?.tag}`);
  console.log("Prompt source: active prompt row in DB");

  // 2分ごとに heartbeat を送信（Gateway切断中は degraded + wsStatus付きで正直に記録）
  setInterval(async () => {
    const wsStatusName = getShardStatusName();
    if (isGatewayDisconnected()) {
      if (gatewayDisconnectedSince === null) {
        gatewayDisconnectedSince = Date.now();
      }
      const disconnectedMs = Date.now() - gatewayDisconnectedSince;
      if (disconnectedMs > GATEWAY_DISCONNECT_EXIT_AFTER_MS) {
        console.error(
          `[Gateway] Prolonged disconnect, exiting for restart: disconnected for ${Math.round(disconnectedMs / 1000)}s (wsStatus=${wsStatusName}) → Check Discord Gateway status and network connection`,
        );
        // ここで DB 側がハングしても exit できるよう、traceEvent の flush は最大2秒で打ち切る
        await Promise.race([
          traceEvent(`gateway-${Date.now()}`, "gateway.disconnected", "error", {
            wsStatus: wsStatusName,
            disconnectedMs,
            action: "process.exit(1)",
          }),
          new Promise((resolve) => setTimeout(resolve, 2_000)),
        ]);
        process.exit(1);
      }
      await recordHeartbeat("bot", client.user?.id ?? "unknown", "degraded", {
        guildCount: client.guilds.cache.size,
        uptime: process.uptime(),
        wsStatus: wsStatusName,
      });
      return;
    }
    if (gatewayDisconnectedSince !== null) {
      console.log(`[Gateway] Gateway復帰: reconnected (wsStatus=${wsStatusName})`);
      await traceEvent(`gateway-${Date.now()}`, "gateway.reconnected", "info", {
        wsStatus: wsStatusName,
      });
      gatewayDisconnectedSince = null;
    }
    await recordHeartbeat("bot", client.user?.id ?? "unknown", "ok", {
      guildCount: client.guilds.cache.size,
      uptime: process.uptime(),
    });
  }, 120_000);

  // Channel Wipe スケジューラ: 毎日 00:00 GMT+7
  cron.schedule(
    "0 0 * * *",
    async () => {
      console.log("[Wipe] Starting daily channel wipe...");

      const enabledChannels = await db
        .select()
        .from(schema.channelSettings)
        .where(eq(schema.channelSettings.wipeEnabled, true));

      for (const setting of enabledChannels) {
        const discordChannel = client.channels.cache.get(setting.channelId);
        if (!(discordChannel instanceof TextChannel)) continue;

        try {
          const { deletedCount } = await wipeChannel(discordChannel);
          console.log(
            `[Wipe] ${setting.channelId}: ${deletedCount} messages deleted`,
          );
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          console.error(`[Wipe] Channel ${setting.channelId} failed: ${reason} → Check bot permissions (MANAGE_MESSAGES)`);
        }
      }
    },
    {
      timezone: "Asia/Jakarta",
    },
  );

  // OpsJob ポーリング: 30秒ごと
  setInterval(async () => {
    await pollAndExecuteJobs();
  }, 30_000);

  // Log Purge スケジューラ: 毎日 00:10 GMT+7（wipe 00:00 との競合回避）
  cron.schedule(
    "10 0 * * *",
    async () => {
      console.log("[LogPurge] Starting daily log purge...");
      try {
        const result = await purgeOldLogs(env.LOG_RETENTION_DAYS);
        console.log(
          `[LogPurge] Deleted ${result.lookupLogsDeleted} lookup_logs, ${result.botEventsDeleted} bot_events`,
        );
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`[LogPurge] Failed: ${reason} → Check DB connection and LOG_RETENTION_DAYS`);
      }
    },
    {
      timezone: "Asia/Jakarta",
    },
  );

  // Analytics 集計スケジューラ: 3時間おき（00:00, 03:00, 06:00, ... GMT+7）
  cron.schedule(
    "0 */3 * * *",
    async () => {
      console.log("[Analytics] Starting hourly aggregation...");
      try {
        await aggregateHourly();
        console.log("[Analytics] Aggregation complete");
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`[Analytics] Aggregation failed: ${reason} → Check PostgreSQL connection and lookup_logs table`);
      }
    },
    {
      timezone: "Asia/Jakarta",
    },
  );
});

client.on(Events.MessageCreate, messageCreateHandler);
client.on(Events.MessageUpdate, messageUpdateHandler);
client.on(Events.InteractionCreate, interactionCreateHandler);

// Gateway切断の検知: 理由・codeを§17形式でconsole.error + bot_eventsに記録。
// Note: ShardDisconnect は回復不能コード時のみで、通常のネットワーク断は
// ShardReconnecting → ShardResume/ShardReady の順で発火する。復帰検知は
// ShardResume/ShardReady で即時リセットし、heartbeat側のshard statusチェック +
// 5分exitウォッチドッグで取りこぼしを担保する。
client.on(Events.ShardDisconnect, (closeEvent, shardId) => {
  if (gatewayDisconnectedSince === null) {
    gatewayDisconnectedSince = Date.now();
  }
  const code = closeEvent.code;
  const hint =
    code === 4014
      ? "Enable required Privileged Gateway Intents in Discord Developer Portal → Bot → Privileged Gateway Intents"
      : code === 4004
        ? "Check .env DISCORD_TOKEN"
        : "Check Discord Gateway status and network connection";
  console.error(
    `[Gateway] Shard disconnected: shard ${shardId} code ${code} → ${hint}`,
  );
  void traceEvent(`gateway-${Date.now()}`, "gateway.disconnected", "error", {
    shardId,
    code,
    wsStatus: getShardStatusName(),
  });
});

// 通常のネットワーク断はこちらが発火する（ShardDisconnect は回復不能コード時のみ）。
client.on(Events.ShardReconnecting, (shardId) => {
  if (gatewayDisconnectedSince === null) {
    gatewayDisconnectedSince = Date.now();
  }
  const wsStatusName = getShardStatusName();
  console.warn(
    `[Gateway] Shard reconnecting: shard ${shardId} (wsStatus=${wsStatusName}) → Check Discord Gateway status and network connection`,
  );
  void traceEvent(`gateway-${Date.now()}`, "gateway.disconnected", "warn", {
    shardId,
    wsStatus: wsStatusName,
  });
});

function handleShardRecovered(event: string, shardId: number): void {
  const wsStatusName = getShardStatusName();
  if (gatewayDisconnectedSince !== null) {
    console.log(`[Gateway] Gateway復帰: ${event} shard ${shardId} (wsStatus=${wsStatusName})`);
    void traceEvent(`gateway-${Date.now()}`, "gateway.reconnected", "info", {
      event,
      shardId,
      wsStatus: wsStatusName,
    });
    gatewayDisconnectedSince = null;
  }
}

client.on(Events.ShardResume, (shardId) => {
  handleShardRecovered("resume", shardId);
});

client.on(Events.ShardReady, (shardId) => {
  handleShardRecovered("ready", shardId);
});

client.on(Events.ShardError, (error, shardId) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    `[Gateway] Shard error: shard ${shardId}: ${message} → Check Discord Gateway status and network connection`,
  );
  void traceEvent(`gateway-${Date.now()}`, "gateway.error", "error", {
    shardId,
    error: message,
    wsStatus: getShardStatusName(),
  });
});

client.login(env.DISCORD_TOKEN).catch((err) => {
  const message = parseLoginError(err);
  console.error(message);
  process.exit(1);
});

function parseLoginError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);

  // @discordjs/ws: close code 4014 — intent exists but not enabled in Developer Portal
  // Note: MessageContent は要求対象外のため、この分岐は他 intent 用の保険として残す。
  if (msg.includes("disallowed intents")) {
    return [
      "❌ Login failed: Discord Gateway Intents が有効になっていません。",
      "",
      "   Go to: https://discord.com/developers/applications",
      "   Select your Bot → Bot → Privileged Gateway Intents",
      "   Enable: MESSAGE CONTENT INTENT (and GUILD_MEMBERS if needed)",
      "",
      "   Then restart the bot.",
    ].join("\n");
  }

  // @discordjs/ws: close code 4013 — intent constant doesn't exist
  if (msg.includes("invalid intents")) {
    return [
      "❌ Login failed: 不正な Intent 値が指定されています。",
      "",
      "   コード内の GatewayIntentBits の指定を確認してください。",
    ].join("\n");
  }

  // @discordjs/ws: close code 4004 — wrong token
  if (msg.includes("Authentication failed")) {
    return [
      "❌ Login failed: Discord Bot Token が間違っています。",
      "",
      "   Check: .env の DISCORD_TOKEN",
      "   Reset: Discord Developer Portal → Bot → Reset Token",
    ].join("\n");
  }

  // discord.js Messages.js / older versions fallback
  if (msg.includes("invalid token") || msg.includes("Incorrect login details")) {
    return [
      "❌ Login failed: Discord Bot Token が間違っています。",
      "",
      "   Check .env DISCORD_TOKEN or reset at:",
      "   Discord Developer Portal → Bot → Reset Token",
    ].join("\n");
  }

  if (
    msg.includes("ECONNREFUSED") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("ETIMEDOUT")
  ) {
    return [
      "❌ Login failed: Cannot connect to Discord.",
      "",
      "   Check your network connection and proxy settings.",
    ].join("\n");
  }

  // Unknown error: print raw message for debugging
  return `❌ Login failed: ${msg}`;
}
