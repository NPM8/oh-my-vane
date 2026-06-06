import { describe, it, expect } from 'vitest';
import { generateSync } from 'otplib';
import {
  generateTotpSecret,
  buildOtpAuthUri,
  verifyTotp,
} from '../totp';

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
    const code = generateSync({ secret });
    expect(verifyTotp(code, secret)).toBe(true);
  });

  it('rejects an incorrect code', () => {
    const secret = generateTotpSecret();
    expect(verifyTotp('000000', secret)).toBe(false);
  });
});
