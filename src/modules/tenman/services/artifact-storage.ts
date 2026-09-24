import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Environment } from '../../../config/environment.js';

export interface ArtifactStorage {
  readonly available: boolean;
  upload(
    key: string,
    body: ReadableStream<Uint8Array> | NodeJS.ReadableStream,
    size?: number,
    sha256Hex?: string,
  ): Promise<{ storageKey: string; byteCount: number }>;
  getSignedDownloadUrl(key: string, expiresSeconds: number): Promise<string>;
}

function hexToBase64(hex: string): string {
  return Buffer.from(hex, 'hex').toString('base64');
}

class R2ArtifactStorage implements ArtifactStorage {
  public readonly available = true;
  private readonly client: S3Client;
  private readonly bucket: string;

  public constructor(
    env: NonNullable<Environment['R2_ACCOUNT_ID']>,
    bucket: string,
    accessKeyId: string,
    secretAccessKey: string,
  ) {
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${env}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
    this.bucket = bucket;
  }

  public async upload(
    key: string,
    body: ReadableStream<Uint8Array> | NodeJS.ReadableStream,
    size?: number,
    sha256Hex?: string,
  ): Promise<{ storageKey: string; byteCount: number }> {
    const upload = new Upload({
      client: this.client,
      leavePartsOnError: false,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: body as ReadableStream,
        ContentLength: size,
        ...(sha256Hex ? { ChecksumSHA256: hexToBase64(sha256Hex) } : {}),
      },
    });
    await upload.done();
    return { storageKey: key, byteCount: size ?? 0 };
  }

  public async getSignedDownloadUrl(key: string, expiresSeconds: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresSeconds,
    });
  }
}

class NoopArtifactStorage implements ArtifactStorage {
  public readonly available = false;

  public upload(): Promise<never> {
    return Promise.reject(new Error('Artifact storage is not configured'));
  }

  public getSignedDownloadUrl(): Promise<never> {
    return Promise.reject(new Error('Artifact storage is not configured'));
  }
}

export function createArtifactStorage(environment: Environment): ArtifactStorage {
  if (
    environment.R2_ACCOUNT_ID &&
    environment.R2_BUCKET &&
    environment.R2_ACCESS_KEY_ID &&
    environment.R2_SECRET_ACCESS_KEY
  ) {
    return new R2ArtifactStorage(
      environment.R2_ACCOUNT_ID,
      environment.R2_BUCKET,
      environment.R2_ACCESS_KEY_ID,
      environment.R2_SECRET_ACCESS_KEY,
    );
  }
  return new NoopArtifactStorage();
}
