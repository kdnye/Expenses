import type { NextFunction, Request, Response } from 'express';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof Error) {
    console.error(err);
    return res.status(500).json({ message: err.message });
  }

  return res.status(500).json({ message: 'Unexpected error' });
}
