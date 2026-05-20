export interface EditedLookupMessageLike {
  partial?: boolean;
  content?: string | null;
  mentions?: {
    has(botId: string): boolean;
  };
}

export function shouldReprocessEditedMention(
  oldMessage: EditedLookupMessageLike | null | undefined,
  newMessage: EditedLookupMessageLike | null | undefined,
  botId: string,
): boolean {
  if (!oldMessage || !newMessage) return false;
  if (oldMessage.partial === true || newMessage.partial === true) return false;
  if (typeof oldMessage.content !== "string" || typeof newMessage.content !== "string") return false;

  const oldMentioned = oldMessage.mentions?.has(botId) === true;
  const newMentioned = newMessage.mentions?.has(botId) === true;

  return !oldMentioned && newMentioned;
}
