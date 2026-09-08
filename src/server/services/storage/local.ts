import { createHmac } from 'node:crypto';
import { mkdir, rm, stat, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { StorageDriver, StoredObject } from './types';

/**
 * Development and test only. Writes to the local filesystem and signs URLs
 * with the same HMAC scheme the dev upload route verifies, so the client
 * flow exercised locally is the same one that runs against S3 in production.
 *
 * Never usable in production: serverless filesystems are ephemeral, and
 * createStorage() refuses to select this driver when NODE_ENV is production.
 */
export function createLocalDriver(config: { root: string; secret: string; baseUrl: string }): StorageDriver {
  const root = resolve(config.root);

  // Path traversal guard: a key must resolve inside the storage root.
  const pathFor = (key: string) => {
    const full = resolve(join(root, key));
    if (full !== root && !full.startsWith(root + '/')) {
      throw new Error(`Refusing a storage key that escapes the root: ${key}`);
    }
    return full;
  };

  const sign = (key: string, op: string, expiresAt: number) =>
    createHmac('sha256', config.secret).update(`${op}:${key}:${expiresAt}`).digest('hex');

  const url = (key: string, op: 'put' | 'get', expirySeconds: number) => {
    const expiresAt = Math.floor(Date.now() / 1000) + expirySeconds;
    const sig = sign(key, op, expiresAt);
    return `${config.baseUrl}/api/dev/storage/${key}?op=${op}&expires=${expiresAt}&sig=${sig}`;
  };

  return {
    name: 'local',
    async presignPut(key, _contentType, expirySeconds) {
      return url(key, 'put', expirySeconds);
    },
    async presignGet(key, expirySeconds) {
      return url(key, 'get', expirySeconds);
    },
    async head(key): Promise<StoredObject | null> {
      try {
        const s = await stat(pathFor(key));
        let contentType = 'application/octet-stream';
        try {
          contentType = (await readFile(`${pathFor(key)}.type`, 'utf8')).trim();
        } catch {
          // No sidecar means the type was never recorded; the default stands.
        }
        return { sizeBytes: s.size, contentType };
      } catch {
        return null;
      }
    },
    async remove(key) {
      await rm(pathFor(key), { force: true });
      await rm(`${pathFor(key)}.type`, { force: true });
    },
  };
}

/** Used by the dev-only upload route; not part of the StorageDriver contract. */
export const localDev = {
  verify(key: string, op: string, expiresAt: number, sig: string, secret: string): boolean {
    if (Number.isNaN(expiresAt) || expiresAt * 1000 < Date.now()) return false;
    const expected = createHmac('sha256', secret).update(`${op}:${key}:${expiresAt}`).digest('hex');
    // Length check first: timingSafeEqual throws on a length mismatch.
    return expected.length === sig.length && expected === sig;
  },
  async write(root: string, key: string, body: Buffer, contentType: string) {
    const full = resolve(join(resolve(root), key));
    const rootAbs = resolve(root);
    if (full !== rootAbs && !full.startsWith(rootAbs + '/')) throw new Error('Invalid key');
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body);
    await writeFile(`${full}.type`, contentType);
  },
  async read(root: string, key: string): Promise<{ body: Buffer; contentType: string } | null> {
    const full = resolve(join(resolve(root), key));
    const rootAbs = resolve(root);
    if (full !== rootAbs && !full.startsWith(rootAbs + '/')) return null;
    try {
      const body = await readFile(full);
      let contentType = 'application/octet-stream';
      try {
        contentType = (await readFile(`${full}.type`, 'utf8')).trim();
      } catch {
        // default stands
      }
      return { body, contentType };
    } catch {
      return null;
    }
  },
};
