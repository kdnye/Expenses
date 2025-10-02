import type { NextFunction, Request, Response } from 'express';
import type { AdminRole, AdminUser } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';

export type SessionUser = Pick<AdminUser, 'id' | 'username' | 'role'>;

const AUTH_COOKIE_NAME = 'admin_session';
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 8; // 8 hours
const financeRoles: AdminRole[] = ['CFO', 'SUPER', 'FINANCE'];
const approvalRoles: AdminRole[] = Array.from(new Set<AdminRole>(['MANAGER', 'ANALYST', ...financeRoles]));
const allRoles: AdminRole[] = approvalRoles;

declare module 'express-serve-static-core' {
  interface Request {
    adminUser?: SessionUser;
  }
}

interface JwtPayload {
  sub: string;
  role: AdminRole;
  iat: number;
  exp: number;
}

function cookieOptions(withMaxAge: boolean) {
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    ...(withMaxAge ? { maxAge: SESSION_MAX_AGE_MS } : {})
  };
}

function getJwtSecret(): string {
  const secret = process.env.ADMIN_JWT_SECRET;

  if (!secret) {
    throw new Error('ADMIN_JWT_SECRET is not configured');
  }

  return secret;
}

function decodeToken(token: string): JwtPayload | undefined {
  try {
    return jwt.verify(token, getJwtSecret()) as JwtPayload;
  } catch (error) {
    return undefined;
  }
}

async function loadAdminFromToken(
  req: Request,
  res: Response
): Promise<SessionUser | undefined> {
  const token = req.cookies?.[AUTH_COOKIE_NAME];

  if (!token) {
    return undefined;
  }

  const payload = decodeToken(token);

  if (!payload) {
    clearAdminSession(res);
    return undefined;
  }

  const user = await prisma.adminUser.findUnique({ where: { id: payload.sub } });

  if (!user) {
    clearAdminSession(res);
    return undefined;
  }

  const sessionUser: SessionUser = {
    id: user.id,
    username: user.username,
    role: user.role
  };

  req.adminUser = sessionUser;
  return sessionUser;
}

export async function ensureAdminSession(
  req: Request,
  res: Response
): Promise<SessionUser | undefined> {
  if (req.adminUser) {
    return req.adminUser;
  }

  return loadAdminFromToken(req, res);
}

export function requireAdmin(
  roles: AdminRole[] = financeRoles
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await ensureAdminSession(req, res);

      if (!user) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      if (!roles.includes(user.role)) {
        return res.status(403).json({ message: 'Insufficient role' });
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export function createAdminSession(res: Response, user: SessionUser) {
  const token = jwt.sign(
    { sub: user.id, role: user.role },
    getJwtSecret(),
    { expiresIn: Math.floor(SESSION_MAX_AGE_MS / 1000) }
  );

  res.cookie(AUTH_COOKIE_NAME, token, cookieOptions(true));
}

export function clearAdminSession(res: Response) {
  res.clearCookie(AUTH_COOKIE_NAME, cookieOptions(false));
}

export const adminSessionCookieName = AUTH_COOKIE_NAME;
export const adminFinanceRoles = financeRoles;
export const adminApprovalRoles = approvalRoles;
export const adminAllRoles = allRoles;
