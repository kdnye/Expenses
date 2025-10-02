import type { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

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
  const folderId = process.env.GDRIVE_FOLDER_ID;
  if (!folderId) {
    throw new Error('GDRIVE_FOLDER_ID is required when using the gdrive receipt storage provider.');
  }

  const scopesEnv = process.env.GDRIVE_SCOPES;
  const scopes = scopesEnv
    ? scopesEnv
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    : ['https://www.googleapis.com/auth/drive.file'];

  const credentialsJson = process.env.GDRIVE_CREDENTIALS_JSON;
  const credentials = credentialsJson ? normalizeDriveCredentials(credentialsJson) : undefined;

  const { google } = await import('@googleapis/drive');
  const auth = new google.auth.GoogleAuth({
    scopes,
    ...(credentials ? { credentials } : {}),
  });

  const drive = google.drive({ version: 'v3', auth });

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
    const provider = (process.env.RECEIPT_STORAGE_PROVIDER ?? 'memory').toLowerCase();
    switch (provider) {
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
        throw new Error(`Unsupported receipt storage provider: ${provider}`);
    }
  }

  return cachedStorage;
};

export const resetReceiptStorageCache = () => {
  cachedStorage = null;
};

export const RECEIPT_ALLOWED_MIME_PREFIXES = ['image/'];
export const RECEIPT_ALLOWED_MIME_TYPES = new Set(['application/pdf']);
