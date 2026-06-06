import { describe, it, expect, afterEach } from 'vitest';
import { authenticator } from 'otplib';
import { generateTotpSecret, buildOtpAuthUri, verifyTotp } from '../totp';

afterEach(() => {
  authenticator.resetOptions();
});

describe('totp', () => {
  it('generates a base32 secret', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(secret.length).toBeGreaterThanOrEqual(16);
  });

  it('builds an otpauth:// URI with issuer and account', () => {
    const uri = buildOtpAuthUri('JBSWY3DPEHPK3PXP', 'alice', 'Vane');
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain('Vane');
    expect(uri).toContain('alice');
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
  });

  it('verifies a code generated from the same secret', () => {
    const secret = generateTotpSecret();
    const code = authenticator.generate(secret);
    expect(verifyTotp(code, secret)).toBe(true);
  });

  it('accepts a code from the previous time step (drift tolerance)', () => {
    const secret = generateTotpSecret();
    // Generate a code as it would have been one 30s step in the past.
    authenticator.options = { epoch: Date.now() - 30_000 };
    const pastCode = authenticator.generate(secret);
    authenticator.resetOptions();
    expect(verifyTotp(pastCode, secret)).toBe(true);
  });

  it('rejects an incorrect code', () => {
    const secret = generateTotpSecret();
    expect(verifyTotp('000000', secret)).toBe(false);
  });
});
