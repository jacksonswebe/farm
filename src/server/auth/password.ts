import { hash, verify } from '@node-rs/argon2';

// OWASP-recommended argon2id parameters (docs/02-TECHNICAL-BLUEPRINT.md §11).
const OPTIONS = { memoryCost: 65536, timeCost: 3, parallelism: 4 } as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(digest: string, plain: string): Promise<boolean> {
  try {
    return await verify(digest, plain, OPTIONS);
  } catch {
    // A malformed hash must read as "wrong password", never as a crash that
    // reveals the account exists.
    return false;
  }
}
