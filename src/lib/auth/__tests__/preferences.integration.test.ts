import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let users: typeof import('../users');

beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vane-prefs-'));
  mkdirSync(path.join(dir, 'data'), { recursive: true });
  cpSync('drizzle', path.join(dir, 'drizzle'), { recursive: true });
  process.env.DATA_DIR = dir;
  execFileSync('npx', ['tsx', 'src/lib/db/migrate.ts'], { env: { ...process.env, DATA_DIR: dir }, stdio: 'inherit' });
  users = await import('../users');
});

describe('user preferences', () => {
  it('defaults to empty and merges on update', async () => {
    const u = await users.createUser({ username: 'p', password: 'password-1234', role: 'user' });
    expect(await users.getUserPreferences(u.id)).toEqual({});

    await users.setUserPreferences(u.id, { chatModelKey: 'gpt-4o', chatModelProviderId: 'pid' });
    expect(await users.getUserPreferences(u.id)).toEqual({ chatModelKey: 'gpt-4o', chatModelProviderId: 'pid' });

    await users.setUserPreferences(u.id, { systemInstructions: 'be terse' });
    expect(await users.getUserPreferences(u.id)).toEqual({
      chatModelKey: 'gpt-4o', chatModelProviderId: 'pid', systemInstructions: 'be terse',
    });
  });
});
