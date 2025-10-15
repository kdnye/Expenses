import { describe, expect, it } from 'vitest';
import { readConfigFromEnv } from '../server/src/config.ts';

describe('configuration loader', () => {
  it('returns defaults when environment variables are absent', () => {
    const config = readConfigFromEnv({} as NodeJS.ProcessEnv);

    expect(config.environment).toMatchObject({ nodeEnv: 'development', isProduction: false });
    expect(config.server.port).toBe(3000);
    expect(config.security.adminJwtSecret).toBeNull();
    expect(config.receipts.limits).toMatchObject({
      maxBytes: 10 * 1024 * 1024,
      maxFiles: 5,
      signedUrlTtlSeconds: 900,
    });
    expect(config.receipts.storage.provider).toBe('memory');
  });

  it('parses overrides and provider specific options', () => {
    const env = {
      NODE_ENV: 'production',
      PORT: '4100',
      ADMIN_JWT_SECRET: 'super-secret',
      RECEIPT_MAX_BYTES: '2048',
      RECEIPT_MAX_FILES: '3',
      RECEIPT_URL_TTL_SECONDS: '120',
      RECEIPT_STORAGE_PROVIDER: 'gdrive',
      GDRIVE_FOLDER_ID: 'drive-folder',
      GDRIVE_SCOPES: 'scope-one, scope-two ,  ',
      GDRIVE_CREDENTIALS_JSON: JSON.stringify({ private_key: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n' }),
    } as NodeJS.ProcessEnv;

    const config = readConfigFromEnv(env);

    expect(config.environment).toMatchObject({ nodeEnv: 'production', isProduction: true });
    expect(config.server.port).toBe(4100);
    expect(config.security.adminJwtSecret).toBe('super-secret');
    expect(config.receipts.limits).toMatchObject({
      maxBytes: 2048,
      maxFiles: 3,
      signedUrlTtlSeconds: 120,
    });
    expect(config.receipts.storage.provider).toBe('gdrive');
    expect(config.receipts.storage.gdrive).toBeDefined();
    expect(config.receipts.storage.gdrive?.folderId).toBe('drive-folder');
    expect(config.receipts.storage.gdrive?.scopes).toEqual(['scope-one', 'scope-two']);
    expect(config.receipts.storage.gdrive?.credentialsJson).toContain('PRIVATE KEY');
  });

  it('throws for unsupported receipt storage providers', () => {
    expect(() =>
      readConfigFromEnv({ RECEIPT_STORAGE_PROVIDER: 'filesystem' } as NodeJS.ProcessEnv)
    ).toThrow('Unsupported receipt storage provider');
  });

  it('requires mandatory settings for S3 when selected', () => {
    expect(() =>
      readConfigFromEnv({ RECEIPT_STORAGE_PROVIDER: 's3', S3_REGION: 'us-east-1' } as NodeJS.ProcessEnv)
    ).toThrow('S3_BUCKET is required');

    expect(() =>
      readConfigFromEnv({ RECEIPT_STORAGE_PROVIDER: 's3', S3_BUCKET: 'my-bucket' } as NodeJS.ProcessEnv)
    ).toThrow('S3_REGION (or AWS_REGION) is required');
  });

  it('validates numeric overrides', () => {
    expect(() =>
      readConfigFromEnv({ RECEIPT_MAX_FILES: 'zero' } as NodeJS.ProcessEnv)
    ).toThrow('RECEIPT_MAX_FILES must be an integer.');
  });
});
