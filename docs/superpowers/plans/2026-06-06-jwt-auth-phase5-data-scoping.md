# JWT Auth — Phase 5: Per-User Data Scoping + Shareable Chats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every chat private to its owner — each user sees and controls only their own chats and history — while letting an owner mark a chat **shared** so any logged-in user can view it read-only.

**Architecture:** A tiny pure `chatAccess` module encodes the view/mutate decisions and is unit-tested. Every chat/message route resolves the caller via `getAuthUser` and applies those predicates: list is owner-filtered; reading a chat is allowed for the owner OR a shared chat (404 otherwise, to avoid existence leaks); creating sets ownership; mutating (delete, share-toggle, appending messages) is owner-only. A new share-toggle endpoint flips the flag. The frontend surfaces a read-only banner for non-owner shared chats and a share control for owners.

**Tech Stack:** TypeScript, Next.js 16, Drizzle + better-sqlite3, `vitest`, React.

---

## Dependencies on Phases 1-4 (reuse, do not reimplement)

- `src/lib/auth/getAuthUser.ts` — `getAuthUser(req): Promise<AuthUser | null>` (reads the access cookie; routes are already middleware-guarded so a user is present, but routes must still resolve *which* user).
- DB columns (Phase 1): `chats.userId` (text, nullable — backfilled to the admin for pre-existing chats by Phase 2 `claimOrphanChats`), `chats.shared` (bool, default false).
- Existing chat routes: `src/app/api/chats/route.ts` (GET list), `src/app/api/chats/[id]/route.ts` (GET + DELETE), `src/app/api/chat/route.ts` (POST stream; `ensureChatExists` creates the chat).
- Frontend: `src/lib/hooks/useChat.tsx` (loads `/api/chats/[id]`), `src/components/Chat.tsx` (renders `<MessageInput />`), `src/components/Navbar.tsx` (chat header; already imports a `Share` icon).

Spec: `docs/superpowers/specs/2026-06-06-jwt-auth-multiuser-design.md` (§7).

**No DB migration is needed** — the columns already exist.

---

## Security model (enforced server-side)

- **List** (`GET /api/chats`): only `userId == me`.
- **Read** (`GET /api/chats/:id`): allowed if `userId == me` OR `shared == true`; otherwise **404** (not 403 — don't leak that the chat exists). Response includes `readOnly = userId != me`.
- **Create / append** (`POST /api/chat`): a new chat is owned by the caller; appending to an existing chat requires `userId == me` (a non-owner cannot write to a shared chat).
- **Delete / rename / share-toggle** (`/api/chats/:id`): owner-only; non-owner → 404.
- Messages inherit scope via their `chatId` (no direct `userId`).

---

## File Structure (Phase 5)

- Create `src/lib/auth/chatAccess.ts` — pure `canViewChat` / `isChatOwner` predicates.
- Modify `src/app/api/chats/route.ts` — owner-filtered list.
- Modify `src/app/api/chats/[id]/route.ts` — scoped GET (+`readOnly`), owner-only DELETE, add owner-only PATCH (share toggle).
- Modify `src/app/api/chat/route.ts` — set `userId` on create; reject non-owner append.
- Modify `src/lib/hooks/useChat.tsx` — capture `readOnly`/`shared`; add `toggleShared`.
- Modify `src/components/Chat.tsx` — read-only banner instead of input when `readOnly`.
- Modify `src/components/Navbar.tsx` — owner share toggle (copies link).
- Modify `docs/API/SEARCH.md` — note the per-user scoping + sharing behavior.

---

## Task 1: Pure chat-access predicates

**Files:**
- Create `src/lib/auth/chatAccess.ts`
- Test `src/lib/auth/__tests__/chatAccess.test.ts`

- [ ] **Step 1: Write the failing test** — `src/lib/auth/__tests__/chatAccess.test.ts`:

```ts
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
```

- [ ] **Step 2: Run, verify FAIL.** `yarn vitest run src/lib/auth/__tests__/chatAccess.test.ts`.

- [ ] **Step 3: Implement** — `src/lib/auth/chatAccess.ts`:

```ts
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
```

- [ ] **Step 4: Run, verify PASS** (4 tests). `yarn tsc --noEmit` (exit 0).

- [ ] **Step 5: Commit.**

```bash
git add src/lib/auth/chatAccess.ts src/lib/auth/__tests__/chatAccess.test.ts
git commit -m "feat(chats): add pure chat view/owner access predicates"
```

---

## Task 2: Owner-filtered chat list

**Files:**
- Modify `src/app/api/chats/route.ts`

- [ ] **Step 1: Read** `src/app/api/chats/route.ts`. It currently does `db.query.chats.findMany()` then reverses, with no auth.

- [ ] **Step 2: Replace its contents** with an owner-scoped version:

```ts
import { NextRequest } from 'next/server';
import { eq, desc } from 'drizzle-orm';
import db from '@/lib/db';
import { chats } from '@/lib/db/schema';
import { getAuthUser } from '@/lib/auth/getAuthUser';

export const runtime = 'nodejs';

export const GET = async (req: NextRequest) => {
  try {
    const user = await getAuthUser(req);
    if (!user) {
      return Response.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const userChats = await db
      .select()
      .from(chats)
      .where(eq(chats.userId, user.id))
      .orderBy(desc(chats.createdAt));

    return Response.json({ chats: userChats }, { status: 200 });
  } catch (err) {
    console.error('Error in getting chats: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
```

> Note: the original reversed `findMany()` to get newest-first; `orderBy(desc(chats.createdAt))` preserves that intent. `createdAt` is an ISO string, so lexicographic desc == chronological desc.

- [ ] **Step 3: Typecheck.** `yarn tsc --noEmit` → exit 0.

- [ ] **Step 4: Commit.**

```bash
git add src/app/api/chats/route.ts
git commit -m "feat(chats): scope chat list to the authenticated owner"
```

---

## Task 3: Scoped chat read + owner-only delete + share toggle

**Files:**
- Modify `src/app/api/chats/[id]/route.ts`

- [ ] **Step 1: Replace the contents** of `src/app/api/chats/[id]/route.ts` with the scoped version (GET allows owner-or-shared and returns `readOnly`; DELETE is owner-only; PATCH toggles `shared`, owner-only):

```ts
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import db from '@/lib/db';
import { chats, messages } from '@/lib/db/schema';
import { getAuthUser } from '@/lib/auth/getAuthUser';
import { canViewChat, isChatOwner } from '@/lib/auth/chatAccess';

export const runtime = 'nodejs';

export const GET = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const user = await getAuthUser(req);
    if (!user) return Response.json({ message: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const chat = await db.query.chats.findFirst({ where: eq(chats.id, id) });

    // 404 (not 403) when not viewable, so we don't leak chat existence.
    if (!chat || !canViewChat(chat, user.id)) {
      return Response.json({ message: 'Chat not found' }, { status: 404 });
    }

    const chatMessages = await db.query.messages.findMany({
      where: eq(messages.chatId, id),
    });

    return Response.json(
      {
        chat,
        messages: chatMessages,
        readOnly: !isChatOwner(chat, user.id),
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('Error in getting chat by id: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};

export const DELETE = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const user = await getAuthUser(req);
    if (!user) return Response.json({ message: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const chat = await db.query.chats.findFirst({ where: eq(chats.id, id) });

    // Non-owners (incl. viewers of a shared chat) get 404, not 403.
    if (!chat || !isChatOwner(chat, user.id)) {
      return Response.json({ message: 'Chat not found' }, { status: 404 });
    }

    await db.delete(chats).where(eq(chats.id, id)).execute();
    await db.delete(messages).where(eq(messages.chatId, id)).execute();

    return Response.json({ message: 'Chat deleted successfully' }, { status: 200 });
  } catch (err) {
    console.error('Error in deleting chat by id: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};

const patchSchema = z.object({ shared: z.boolean() });

export const PATCH = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const user = await getAuthUser(req);
    if (!user) return Response.json({ message: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const chat = await db.query.chats.findFirst({ where: eq(chats.id, id) });
    if (!chat || !isChatOwner(chat, user.id)) {
      return Response.json({ message: 'Chat not found' }, { status: 404 });
    }

    const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json({ message: 'shared (boolean) required.' }, { status: 400 });
    }

    await db.update(chats).set({ shared: parsed.data.shared }).where(eq(chats.id, id));
    return Response.json({ ok: true, shared: parsed.data.shared }, { status: 200 });
  } catch (err) {
    console.error('Error updating chat: ', err);
    return Response.json({ message: 'An error has occurred.' }, { status: 500 });
  }
};
```

- [ ] **Step 2: Typecheck.** `yarn tsc --noEmit` → exit 0.

- [ ] **Step 3: Commit.**

```bash
git add 'src/app/api/chats/[id]/route.ts'
git commit -m "feat(chats): scope chat read/delete to owner-or-shared and add share toggle"
```

---

## Task 4: Ownership on create + reject non-owner append

**Files:**
- Modify `src/app/api/chat/route.ts`

The streaming POST creates a chat (via `ensureChatExists`) on the first message and appends on later messages. It must (a) stamp `userId` on creation and (b) refuse to let a non-owner append to an existing chat.

- [ ] **Step 1: Read** `src/app/api/chat/route.ts`. Note `ensureChatExists({ id, sources, query, fileIds })` and the `POST` handler that validates the body, starts the agent, calls `ensureChatExists`, and streams.

- [ ] **Step 2: Resolve the user early in `POST`** and pass ownership through. Add the imports at the top:

```ts
import { NextRequest } from 'next/server';
import { getAuthUser } from '@/lib/auth/getAuthUser';
import { isChatOwner } from '@/lib/auth/chatAccess';
```

Change the handler signature to `export const POST = async (req: NextRequest) => {` (it is currently `Request`). Immediately after `const body = parseBody.data as Body;` (i.e. once the chatId is known), add an ownership guard:

```ts
    const user = await getAuthUser(req);
    if (!user) {
      return Response.json({ message: 'Unauthorized' }, { status: 401 });
    }

    // If the chat already exists, only its owner may append to it.
    const existingChat = await db.query.chats.findFirst({
      where: eq(chats.id, message.chatId),
    });
    if (existingChat && !isChatOwner(existingChat, user.id)) {
      return Response.json({ message: 'Chat not found' }, { status: 404 });
    }
```

(`eq`, `chats`, `db` are already imported in this file.)

- [ ] **Step 3: Thread `userId` into `ensureChatExists`.** Change its signature + insert to record the owner:

```ts
const ensureChatExists = async (input: {
  id: string;
  sources: SearchSources[];
  query: string;
  fileIds: string[];
  userId: string;
}) => {
  try {
    const exists = await db.query.chats
      .findFirst({ where: eq(chats.id, input.id) })
      .execute();

    if (!exists) {
      await db.insert(chats).values({
        id: input.id,
        userId: input.userId,
        createdAt: new Date().toISOString(),
        sources: input.sources,
        title: input.query,
        files: input.fileIds.map((id) => ({
          fileId: id,
          name: UploadManager.getFile(id)?.name || 'Uploaded File',
        })),
      });
    }
  } catch (err) {
    console.error('Failed to check/save chat:', err);
  }
};
```

And update the call site to pass `userId: user.id`:

```ts
    ensureChatExists({
      id: body.message.chatId,
      sources: body.sources as SearchSources[],
      fileIds: body.files,
      query: body.message.content,
      userId: user.id,
    });
```

- [ ] **Step 4: Typecheck.** `yarn tsc --noEmit` → exit 0.

- [ ] **Step 5: Commit.**

```bash
git add src/app/api/chat/route.ts
git commit -m "feat(chats): stamp owner on chat creation and block non-owner append"
```

---

## Task 5: Surface read-only + share state in the chat hook

**Files:**
- Modify `src/lib/hooks/useChat.tsx`

- [ ] **Step 1: Read** `src/lib/hooks/useChat.tsx`. Locate: the `ChatContext` type (around lines 40-62), the `loadMessages` function (around line 174, which `fetch`es `/api/chats/${chatId}`), the provider state declarations, and the context `value` object near the bottom.

- [ ] **Step 2: Add context fields.** In the `ChatContext` type, add:

```ts
  readOnly: boolean;
  shared: boolean;
  toggleShared: () => Promise<void>;
```

- [ ] **Step 3: Add provider state.** Where other `useState` hooks are declared in the provider, add:

```tsx
  const [readOnly, setReadOnly] = useState(false);
  const [shared, setShared] = useState(false);
```

- [ ] **Step 4: Set them when a chat loads.** `loadMessages` already destructures `data` from the `/api/chats/:id` response. After `const data = await res.json();`, add:

```tsx
  setReadOnly(Boolean(data.readOnly));
  setShared(Boolean(data.chat?.shared));
```

Pass `setReadOnly`/`setShared` into `loadMessages` (add them as parameters, matching how the other setters like `setNotFound` are threaded), and supply them at the call site. (Follow the exact threading pattern already used for `setNotFound`/`setFiles`.)

- [ ] **Step 5: Add the `toggleShared` action** inside the provider (near `sendMessage`):

```tsx
  const toggleShared = async () => {
    if (!chatId) return;
    const next = !shared;
    try {
      const res = await fetch(`/api/chats/${chatId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shared: next }),
      });
      if (!res.ok) throw new Error('Failed to update sharing');
      setShared(next);
    } catch {
      toast.error('Failed to update sharing');
    }
  };
```

(Use the existing `chatId` value the provider already has — it is used by `loadMessages`/`sendMessage`. If `toast` from `sonner` is not yet imported in this file, add `import { toast } from 'sonner';`.)

- [ ] **Step 6: Expose them in the context `value`.** Add `readOnly`, `shared`, `toggleShared` to the object passed to the provider, and to any default-context stub (the one that has `sendMessage: async () => {}`), e.g. `readOnly: false, shared: false, toggleShared: async () => {}`.

- [ ] **Step 7: Typecheck + build.** `yarn tsc --noEmit` (exit 0) and `yarn build 2>&1 | tail -15` (completes).

- [ ] **Step 8: Commit.**

```bash
git add src/lib/hooks/useChat.tsx
git commit -m "feat(chats): expose readOnly/shared state and share toggle in chat hook"
```

---

## Task 6: Read-only banner in the chat view

**Files:**
- Modify `src/components/Chat.tsx`

- [ ] **Step 1: Read** `src/components/Chat.tsx`. It renders `<MessageInput />` (around line 101).

- [ ] **Step 2: Gate the input on `readOnly`.** Pull `readOnly` from the hook (`const { readOnly /* , ...existing */ } = useChat();` — if the component already destructures `useChat()`, add `readOnly` to it; otherwise add the import `import { useChat } from '@/lib/hooks/useChat';` and the destructure). Replace the `<MessageInput />` render with:

```tsx
          {readOnly ? (
            <div className="w-full max-w-screen-md mx-auto px-4 py-4 text-center text-sm text-black/60 dark:text-white/60 border-t border-light-200 dark:border-dark-200">
              You are viewing a shared chat. It is read-only.
            </div>
          ) : (
            <MessageInput />
          )}
```

(Keep the surrounding layout/markup exactly as-is; only swap the single `<MessageInput />` element for the conditional above.)

- [ ] **Step 3: Typecheck + build.** `yarn tsc --noEmit` (exit 0), `yarn build 2>&1 | tail -10`.

- [ ] **Step 4: Commit.**

```bash
git add src/components/Chat.tsx
git commit -m "feat(chats): show read-only banner instead of input on shared chats"
```

---

## Task 7: Share toggle control in the navbar

**Files:**
- Modify `src/components/Navbar.tsx`

- [ ] **Step 1: Read** `src/components/Navbar.tsx`. It already imports `Share` from `lucide-react` and uses `useChat`.

- [ ] **Step 2: Add a share toggle button** visible only to the owner (i.e. when `!readOnly`). Pull `readOnly`, `shared`, `toggleShared` from `useChat()`. Add a button near the existing header actions (next to the export/delete controls) that, for owners, toggles sharing and — when enabling — copies the share link:

```tsx
        {!readOnly && (
          <button
            onClick={async () => {
              await toggleShared();
              if (!shared) {
                // was off, now on → copy the link
                try {
                  await navigator.clipboard.writeText(window.location.href);
                  toast.success('Sharing on — link copied');
                } catch {
                  toast.success('Sharing enabled');
                }
              } else {
                toast.success('Sharing disabled');
              }
            }}
            className="p-2 rounded-lg text-black/70 dark:text-white/70 hover:bg-light-secondary dark:hover:bg-dark-secondary"
            title={shared ? 'Sharing on — click to disable' : 'Share this chat'}
            aria-label="Toggle chat sharing"
          >
            <Share className={shared ? 'text-[#24A0ED]' : ''} size={17} />
          </button>
        )}
```

(If `toast` from `sonner` isn't imported in Navbar, add it. Match the existing button styling/sizing used by the other Navbar action icons — adjust `size`/classes to match neighbors if they differ. `window.location.href` is the chat URL the invitee/viewer would open.)

- [ ] **Step 3: Typecheck + build.** `yarn tsc --noEmit` (exit 0), `yarn build 2>&1 | tail -10` (completes; `/c/[chatId]` route present).

- [ ] **Step 4: Commit.**

```bash
git add src/components/Navbar.tsx
git commit -m "feat(chats): add owner share toggle to the chat navbar"
```

---

## Task 8: Documentation

**Files:**
- Modify `docs/API/SEARCH.md`

- [ ] **Step 1: Add a short "Access & Sharing" note** to `docs/API/SEARCH.md` (and/or the chat endpoints if documented there) stating:
  - All chat endpoints require an authenticated session (cookie); see `AUTH.md`.
  - Chats are private to their owner. `GET /api/chats` lists only the caller's chats.
  - `GET /api/chats/:id` returns a chat if the caller owns it or it is shared; otherwise 404. The response includes `readOnly: boolean` (true when the caller is not the owner).
  - `PATCH /api/chats/:id` with `{ shared: boolean }` (owner only) toggles sharing; a shared chat is viewable read-only by any logged-in user via its URL.
  - `DELETE /api/chats/:id` and appending messages via `POST /api/chat` are owner-only.

- [ ] **Step 2: Commit.**

```bash
git add docs/API/SEARCH.md
git commit -m "docs(api): document per-user chat scoping and sharing"
```

---

## Task 9: Full suite green + smoke test

**Files:** none (verification only)

- [ ] **Step 1: Suite + typecheck.** `yarn test` (all prior + new `chatAccess` tests pass) and `yarn tsc --noEmit` (exit 0).

- [ ] **Step 2: Smoke test** against a throwaway `DATA_DIR` dev server (same pattern as prior phases). Bootstrap admin, invite + accept a second user (`bob`) — reuse the Phase 3 invite flow — then:

```bash
# As admin: create a chat by asking a question via /api/chat (or insert a chat row through the UI).
# Simpler for the smoke: create a chat row directly is not possible via API without streaming,
# so drive it through /api/chat with a minimal valid body, OR assert scoping with two users:

# 1. Admin lists chats → only admin's chats.
curl -s -b /tmp/admin.cookies localhost:3111/api/chats -w '\n[%{http_code}]\n'
# 2. Bob lists chats → only bob's (empty if none) — must NOT include admin's.
curl -s -b /tmp/bob.cookies localhost:3111/api/chats -w '\n[%{http_code}]\n'
# 3. Bob GETs one of admin's private chat ids → 404.
curl -s -b /tmp/bob.cookies localhost:3111/api/chats/<ADMIN_CHAT_ID> -w '\n[%{http_code}]\n'
# 4. Admin shares it: PATCH {shared:true} → 200.
curl -s -b /tmp/admin.cookies -X PATCH localhost:3111/api/chats/<ADMIN_CHAT_ID> \
  -H 'Content-Type: application/json' -d '{"shared":true}' -w '\n[%{http_code}]\n'
# 5. Bob GETs it now → 200 with readOnly:true.
curl -s -b /tmp/bob.cookies localhost:3111/api/chats/<ADMIN_CHAT_ID> -w '\n[%{http_code}]\n'
# 6. Bob tries to DELETE it → 404 (owner-only).
curl -s -b /tmp/bob.cookies -X DELETE localhost:3111/api/chats/<ADMIN_CHAT_ID> -w '\n[%{http_code}]\n'
# 7. Bob tries to append via /api/chat with that chatId → 404.
# 8. Admin un-shares (PATCH {shared:false}) → Bob GET → 404 again.
```

To obtain an `ADMIN_CHAT_ID`, drive one real message through the UI/`/api/chat` as admin first (the stream creates the chat), then read `GET /api/chats` to get its id. Record actual results — all scoping assertions must hold. Stop the dev server and remove the temp dir after; only kill the server you started.

- [ ] **Step 3: Commit (only if fixes were needed).**

```bash
git add -A
git commit -m "test(chats): verify per-user scoping and sharing"
```

---

## Self-Review Notes

- **Spec coverage (§7):** per-user isolation on list/read/delete ✓; create stamps owner ✓; non-owner cannot append ✓; shared chats viewable read-only by any logged-in user ✓; owner-only share toggle ✓; 404 (not 403) for non-viewable to avoid existence leaks ✓; read-only UI + share control ✓; docs ✓.
- **Type consistency:** `canViewChat`/`isChatOwner` take `{userId, shared}` (a subset of the chat row, which has both columns); the GET response's `readOnly` is `!isChatOwner`; the hook reads `data.readOnly`/`data.chat.shared`; PATCH body `{shared:boolean}`.
- **Security:** every route resolves the caller via `getAuthUser` and applies the predicates server-side (the middleware already blocks unauthenticated callers, but routes still scope by user — defence-in-depth). Delete/append/share are owner-only; reads of others' private chats 404.
- **Closes the Phase-2 carryover:** "data routes are coarse-guarded but not user-scoped" — this phase makes them user-scoped.
- **`/api/reconnect/:backendId` — FIXED in this phase (post-review).** The final review found this endpoint streamed any in-memory session by id with no ownership check, and GET `/api/chats/:id` discloses the `backendId` to shared-chat viewers — letting a non-owner attach to the owner's live answer stream. Fixed: reconnect now resolves the chat behind the `backendId` (via the `messages` row) and requires `isChatOwner`; unknown ids 404 before touching the session. The owner's own reconnect still works because the agent writes the message row before any stream emit.
- **Watch-list to Phase 6:** `src/lib/agents/search/index.ts` writes/deletes messages keyed only on `chatId`/`messageId` with no scope check — currently safe because its only caller (`POST /api/chat`) enforces ownership first, but the invariant lives in the route, not the write layer. Push the owner check down (or document it) in Phase 6. The orphan-chat case (`userId == null`) is only reachable on a pre-Phase-2 upgrade before the admin claim ran; `claimOrphanChats` handles it at bootstrap.
- **No placeholders:** backend steps contain complete code; frontend steps (Tasks 5-7) give complete snippets plus exact insertion sites and instruct reading the file first, since they weave into existing large components.
