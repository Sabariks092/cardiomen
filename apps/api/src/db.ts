import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';

function makeClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  // Neon's serverless driver in production; plain Postgres for local development and tests.
  const adapter = connectionString.includes('.neon.tech')
    ? new PrismaNeon({ connectionString })
    : new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

const globals = globalThis as unknown as { prisma?: PrismaClient };

export function db(): PrismaClient {
  globals.prisma ??= makeClient();
  return globals.prisma;
}
