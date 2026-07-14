import { PrismaClient } from "@/generated/prisma";

/**
 * Prisma singleton. In dev, reuse the instance across HMR reloads to avoid
 * exhausting the connection pool. Tenant isolation is enforced by Postgres
 * RLS (see prisma/rls.sql) — this client connects under the request role.
 */
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
