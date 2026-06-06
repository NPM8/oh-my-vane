import { randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from './password';

const CODE_COUNT = 10;

// 4 bytes → 8 base32-ish lowercase chars, split as xxxx-xxxx for readability.
const makeCode = (): string => {
  const raw = randomBytes(5).toString('hex').slice(0, 8); // 8 hex chars
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
};

export const generateRecoveryCodes = async (): Promise<string[]> => {
  const codes = new Set<string>();
  while (codes.size < CODE_COUNT) codes.add(makeCode());
  return Array.from(codes);
};

export const hashRecoveryCodes = (codes: string[]): Promise<string[]> =>
  Promise.all(codes.map((c) => hashPassword(c)));

export interface ConsumeResult {
  ok: boolean;
  remaining: string[];
}

// Checks `code` against each stored hash. On match, returns remaining hashes
// with the matched hash removed (single-use). On no match, returns the set
// unchanged.
export const consumeRecoveryCode = async (
  code: string,
  hashes: string[],
): Promise<ConsumeResult> => {
  for (let i = 0; i < hashes.length; i++) {
    if (await verifyPassword(hashes[i], code)) {
      const remaining = hashes.filter((_, idx) => idx !== i);
      return { ok: true, remaining };
    }
  }
  return { ok: false, remaining: hashes };
};
