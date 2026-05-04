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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once("ready", () => {
  console.log(`Bot logged in as ${client.user?.tag}`);
  console.log(`Prompt version: ${env.PROMPT_VERSION}`);

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
          console.error(`[Wipe] Failed channel ${setting.channelId}:`, err);
        }
      }
    },
    {
      timezone: "Asia/Bangkok",
    },
  );

  // OpsJob ポーリング: 30秒ごと
  setInterval(async () => {
    await pollAndExecuteJobs();
  }, 30_000);
});

client.on(Events.MessageCreate, messageCreateHandler);
client.on(Events.InteractionCreate, interactionCreateHandler);

client.login(env.DISCORD_TOKEN).catch((err) => {
  console.error("Failed to login:", err);
  process.exit(1);
});
