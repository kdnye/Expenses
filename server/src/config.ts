import dotenv from 'dotenv';

dotenv.config();

export type ReceiptStorageProvider = 'memory' | 's3' | 'gcs' | 'gdrive';

export interface ServerConfig {
  port: number;
}

export interface EnvironmentConfig {
  nodeEnv: string;
  isProduction: boolean;
}

export interface SecurityConfig {
  adminJwtSecret: string | null;
}

export interface ReceiptLimitsConfig {
  maxBytes: number;
  maxFiles: number;
  signedUrlTtlSeconds: number;
}

export interface S3ReceiptStorageConfig {
  bucket: string;
  region: string;
  prefix: string;
  endpoint?: string;
  forcePathStyle: boolean;
  publicUrlTemplate?: string;
}

export interface GcsReceiptStorageConfig {
  bucket: string;
  prefix: string;
  publicUrlTemplate?: string;
}

export interface GoogleDriveReceiptStorageConfig {
  folderId: string;
  scopes: string[];
  credentialsJson?: string;
}

export interface ReceiptStorageConfig {
  provider: ReceiptStorageProvider;
  s3?: S3ReceiptStorageConfig;
  gcs?: GcsReceiptStorageConfig;
  gdrive?: GoogleDriveReceiptStorageConfig;
}

export interface AppConfig {
  environment: EnvironmentConfig;
  server: ServerConfig;
  security: SecurityConfig;
  receipts: {
    limits: ReceiptLimitsConfig;
    storage: ReceiptStorageConfig;
  };
}

let cachedConfig: AppConfig | null = null;

type EnvSource = NodeJS.ProcessEnv;

type NumberParseOptions = {
  min?: number;
  max?: number;
  name: string;
};

function parseInteger(value: string | undefined, fallback: number, options: NumberParseOptions): number {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${options.name} must be an integer.`);
  }

  if (options.min !== undefined && parsed < options.min) {
    throw new Error(`${options.name} must be greater than or equal to ${options.min}.`);
  }

  if (options.max !== undefined && parsed > options.max) {
    throw new Error(`${options.name} must be less than or equal to ${options.max}.`);
  }

  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseReceiptStorageProvider(value: string | undefined): ReceiptStorageProvider {
  if (!value) {
    return 'memory';
  }

  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case 'memory':
    case 's3':
    case 'gcs':
    case 'gdrive':
      return normalized;
    default:
      throw new Error(`Unsupported receipt storage provider: ${value}`);
  }
}

function sanitizeScopes(value: string | undefined): string[] {
  if (!value) {
    return ['https://www.googleapis.com/auth/drive.file'];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function readConfigFromEnv(env: EnvSource = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const port = parseInteger(env.PORT, 3000, { name: 'PORT', min: 0, max: 65535 });
  const maxBytes = parseInteger(env.RECEIPT_MAX_BYTES, 10 * 1024 * 1024, {
    name: 'RECEIPT_MAX_BYTES',
    min: 1,
  });
  const maxFiles = parseInteger(env.RECEIPT_MAX_FILES, 5, {
    name: 'RECEIPT_MAX_FILES',
    min: 1,
  });
  const signedUrlTtlSeconds = parseInteger(env.RECEIPT_URL_TTL_SECONDS, 900, {
    name: 'RECEIPT_URL_TTL_SECONDS',
    min: 1,
  });

  const provider = parseReceiptStorageProvider(env.RECEIPT_STORAGE_PROVIDER);

  let s3: S3ReceiptStorageConfig | undefined;
  if (provider === 's3') {
    const bucket = env.S3_BUCKET;
    if (!bucket) {
      throw new Error('S3_BUCKET is required when using the s3 receipt storage provider.');
    }

    const region = env.S3_REGION ?? env.AWS_REGION;
    if (!region) {
      throw new Error('S3_REGION (or AWS_REGION) is required when using the s3 receipt storage provider.');
    }

    s3 = {
      bucket,
      region,
      prefix: env.S3_RECEIPT_PREFIX ?? 'receipts',
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: parseBoolean(env.S3_FORCE_PATH_STYLE, false),
      publicUrlTemplate: env.S3_PUBLIC_URL_TEMPLATE || undefined,
    };
  }

  let gcs: GcsReceiptStorageConfig | undefined;
  if (provider === 'gcs') {
    const bucket = env.GCS_BUCKET;
    if (!bucket) {
      throw new Error('GCS_BUCKET is required when using the gcs receipt storage provider.');
    }

    gcs = {
      bucket,
      prefix: env.GCS_RECEIPT_PREFIX ?? 'receipts',
      publicUrlTemplate: env.GCS_PUBLIC_URL_TEMPLATE || undefined,
    };
  }

  let gdrive: GoogleDriveReceiptStorageConfig | undefined;
  if (provider === 'gdrive') {
    const folderId = env.GDRIVE_FOLDER_ID;
    if (!folderId) {
      throw new Error('GDRIVE_FOLDER_ID is required when using the gdrive receipt storage provider.');
    }

    gdrive = {
      folderId,
      scopes: sanitizeScopes(env.GDRIVE_SCOPES),
      credentialsJson: env.GDRIVE_CREDENTIALS_JSON || undefined,
    };
  }

  return {
    environment: {
      nodeEnv,
      isProduction: nodeEnv === 'production',
    },
    server: {
      port,
    },
    security: {
      adminJwtSecret: env.ADMIN_JWT_SECRET ?? null,
    },
    receipts: {
      limits: {
        maxBytes,
        maxFiles,
        signedUrlTtlSeconds,
      },
      storage: {
        provider,
        ...(s3 ? { s3 } : {}),
        ...(gcs ? { gcs } : {}),
        ...(gdrive ? { gdrive } : {}),
      },
    },
  };
}

export function getConfig(): AppConfig {
  if (!cachedConfig) {
    cachedConfig = readConfigFromEnv();
  }

  return cachedConfig;
}

export function requireAdminJwtSecret(): string {
  const secret = getConfig().security.adminJwtSecret;
  if (!secret) {
    throw new Error('ADMIN_JWT_SECRET is not configured');
  }

  return secret;
}

export function resetConfigCache(): void {
  cachedConfig = null;
}

export const __test__ = {
  parseInteger,
  parseBoolean,
  parseReceiptStorageProvider,
  sanitizeScopes,
};
