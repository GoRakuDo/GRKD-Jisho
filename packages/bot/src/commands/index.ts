import type { Command } from "./types.js";
import { pingCommand } from "./ping.command.js";
import { searchJishoCommand } from "./search-jisho.command.js";
import { editJishoCommand } from "./edit-jisho.command.js";
import { refreshJishoCommand } from "./refresh-jisho.command.js";
import { sourceJishoCommand } from "./source-jisho.command.js";
import { priorityJishoCommand } from "./priority-jisho.command.js";
import { overrideJishoCommand } from "./override-jisho.command.js";

const commandMap = new Map<string, Command>();

function register(cmd: Command): void {
  const name = cmd.builder.name;
  if (commandMap.has(name)) {
    console.warn(`[Commands] Duplicate registration: "${name}" — overwriting.`);
  }
  commandMap.set(name, cmd);
}

// Step A: ping
register(pingCommand);

// Step B: response 管理コマンド
register(searchJishoCommand);
register(editJishoCommand);
register(refreshJishoCommand);
register(sourceJishoCommand);
register(priorityJishoCommand);
register(overrideJishoCommand);

// Steps C で追加

export { register };
export function getCommand(name: string): Command | undefined {
  return commandMap.get(name);
}
export function getAllCommands(): Command[] {
  return Array.from(commandMap.values());
}
