import { describe, it, expect } from 'vitest';
import { canViewChat, isChatOwner } from '../chatAccess';

const owned = { userId: 'me', shared: false };
const sharedByOther = { userId: 'other', shared: true };
const privateOther = { userId: 'other', shared: false };
const orphan = { userId: null, shared: false };

describe('chat access predicates', () => {
  it('owner can view and owns', () => {
    expect(canViewChat(owned, 'me')).toBe(true);
    expect(isChatOwner(owned, 'me')).toBe(true);
  });

  it('a shared chat is viewable by a non-owner but not owned', () => {
    expect(canViewChat(sharedByOther, 'me')).toBe(true);
    expect(isChatOwner(sharedByOther, 'me')).toBe(false);
  });

  it('a private chat of another user is neither viewable nor owned', () => {
    expect(canViewChat(privateOther, 'me')).toBe(false);
    expect(isChatOwner(privateOther, 'me')).toBe(false);
  });

  it('an orphan chat (null owner) is not viewable by a regular user', () => {
    expect(canViewChat(orphan, 'me')).toBe(false);
    expect(isChatOwner(orphan, 'me')).toBe(false);
  });
});
