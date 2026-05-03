import { env } from "./config/env.js";
import { Client, GatewayIntentBits } from "discord.js";

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
});

client.login(env.DISCORD_TOKEN).catch((err) => {
  console.error("Failed to login:", err);
  process.exit(1);
});
