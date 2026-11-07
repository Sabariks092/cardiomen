import { hash, verify } from '@node-rs/argon2';

const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

// Verified against when an account doesn't exist, so response timing doesn't reveal which emails do.
let dummy: Promise<string> | null = null;

export const hashPassword = (password: string) => hash(password, OPTIONS);

export async function verifyPassword(storedHash: string | null | undefined, password: string) {
  dummy ??= hash('timing-equalizer', OPTIONS);
  const target = storedHash ?? (await dummy);
  const matches = await verify(target, password);
  return matches && storedHash != null;
}
