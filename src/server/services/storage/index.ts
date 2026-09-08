import { createLocalDriver } from './local';
import { createS3Driver } from './s3';
import type { StorageDriver } from './types';

export type { StorageDriver } from './types';
export const LOCAL_STORAGE_ROOT = process.env.LOCAL_STORAGE_ROOT ?? '.storage';

let cached: StorageDriver | null = null;

/**
 * Picks the driver from configuration. S3 whenever it is configured; the
 * local driver only outside production, and never silently in production —
 * a misconfigured production deploy must fail loudly rather than write
 * evidence files to an ephemeral serverless disk where they vanish.
 */
export function createStorage(): StorageDriver {
  if (cached) return cached;

  const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
  if (S3_ENDPOINT && S3_BUCKET && S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY) {
    cached = createS3Driver({
      endpoint: S3_ENDPOINT,
      region: process.env.S3_REGION ?? 'auto',
      bucket: S3_BUCKET,
      accessKeyId: S3_ACCESS_KEY_ID,
      secretAccessKey: S3_SECRET_ACCESS_KEY,
    });
    return cached;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Object storage is not configured. Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and ' +
        'S3_SECRET_ACCESS_KEY — evidence files cannot be written to a serverless filesystem.',
    );
  }

  cached = createLocalDriver({
    root: LOCAL_STORAGE_ROOT,
    secret: process.env.AUTH_SECRET ?? 'dev-storage-secret',
    baseUrl: process.env.APP_URL ?? 'http://127.0.0.1:3000',
  });
  return cached;
}
