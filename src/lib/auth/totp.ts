import { authenticator } from 'otplib';

// Allow ±1 time step (30s) to tolerate clock drift between client and server.
const TOTP_WINDOW = 1;

export const generateTotpSecret = (): string => authenticator.generateSecret();

export const buildOtpAuthUri = (
  secret: string,
  account: string,
  issuer: string,
): string => authenticator.keyuri(account, issuer, secret);

export const verifyTotp = (token: string, secret: string): boolean => {
  try {
    authenticator.options = { window: TOTP_WINDOW };
    return authenticator.check(token, secret);
  } catch {
    return false;
  } finally {
    authenticator.resetOptions();
  }
};
