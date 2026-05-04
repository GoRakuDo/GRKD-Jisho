import { env } from "./config/env.js";
import { Client, GatewayIntentBits, Events } from "discord.js";
import { messageCreateHandler } from "./events/messageCreate.js";
import { recordHeartbeat } from "./services/observability.service.js";

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
});

client.on(Events.MessageCreate, messageCreateHandler);

client.login(env.DISCORD_TOKEN).catch((err) => {
  console.error("Failed to login:", err);
  process.exit(1);
});
