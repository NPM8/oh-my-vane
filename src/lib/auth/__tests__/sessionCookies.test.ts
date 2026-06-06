import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextResponse } from 'next/server';

let mod: typeof import('../sessionCookies');

beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vane-sesscookie-'));
  mkdirSync(path.join(dir, 'data'), { recursive: true });
  cpSync('drizzle', path.join(dir, 'drizzle'), { recursive: true });
  process.env.DATA_DIR = dir;
  process.env.JWT_SECRET = 'a-fixed-test-secret-at-least-32-bytes!!';
  execFileSync('npx', ['tsx', 'src/lib/db/migrate.ts'], {
    env: { ...process.env, DATA_DIR: dir },
    stdio: 'inherit',
  });
  mod = await import('../sessionCookies');
});

describe('issueSessionOnResponse', () => {
  it('sets httpOnly access + refresh cookies and persists the refresh row', async () => {
    const res = NextResponse.json({ ok: true });
    await mod.issueSessionOnResponse({
      res,
      user: { id: 'u-1', role: 'user', username: 'inv' },
      isSecure: false,
    });
    const setCookie = res.headers.getSetCookie();
    const joined = setCookie.join('\n');
    expect(joined).toMatch(/vane_access=/);
    expect(joined).toMatch(/vane_refresh=/);
    expect(joined.toLowerCase()).toContain('httponly');
    expect(joined.toLowerCase()).toContain('samesite=lax');

    const store = await import('../refreshStore');
    const refreshCookie = setCookie.find((c) => c.startsWith('vane_refresh='));
    const raw = decodeURIComponent(refreshCookie!.split(';')[0].split('=')[1]);
    const row = await store.findRefreshByToken(raw);
    expect(row?.userId).toBe('u-1');
  });
});
