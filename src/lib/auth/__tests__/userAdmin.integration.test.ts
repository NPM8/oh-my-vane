import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let users: typeof import('../users');
let password: typeof import('../password');

beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vane-useradmin-'));
  mkdirSync(path.join(dir, 'data'), { recursive: true });
  cpSync('drizzle', path.join(dir, 'drizzle'), { recursive: true });
  process.env.DATA_DIR = dir;
  execFileSync('npx', ['tsx', 'src/lib/db/migrate.ts'], {
    env: { ...process.env, DATA_DIR: dir },
    stdio: 'inherit',
  });
  users = await import('../users');
  password = await import('../password');
});

describe('user admin repository', () => {
  it('lists users as public shapes (no passwordHash)', async () => {
    await users.createUser({ username: 'u1', password: 'password-1234', role: 'admin' });
    await users.createUser({ username: 'u2', password: 'password-1234', role: 'user' });
    const list = await users.listUsers();
    expect(list.length).toBeGreaterThanOrEqual(2);
    const u1 = list.find((u) => u.username === 'u1')!;
    expect(u1.role).toBe('admin');
    expect((u1 as unknown as Record<string, unknown>).passwordHash).toBeUndefined();
  });

  it('disables and re-enables a user', async () => {
    const u = await users.createUser({ username: 'd1', password: 'password-1234', role: 'user' });
    await users.setUserDisabled(u.id, true);
    expect((await users.getUserById(u.id))?.disabled).toBe(true);
    await users.setUserDisabled(u.id, false);
    expect((await users.getUserById(u.id))?.disabled).toBe(false);
  });

  it('admin-resets a password (sets hash + mustChangePassword)', async () => {
    const u = await users.createUser({ username: 'p1', password: 'password-1234', role: 'user' });
    await users.adminSetPassword(u.id, 'temp-password-9999');
    const row = await users.getUserById(u.id);
    expect(row?.mustChangePassword).toBe(true);
    expect(await password.verifyPassword(row!.passwordHash, 'temp-password-9999')).toBe(true);
  });

  it('changeOwnPassword verifies the current password and clears the flag', async () => {
    const u = await users.createUser({ username: 'c1', password: 'old-password-1234', role: 'user' });
    await users.adminSetPassword(u.id, 'temp-password-9999');
    const bad = await users.changeOwnPassword(u.id, 'wrong', 'new-password-1234');
    expect(bad).toBe(false);
    const ok = await users.changeOwnPassword(u.id, 'temp-password-9999', 'new-password-1234');
    expect(ok).toBe(true);
    const row = await users.getUserById(u.id);
    expect(row?.mustChangePassword).toBe(false);
    expect(await password.verifyPassword(row!.passwordHash, 'new-password-1234')).toBe(true);
  });

  it('deletes a user', async () => {
    const u = await users.createUser({ username: 'del1', password: 'password-1234', role: 'user' });
    await users.deleteUser(u.id);
    expect(await users.getUserById(u.id)).toBeUndefined();
  });
});
