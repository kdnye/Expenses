import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import {
  clearAdminSession,
  createAdminSession,
  ensureAdminSession,
  requireAdmin,
  adminAllRoles
} from '../middleware/adminAuth.js';

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

router.post('/login', async (req, res, next) => {
  const parsed = loginSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid login payload',
      issues: parsed.error.flatten()
    });
  }

  const username = parsed.data.username.trim().toLowerCase();
  const password = parsed.data.password;

  try {
    const user = await prisma.adminUser.findUnique({ where: { username } });

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);

    if (!passwordMatches) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const sessionUser = {
      id: user.id,
      username: user.username,
      role: user.role
    } as const;

    createAdminSession(res, sessionUser);

    return res.status(200).json({ user: sessionUser });
  } catch (error) {
    return next(error);
  }
});

router.post('/logout', requireAdmin(adminAllRoles), (req, res) => {
  clearAdminSession(res);
  return res.status(204).end();
});

router.get('/session', requireAdmin(adminAllRoles), async (req, res, next) => {
  try {
    const user = await ensureAdminSession(req, res);

    if (!user) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    return res.json({ user });
  } catch (error) {
    return next(error);
  }
});

export default router;
