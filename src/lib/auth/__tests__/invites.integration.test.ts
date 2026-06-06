import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let invites: typeof import('../invites');

beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vane-invites-'));
  mkdirSync(path.join(dir, 'data'), { recursive: true });
  cpSync('drizzle', path.join(dir, 'drizzle'), { recursive: true });
  process.env.DATA_DIR = dir;
  execFileSync('npx', ['tsx', 'src/lib/db/migrate.ts'], {
    env: { ...process.env, DATA_DIR: dir },
    stdio: 'inherit',
  });
  invites = await import('../invites');
});

describe('invite repository', () => {
  it('creates an invite and returns the raw token only once', async () => {
    const { rawToken, invite } = await invites.createInvite({
      role: 'user', ttlHours: 48, createdBy: 'admin-1',
    });
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(invite.role).toBe('user');
    expect(invite.usedAt).toBeNull();
  });

  it('validates a fresh token and rejects unknown/expired/used', async () => {
    const { rawToken } = await invites.createInvite({ role: 'user', ttlHours: 48, createdBy: 'a' });
    expect((await invites.validateInvite(rawToken)).valid).toBe(true);
    expect((await invites.validateInvite('not-a-real-token')).valid).toBe(false);
    const { rawToken: expiredTok } = await invites.createInvite({ role: 'user', ttlHours: -1, createdBy: 'a' });
    expect((await invites.validateInvite(expiredTok)).valid).toBe(false);
  });

  it('consumes single-use: second consume of the same token fails', async () => {
    const { rawToken } = await invites.createInvite({ role: 'admin', ttlHours: 48, createdBy: 'a' });
    const first = await invites.consumeInvite(rawToken, 'new-user-1');
    expect(first.ok).toBe(true);
    expect(first.role).toBe('admin');
    const second = await invites.consumeInvite(rawToken, 'new-user-2');
    expect(second.ok).toBe(false);
  });

  it('lists invites and revokes', async () => {
    const { invite } = await invites.createInvite({ role: 'user', ttlHours: 48, createdBy: 'a' });
    const list = await invites.listInvites();
    expect(list.find((i) => i.id === invite.id)).toBeTruthy();
    await invites.revokeInvite(invite.id);
    const after = await invites.validateInviteById(invite.id);
    expect(after?.usedAt).not.toBeNull();
  });
});
