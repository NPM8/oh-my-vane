import { generateSecret, generateURI, verifySync } from 'otplib';

// Allow ±1 time step (30s) to tolerate clock drift.
const COUNTER_TOLERANCE = 1;

export const generateTotpSecret = (): string => generateSecret();

export const buildOtpAuthUri = (
  secret: string,
  account: string,
  issuer: string,
): string => generateURI({ secret, label: account, issuer });

export const verifyTotp = (token: string, secret: string): boolean => {
  try {
    return verifySync({ token, secret, counterTolerance: COUNTER_TOLERANCE })
      .valid;
  } catch {
    return false;
  }
};
