import { type Message, type PartialMessage } from "discord.js";
import { hasLookupLogForMessage } from "../services/lookup-log.service.js";
import { shouldReprocessEditedMention } from "../services/message-update.service.js";
import { messageCreateHandler } from "./messageCreate.js";

type EditedMessage = Message<boolean> | PartialMessage<boolean> | null;
type UpdatedMessage = Message<boolean>;

const activeEditedMessageIds = new Set<string>();

export const messageUpdateHandler = async (
  oldMessage: EditedMessage,
  newMessage: UpdatedMessage,
): Promise<void> => {
  if (activeEditedMessageIds.has(newMessage.id)) return;

  activeEditedMessageIds.add(newMessage.id);
  try {
    if (newMessage.guildId === null) return;

    const botId = newMessage.client.user?.id;
    if (!botId) return;

    if (!shouldReprocessEditedMention(oldMessage, newMessage, botId)) return;

    if (await hasLookupLogForMessage(newMessage.id)) return;

    if (newMessage.author.bot) return;

    await messageCreateHandler(newMessage);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[messageUpdate] Failed: ${reason} → Check logs for details`);
  } finally {
    activeEditedMessageIds.delete(newMessage.id);
  }
};
