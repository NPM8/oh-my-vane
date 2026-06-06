import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

export type TokenType = 'access' | 'mfa';

export interface AuthClaims extends JWTPayload {
  sub: string;
  type: TokenType;
  role?: string;
  username?: string;
}

const ALG = 'HS256';

export const signJwt = (
  claims: AuthClaims,
  secret: Uint8Array,
  expiresIn: string,
): Promise<string> =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret);

export const verifyJwt = async (
  token: string,
  secret: Uint8Array,
  expectedType: TokenType,
): Promise<AuthClaims> => {
  const { payload } = await jwtVerify(token, secret, { algorithms: [ALG] });
  if ((payload as AuthClaims).type !== expectedType) {
    throw new Error(`Unexpected token type: ${(payload as AuthClaims).type}`);
  }
  return payload as AuthClaims;
};
