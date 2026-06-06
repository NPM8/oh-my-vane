import { signJwt } from './jwt';
import { generateToken, hashToken } from './tokens';

export interface IssuedSession {
  accessToken: string;
  accessMaxAgeSec: number;
  refreshToken: string;
  refreshMaxAgeSec: number;
  refreshRecord: { id: string; tokenHash: string; expiresAt: string };
}

export const issueSession = async (params: {
  user: { id: string; role: string; username: string };
  secret: Uint8Array;
  accessTtlMin: number;
  refreshTtlDays: number;
  now: number;
  refreshId: string;
}): Promise<IssuedSession> => {
  const accessMaxAgeSec = params.accessTtlMin * 60;
  const refreshMaxAgeSec = params.refreshTtlDays * 24 * 60 * 60;

  const accessToken = await signJwt(
    {
      sub: params.user.id,
      role: params.user.role,
      username: params.user.username,
      type: 'access',
    },
    params.secret,
    `${accessMaxAgeSec}s`,
  );

  const refreshToken = generateToken();
  const expiresAt = new Date(params.now + refreshMaxAgeSec * 1000).toISOString();

  return {
    accessToken,
    accessMaxAgeSec,
    refreshToken,
    refreshMaxAgeSec,
    refreshRecord: {
      id: params.refreshId,
      tokenHash: hashToken(refreshToken),
      expiresAt,
    },
  };
};
