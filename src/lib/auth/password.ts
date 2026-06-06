import argon2 from 'argon2';

// OWASP-recommended argon2id parameters (memory in KiB).
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export const hashPassword = (plain: string): Promise<string> =>
  argon2.hash(plain, ARGON2_OPTIONS);

export const verifyPassword = async (
  hash: string,
  plain: string,
): Promise<boolean> => {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    // Malformed hash or verification error → treat as non-match, never throw.
    return false;
  }
};
