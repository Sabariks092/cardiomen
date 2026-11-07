import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Migrations must use the direct connection. `prisma generate` needs no database at all.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? '' },
});
