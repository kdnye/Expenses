import type { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { getConfig, resetConfigCache } from '../config.js';

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
  const {
    receipts: { storage },
  } = getConfig();

  const s3 = storage.s3;
  if (!s3) {
    throw new Error('S3 receipt storage is not configured. Ensure S3_BUCKET and S3_REGION are set.');
  }

  const { bucket, region, prefix, endpoint, forcePathStyle, publicUrlTemplate } = s3;
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
  const {
    receipts: { storage },
  } = getConfig();

  const gcs = storage.gcs;
  if (!gcs) {
    throw new Error('GCS receipt storage is not configured. Set GCS_BUCKET to enable it.');
  }

  const { bucket: bucketName, prefix, publicUrlTemplate } = gcs;
  const { Storage } = await import('@google-cloud/storage');
  const storageClient = new Storage();
  const bucket = storageClient.bucket(bucketName);

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

type GoogleDriveCredentials = {
  client_email?: string;
  private_key?: string;
  [key: string]: unknown;
};

const normalizeDriveCredentials = (json: string): GoogleDriveCredentials => {
  let parsed: GoogleDriveCredentials;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error('Failed to parse GDRIVE_CREDENTIALS_JSON.');
  }

  if (typeof parsed.private_key === 'string') {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }

  return parsed;
};

async function createGoogleDriveStorage(): Promise<ReceiptStorage> {
  const {
    receipts: { storage },
  } = getConfig();

  const gdrive = storage.gdrive;
  if (!gdrive) {
    throw new Error('Google Drive receipt storage is not configured. Set GDRIVE_FOLDER_ID to enable it.');
  }

  const { folderId, scopes, credentialsJson } = gdrive;
  const credentials = credentialsJson ? normalizeDriveCredentials(credentialsJson) : undefined;

  const driveModule = await import('@googleapis/drive');
  const auth = new driveModule.auth.GoogleAuth({
    scopes,
    ...(credentials ? { credentials } : {}),
  });

  const drive = driveModule.drive({ version: 'v3', auth });

  return {
    async upload(options: UploadReceiptOptions) {
      const objectKey = buildObjectKey(options.reportId, options.expenseId, options.fileName);
      const driveFileName = objectKey.replace(/\//g, '__');

      const response = await drive.files.create({
        requestBody: {
          name: driveFileName,
          parents: [folderId],
          mimeType: options.contentType,
        },
        media: {
          mimeType: options.contentType,
          body: Readable.from(options.data),
        },
        fields: 'id, webViewLink, webContentLink',
        supportsAllDrives: true,
      });

      const fileId = response.data.id;
      if (!fileId) {
        throw new Error('Google Drive did not return a file identifier for the uploaded receipt.');
      }

      const storageUrl = response.data.webViewLink ?? response.data.webContentLink ?? undefined;

      return {
        storageProvider: 'gdrive',
        storageBucket: folderId,
        storageKey: fileId,
        storageUrl,
      } satisfies StoredReceipt;
    },
    async getDownloadUrl(stored: StoredReceipt) {
      if (stored.storageProvider !== 'gdrive' || !stored.storageKey) {
        return stored.storageUrl ?? undefined;
      }

      const tokenResponse = await auth.getAccessToken();
      const token =
        typeof tokenResponse === 'string'
          ? tokenResponse
          : tokenResponse && typeof tokenResponse === 'object' && 'token' in tokenResponse
            ? (tokenResponse as { token?: string }).token ?? null
            : null;

      if (!token) {
        return stored.storageUrl ?? undefined;
      }

      const encodedId = encodeURIComponent(stored.storageKey);
      const encodedToken = encodeURIComponent(token);
      return `https://www.googleapis.com/drive/v3/files/${encodedId}?alt=media&access_token=${encodedToken}`;
    },
  } satisfies ReceiptStorage;
}

let cachedStorage: Promise<ReceiptStorage> | null = null;

export const getReceiptStorage = async (): Promise<ReceiptStorage> => {
  if (!cachedStorage) {
    const {
      receipts: { storage },
    } = getConfig();

    switch (storage.provider) {
      case 's3':
        cachedStorage = createS3Storage();
        break;
      case 'gcs':
        cachedStorage = createGcsStorage();
        break;
      case 'gdrive':
        cachedStorage = createGoogleDriveStorage();
        break;
      case 'memory':
        cachedStorage = Promise.resolve(new MemoryReceiptStorage());
        break;
      default:
        throw new Error(`Unsupported receipt storage provider: ${storage.provider}`);
    }
  }

  return cachedStorage;
};

export const resetReceiptStorageCache = () => {
  cachedStorage = null;
  resetConfigCache();
};

export const RECEIPT_ALLOWED_MIME_PREFIXES = ['image/'];
export const RECEIPT_ALLOWED_MIME_TYPES = new Set(['application/pdf']);

export const __testHelpers = {
  createMemoryStorage: () => new MemoryReceiptStorage(),
  createS3Storage,
  createGcsStorage,
  createGoogleDriveStorage,
  resetMemoryBucket: () => memoryBucket.clear(),
};
