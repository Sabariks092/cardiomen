import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    include: ['test/**/*.test.ts'],
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      JWT_SECRET: 'test-jwt-secret-test-jwt-secret-test-jwt-secret',
      OTP_PEPPER: 'test-otp-pepper-test-otp-pepper-test-otp-pepper',
      CRON_SECRET: 'test-cron-secret',
    },
  },
});
