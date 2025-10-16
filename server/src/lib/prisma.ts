import { PrismaClient } from '@prisma/client';
import { getConfig } from '../config.js';

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['error', 'warn']
  });

const {
  environment: { isProduction },
} = getConfig();

if (!isProduction) {
  globalForPrisma.prisma = prisma;
}
