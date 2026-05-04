import type { Command } from "./types.js";
import { pingCommand } from "./ping.command.js";

const commandMap = new Map<string, Command>();

function register(cmd: Command): void {
  const name = cmd.builder.name;
  if (commandMap.has(name)) {
    console.warn(`[Commands] Duplicate registration: "${name}" — overwriting.`);
  }
  commandMap.set(name, cmd);
}

// Step A: ping コマンドのみ
register(pingCommand);

// Steps B/C で register() を追加

export { register };
export function getCommand(name: string): Command | undefined {
  return commandMap.get(name);
}
export function getAllCommands(): Command[] {
  return Array.from(commandMap.values());
}
