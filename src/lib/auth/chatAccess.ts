export interface ChatScope {
  userId: string | null;
  shared: boolean;
}

// A user may VIEW a chat they own, or any chat flagged shared.
export const canViewChat = (chat: ChatScope, userId: string): boolean =>
  chat.userId === userId || chat.shared === true;

// Only the owner may MUTATE (delete, rename, share-toggle, append messages).
export const isChatOwner = (chat: ChatScope, userId: string): boolean =>
  chat.userId !== null && chat.userId === userId;
