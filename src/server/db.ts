import { PrismaClient } from '@prisma/client'

/**
 * Prisma client singleton. In dev, Next's HMR would otherwise spawn a new
 * client per reload and exhaust connections.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db
}
