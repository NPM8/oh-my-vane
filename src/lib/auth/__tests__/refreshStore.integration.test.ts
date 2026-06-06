import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hashToken } from '../tokens';

let store: typeof import('../refreshStore');

beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vane-refresh-'));
  mkdirSync(path.join(dir, 'data'), { recursive: true });
  cpSync('drizzle', path.join(dir, 'drizzle'), { recursive: true });
  process.env.DATA_DIR = dir;
  execFileSync('npx', ['tsx', 'src/lib/db/migrate.ts'], {
    env: { ...process.env, DATA_DIR: dir },
    stdio: 'inherit',
  });
  store = await import('../refreshStore');
});

describe('refresh store', () => {
  it('saves and finds a refresh row by token hash', async () => {
    await store.saveRefresh({
      id: 'r1',
      userId: 'u1',
      tokenHash: hashToken('raw-token-1'),
      expiresAt: new Date(Date.now() + 1000).toISOString(),
    });
    const found = await store.findRefreshByToken('raw-token-1');
    expect(found?.id).toBe('r1');
    expect(found?.revokedAt).toBeNull();
  });

  it('rotates: revokes old row pointing to the new one', async () => {
    await store.saveRefresh({
      id: 'r2',
      userId: 'u1',
      tokenHash: hashToken('raw-token-2'),
      expiresAt: new Date(Date.now() + 1000).toISOString(),
    });
    await store.revokeRefresh('r2', 'r3');
    const found = await store.findRefreshByToken('raw-token-2');
    expect(found?.revokedAt).not.toBeNull();
    expect(found?.replacedBy).toBe('r3');
  });

  it('revokes the whole chain for a user (reuse response)', async () => {
    await store.saveRefresh({
      id: 'r4',
      userId: 'u2',
      tokenHash: hashToken('raw-token-4'),
      expiresAt: new Date(Date.now() + 1000).toISOString(),
    });
    await store.revokeAllForUser('u2');
    const found = await store.findRefreshByToken('raw-token-4');
    expect(found?.revokedAt).not.toBeNull();
  });
});
