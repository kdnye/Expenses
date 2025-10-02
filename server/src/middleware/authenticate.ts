import type { NextFunction, Request, Response } from 'express';

const unauthorizedResponse = { message: 'Unauthorized' } as const;

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const requiredKey = process.env.API_KEY;

  if (!requiredKey) {
    return res
      .status(500)
      .json({ message: 'API key not configured on server' });
  }

  const providedKey = req.header('x-api-key') ?? req.header('authorization');

  if (!providedKey || providedKey !== requiredKey) {
    return res.status(401).json(unauthorizedResponse);
  }

  return next();
}
