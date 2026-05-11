import { env } from "./config/env.js";
import { Client, GatewayIntentBits, Events, TextChannel } from "discord.js";
import cron from "node-cron";
import { eq } from "drizzle-orm";
import { db, schema } from "@grkd-jisho/db";
import { messageCreateHandler } from "./events/messageCreate.js";
import { interactionCreateHandler } from "./events/interactionCreate.js";
import { recordHeartbeat } from "./services/observability.service.js";
import { wipeChannel } from "./services/channel-wipe.service.js";
import { pollAndExecuteJobs } from "./services/ops-job.service.js";
import { purgeOldLogs } from "./services/log-purge.service.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once("ready", () => {
  console.log(`Bot logged in as ${client.user?.tag}`);
  console.log("Prompt source: active prompt row in DB");

  // 2分ごとに heartbeat を送信
  setInterval(async () => {
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
});

client.on(Events.MessageCreate, messageCreateHandler);
client.on(Events.InteractionCreate, interactionCreateHandler);

client.login(env.DISCORD_TOKEN).catch((err) => {
  const message = parseLoginError(err);
  console.error(message);
  process.exit(1);
});

function parseLoginError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);

  // @discordjs/ws: close code 4014 — intent exists but not enabled in Developer Portal
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
