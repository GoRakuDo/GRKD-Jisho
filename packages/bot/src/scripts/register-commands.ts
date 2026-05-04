import { REST, Routes } from "discord.js";
import { env } from "../config/env.js";
import { getAllCommands } from "../commands/index.js";

async function main(): Promise<void> {
  const commandData = getAllCommands().map((cmd) => cmd.builder.toJSON());

  console.log(
    `Registering ${commandData.length} guild command(s) for guild ${env.DISCORD_GUILD_ID}...`,
  );

  const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);

  const result = await rest.put(
    Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID),
    { body: commandData },
  );

  console.log(`Successfully registered commands:`, JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("Failed to register commands:", err);
  process.exit(1);
});
