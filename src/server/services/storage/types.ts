export interface StoredObject {
  sizeBytes: number;
  contentType: string;
}

/**
 * Object storage, behind an interface so the application never talks to a
 * vendor SDK directly and files never pass through the app server: the client
 * PUTs to a presigned URL and GETs from one. See docs/02-TECHNICAL-BLUEPRINT.md §7.
 */
export interface StorageDriver {
  readonly name: string;
  presignPut(key: string, contentType: string, expirySeconds: number): Promise<string>;
  presignGet(key: string, expirySeconds: number): Promise<string>;
  head(key: string): Promise<StoredObject | null>;
  remove(key: string): Promise<void>;
}
