import { describe, it, expect } from 'vitest';
import { resolveJwtSecret } from '../secret';

describe('resolveJwtSecret', () => {
  it('prefers the env secret when present', () => {
    const r = resolveJwtSecret({
      envSecret: 'env-secret-that-is-at-least-32-bytes!!',
      storedSecret: 'stored-secret-also-32-bytes-long-xx',
    });
    expect(new TextDecoder().decode(r.secret)).toBe(
      'env-secret-that-is-at-least-32-bytes!!',
    );
    expect(r.generated).toBeUndefined();
  });

  it('falls back to the stored secret', () => {
    const r = resolveJwtSecret({
      storedSecret: 'stored-secret-also-32-bytes-long-xx',
    });
    expect(new TextDecoder().decode(r.secret)).toBe(
      'stored-secret-also-32-bytes-long-xx',
    );
    expect(r.generated).toBeUndefined();
  });

  it('generates a >=32 byte secret when none provided', () => {
    const r = resolveJwtSecret({});
    expect(r.generated).toBeDefined();
    expect(Buffer.byteLength(r.generated as string, 'utf8')).toBeGreaterThanOrEqual(32);
    expect(r.secret.length).toBeGreaterThanOrEqual(32);
  });

  it('throws when a provided secret is too short', () => {
    expect(() => resolveJwtSecret({ envSecret: 'too-short' })).toThrow();
  });
});
