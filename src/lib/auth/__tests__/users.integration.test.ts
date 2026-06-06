import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let users: typeof import('../users');

beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vane-users-'));
  mkdirSync(path.join(dir, 'data'), { recursive: true });
  cpSync('drizzle', path.join(dir, 'drizzle'), { recursive: true });
  process.env.DATA_DIR = dir;
  execFileSync('npx', ['tsx', 'src/lib/db/migrate.ts'], {
    env: { ...process.env, DATA_DIR: dir },
    stdio: 'inherit',
  });
  users = await import('../users');
});

describe('user repository', () => {
  it('counts zero users on a fresh DB', async () => {
    expect(await users.countUsers()).toBe(0);
  });

  it('creates a user and finds it by username', async () => {
    const created = await users.createUser({
      username: 'alice',
      password: 'a-strong-password-123',
      role: 'admin',
    });
    expect(created.id).toBeTruthy();
    expect(created.role).toBe('admin');
    const found = await users.getUserByUsername('alice');
    expect(found?.id).toBe(created.id);
    expect(found?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await users.countUsers()).toBe(1);
  });

  it('rejects a duplicate username', async () => {
    await expect(
      users.createUser({ username: 'alice', password: 'another-pass-123', role: 'user' }),
    ).rejects.toThrow();
  });

  it('claims orphan chats for a user', async () => {
    const db = (await import('@/lib/db')).default;
    const { chats } = await import('@/lib/db/schema');
    await db.insert(chats).values({ id: 'c-orphan', title: 't', createdAt: new Date().toISOString() });
    const admin = await users.getUserByUsername('alice');
    const claimed = await users.claimOrphanChats(admin!.id);
    expect(claimed).toBeGreaterThanOrEqual(1);
    const row = await db.query.chats.findFirst({ where: (c, { eq }) => eq(c.id, 'c-orphan') });
    expect(row?.userId).toBe(admin!.id);
  });
});
