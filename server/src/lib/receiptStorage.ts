import type { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';

export interface UploadReceiptOptions {
  reportId: string;
  expenseId: string;
  fileName: string;
  contentType: string;
  data: Buffer;
}

export interface StoredReceipt {
  storageProvider: string;
  storageBucket?: string | null;
  storageKey: string;
  storageUrl?: string | null;
}

export interface ReceiptStorage {
  upload(options: UploadReceiptOptions): Promise<StoredReceipt>;
  getDownloadUrl(
    stored: StoredReceipt,
    expiresInSeconds?: number
  ): Promise<string | undefined>;
}

const memoryBucket = new Map<string, Buffer>();

const sanitizeFileName = (input: string) => {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    || 'receipt';
};

const buildObjectKey = (reportId: string, expenseId: string, fileName: string) => {
  const safeReport = reportId.replace(/[^a-zA-Z0-9_-]+/g, '-');
  const safeExpense = expenseId.replace(/[^a-zA-Z0-9_-]+/g, '-');
  const safeName = sanitizeFileName(fileName);
  const stamp = Date.now();
  const random = randomUUID().slice(0, 8);
  return `${safeReport}/${safeExpense}/${stamp}-${random}-${safeName}`;
};

class MemoryReceiptStorage implements ReceiptStorage {
  async upload(options: UploadReceiptOptions): Promise<StoredReceipt> {
    const key = buildObjectKey(options.reportId, options.expenseId, options.fileName);
    memoryBucket.set(key, options.data);
    return {
      storageProvider: 'memory',
      storageBucket: 'memory',
      storageKey: key,
      storageUrl: `memory://${key}`,
    };
  }

  async getDownloadUrl(stored: StoredReceipt): Promise<string | undefined> {
    if (!stored.storageKey) return undefined;
    return `memory://${stored.storageKey}`;
  }
}

async function createS3Storage(): Promise<ReceiptStorage> {
  const bucket = process.env.S3_BUCKET;
  const region = process.env.S3_REGION ?? process.env.AWS_REGION;
  if (!bucket) {
    throw new Error('S3_BUCKET is required when using the s3 receipt storage provider.');
  }
  if (!region) {
    throw new Error('S3_REGION (or AWS_REGION) is required when using the s3 receipt storage provider.');
  }

  const prefix = process.env.S3_RECEIPT_PREFIX ?? 'receipts';
  const endpoint = process.env.S3_ENDPOINT;
  const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === 'true';
  const publicUrlTemplate = process.env.S3_PUBLIC_URL_TEMPLATE;
  const { S3Client, PutObjectCommand, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');

  const client = new S3Client({
    region,
    ...(endpoint ? { endpoint } : {}),
    ...(forcePathStyle ? { forcePathStyle: true } : {}),
  });

  return {
    async upload(options: UploadReceiptOptions) {
      const objectKey = `${prefix}/${buildObjectKey(options.reportId, options.expenseId, options.fileName)}`;
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        Body: options.data,
        ContentType: options.contentType,
      });
      await client.send(command);

      let storageUrl: string | undefined;
      if (publicUrlTemplate) {
        storageUrl = publicUrlTemplate
          .replace('{bucket}', bucket)
          .replace('{key}', encodeURIComponent(objectKey));
      }

      return {
        storageProvider: 's3',
        storageBucket: bucket,
        storageKey: objectKey,
        storageUrl,
      };
    },
    async getDownloadUrl(stored: StoredReceipt, expiresInSeconds = 900) {
      if (!stored.storageKey) return undefined;
      const command = new GetObjectCommand({ Bucket: bucket, Key: stored.storageKey });
      return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
    },
  };
}

async function createGcsStorage(): Promise<ReceiptStorage> {
  const bucketName = process.env.GCS_BUCKET;
  if (!bucketName) {
    throw new Error('GCS_BUCKET is required when using the gcs receipt storage provider.');
  }
  const prefix = process.env.GCS_RECEIPT_PREFIX ?? 'receipts';
  const publicUrlTemplate = process.env.GCS_PUBLIC_URL_TEMPLATE;
  const { Storage } = await import('@google-cloud/storage');
  const storage = new Storage();
  const bucket = storage.bucket(bucketName);

  return {
    async upload(options: UploadReceiptOptions) {
      const objectKey = `${prefix}/${buildObjectKey(options.reportId, options.expenseId, options.fileName)}`;
      const file = bucket.file(objectKey);
      await file.save(options.data, {
        resumable: false,
        contentType: options.contentType,
      });

      let storageUrl: string | undefined;
      if (publicUrlTemplate) {
        storageUrl = publicUrlTemplate
          .replace('{bucket}', bucketName)
          .replace('{key}', encodeURIComponent(objectKey));
      }

      return {
        storageProvider: 'gcs',
        storageBucket: bucketName,
        storageKey: objectKey,
        storageUrl,
      };
    },
    async getDownloadUrl(stored: StoredReceipt, expiresInSeconds = 900) {
      if (!stored.storageKey) return undefined;
      const [url] = await bucket.file(stored.storageKey).getSignedUrl({
        action: 'read',
        expires: Date.now() + expiresInSeconds * 1000,
      });
      return url;
    },
  };
}

let cachedStorage: Promise<ReceiptStorage> | null = null;

export const getReceiptStorage = async (): Promise<ReceiptStorage> => {
  if (!cachedStorage) {
    const provider = (process.env.RECEIPT_STORAGE_PROVIDER ?? 'memory').toLowerCase();
    switch (provider) {
      case 's3':
        cachedStorage = createS3Storage();
        break;
      case 'gcs':
        cachedStorage = createGcsStorage();
        break;
      case 'memory':
        cachedStorage = Promise.resolve(new MemoryReceiptStorage());
        break;
      default:
        throw new Error(`Unsupported receipt storage provider: ${provider}`);
    }
  }

  return cachedStorage;
};

export const RECEIPT_ALLOWED_MIME_PREFIXES = ['image/'];
export const RECEIPT_ALLOWED_MIME_TYPES = new Set(['application/pdf']);
