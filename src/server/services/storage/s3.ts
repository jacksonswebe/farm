import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageDriver, StoredObject } from './types';

/** Cloudflare R2 or any S3-compatible bucket. This is the production path. */
export function createS3Driver(config: {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}): StorageDriver {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    forcePathStyle: true,
  });

  return {
    name: 's3',

    presignPut(key, contentType, expirySeconds) {
      return getSignedUrl(
        client,
        new PutObjectCommand({ Bucket: config.bucket, Key: key, ContentType: contentType }),
        { expiresIn: expirySeconds },
      );
    },

    presignGet(key, expirySeconds) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: config.bucket, Key: key }), {
        expiresIn: expirySeconds,
      });
    },

    async head(key): Promise<StoredObject | null> {
      try {
        const r = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
        return {
          sizeBytes: Number(r.ContentLength ?? 0),
          contentType: r.ContentType ?? 'application/octet-stream',
        };
      } catch {
        // A missing object is a normal outcome — an upload that never completed.
        return null;
      }
    },

    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    },
  };
}
