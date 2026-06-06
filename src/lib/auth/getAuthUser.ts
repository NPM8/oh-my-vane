import { NextRequest } from 'next/server';
import { verifyJwt } from './jwt';
import { getAuthConfig } from './authConfig';
import { ACCESS_COOKIE } from './cookies';

export interface AuthUser {
  id: string;
  role: string;
  username: string;
}

export const getAuthUser = async (
  req: NextRequest,
): Promise<AuthUser | null> => {
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) return null;
  try {
    const claims = await verifyJwt(token, getAuthConfig().secret, 'access');
    return {
      id: claims.sub,
      role: claims.role ?? 'user',
      username: claims.username ?? '',
    };
  } catch {
    return null;
  }
};

// Helper for route handlers: returns the user, or a 401 Response to return.
export const requireAuth = async (
  req: NextRequest,
): Promise<AuthUser | Response> => {
  const user = await getAuthUser(req);
  if (!user) {
    return Response.json({ message: 'Unauthorized' }, { status: 401 });
  }
  return user;
};

// Returns the user when they are an admin, otherwise a 401/403 Response.
export const requireAdmin = async (
  req: NextRequest,
): Promise<AuthUser | Response> => {
  const user = await getAuthUser(req);
  if (!user) return Response.json({ message: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin') {
    return Response.json({ message: 'Forbidden' }, { status: 403 });
  }
  return user;
};

export const isResponse = (v: unknown): v is Response => v instanceof Response;
