import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { authenticator } from 'otplib';

let tf: typeof import('../twoFactor');
let users: typeof import('../users');

beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vane-2fa-'));
  mkdirSync(path.join(dir, 'data'), { recursive: true });
  cpSync('drizzle', path.join(dir, 'drizzle'), { recursive: true });
  process.env.DATA_DIR = dir;
  execFileSync('npx', ['tsx', 'src/lib/db/migrate.ts'], {
    env: { ...process.env, DATA_DIR: dir },
    stdio: 'inherit',
  });
  tf = await import('../twoFactor');
  users = await import('../users');
});

describe('two-factor repository', () => {
  it('enrolls, confirms with a valid code, and verifies', async () => {
    const u = await users.createUser({ username: 'tfa', password: 'password-1234', role: 'user' });
    const { secret } = await tf.startEnrollment(u.id, u.username);
    expect(secret).toMatch(/^[A-Z2-7]+$/);

    const before = await users.getUserById(u.id);
    expect(before?.totpEnabled).toBe(false);

    const wrong = await tf.confirmEnrollment(u.id, '000000');
    expect(wrong.ok).toBe(false);

    const code = authenticator.generate(secret);
    const confirmed = await tf.confirmEnrollment(u.id, code);
    expect(confirmed.ok).toBe(true);
    if (confirmed.ok) expect(confirmed.recoveryCodes).toHaveLength(10);

    const after = await users.getUserById(u.id);
    expect(after?.totpEnabled).toBe(true);

    expect(await tf.verifyUserSecondFactor(u.id, authenticator.generate(secret))).toBe(true);
    expect(await tf.verifyUserSecondFactor(u.id, '000000')).toBe(false);
  });

  it('consumes a recovery code once', async () => {
    const u = await users.createUser({ username: 'tfa2', password: 'password-1234', role: 'user' });
    const { secret } = await tf.startEnrollment(u.id, u.username);
    const confirmed = await tf.confirmEnrollment(u.id, authenticator.generate(secret));
    if (!confirmed.ok) throw new Error('confirm failed');
    const recovery = confirmed.recoveryCodes[0];

    expect(await tf.verifyUserSecondFactor(u.id, recovery)).toBe(true);
    expect(await tf.verifyUserSecondFactor(u.id, recovery)).toBe(false);
  });

  it('disables 2FA (clears secret/codes/flag)', async () => {
    const u = await users.createUser({ username: 'tfa3', password: 'password-1234', role: 'user' });
    const { secret } = await tf.startEnrollment(u.id, u.username);
    await tf.confirmEnrollment(u.id, authenticator.generate(secret));
    await tf.disableTwoFactor(u.id);
    const row = await users.getUserById(u.id);
    expect(row?.totpEnabled).toBe(false);
    expect(row?.totpSecret).toBeNull();
    expect(await tf.verifyUserSecondFactor(u.id, authenticator.generate(secret))).toBe(false);
  });
});
