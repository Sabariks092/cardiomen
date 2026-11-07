import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { PrismaPg } from '@prisma/adapter-pg';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@/generated/prisma/client';
import { setMailerForTests } from '@/auth/email';

/** A real Postgres (PGlite) with the real migrations applied, so tests exercise real SQL. */
export interface Harness {
  prisma: PrismaClient;
  sent: { to: string; subject: string; text: string }[];
  lastCode(): string;
  stop(): Promise<void>;
}

export async function startHarness(port: number): Promise<Harness> {
  const pg = await PGlite.create();
  const migrations = path.resolve(__dirname, '../prisma/migrations');
  for (const dir of readdirSync(migrations).sort()) {
    if (dir.endsWith('.toml')) continue;
    await pg.exec(readFileSync(path.join(migrations, dir, 'migration.sql'), 'utf8'));
  }
  const server = new PGLiteSocketServer({ db: pg, port, host: '127.0.0.1' });
  await server.start();

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: `postgresql://postgres@127.0.0.1:${port}/postgres`, max: 1 }),
  });
  (globalThis as unknown as { prisma: PrismaClient }).prisma = prisma;

  const sent: Harness['sent'] = [];
  setMailerForTests({
    async send(to, subject, text) {
      sent.push({ to, subject, text });
    },
  });

  return {
    prisma,
    sent,
    lastCode() {
      const match = sent[sent.length - 1]?.text.match(/\b(\d{6})\b/);
      if (!match) throw new Error('No code was emailed');
      return match[1];
    },
    async stop() {
      setMailerForTests(null);
      await prisma.$disconnect();
      await server.stop();
      await pg.close();
    },
  };
}

export function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://test${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

export function put(url: string, body: unknown, token: string) {
  return new Request(`http://test${url}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

export function get(url: string, token: string) {
  return new Request(`http://test${url}`, { headers: { authorization: `Bearer ${token}` } });
}

export const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
