import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createHash } from 'node:crypto';

const receiptCreate = vi.fn();
const transactionMock = vi.fn();
const storageUpload = vi.fn();
const storageGetDownloadUrl = vi.fn();

vi.mock('../server/src/lib/prisma.js', () => ({
  prisma: {
    $transaction: transactionMock,
  },
}));

const driveFilesCreate = vi.fn();
const driveFilesGet = vi.fn();
const googleAuthAccessTokenMock = vi.fn();

vi.mock('../server/src/lib/receiptStorage.js', async () => {
  const actual = await vi.importActual<typeof import('../server/src/lib/receiptStorage.js')>(
    '../server/src/lib/receiptStorage.js'
  );
  return {
    ...actual,
    getReceiptStorage: vi.fn(),
    RECEIPT_ALLOWED_MIME_PREFIXES: ['image/'],
    RECEIPT_ALLOWED_MIME_TYPES: new Set(['application/pdf']),
  };
});

vi.mock('@googleapis/drive', () => ({
  google: {
    auth: {
      GoogleAuth: class {
        options;

        constructor(options) {
          this.options = options;
        }

        async getAccessToken() {
          return googleAuthAccessTokenMock();
        }
      }
    },
    drive: () => ({
      files: {
        create: driveFilesCreate,
        get: driveFilesGet,
      },
    }),
  },
}));

type ReceiptRecord = {
  id: string;
  reportId: string;
  clientExpenseId: string;
  expenseId: string | null;
  storageProvider: string;
  storageBucket: string | null;
  storageKey: string;
  storageUrl: string | null;
  fileName: string;
  contentType: string;
  fileSize: number;
  checksum: string | null;
  uploadedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

const { getReceiptStorage } = await import('../server/src/lib/receiptStorage.js');
const {
  getReceiptStorage: getReceiptStorageActual,
  resetReceiptStorageCache,
} = await vi.importActual<typeof import('../server/src/lib/receiptStorage.js')>(
  '../server/src/lib/receiptStorage.js'
);

const importApp = async () => {
  const module = await import('../server/src/app.ts');
  return module.default;
};

describe('receipt uploads', () => {
  beforeEach(() => {
    process.env.API_KEY = 'test-key';
    receiptCreate.mockReset();
    storageUpload.mockReset();
    storageGetDownloadUrl.mockReset();
    transactionMock.mockImplementation(async (callback) => {
      return callback({
        receipt: { create: receiptCreate },
      });
    });

    (getReceiptStorage as unknown as vi.Mock).mockResolvedValue({
      upload: storageUpload,
      getDownloadUrl: storageGetDownloadUrl,
    });
  });

  it('rejects unsupported mime types', async () => {
    const app = await importApp();

    const response = await request(app)
      .post('/api/receipts')
      .set('x-api-key', 'test-key')
      .field('reportId', 'rep-1')
      .field('expenseId', 'exp-1')
      .attach('files', Buffer.from('nope'), {
        filename: 'note.txt',
        contentType: 'text/plain',
      });

    expect(response.status).toBe(415);
    expect(storageUpload).not.toHaveBeenCalled();
    expect(receiptCreate).not.toHaveBeenCalled();
  });

  it('stores metadata and returns download urls', async () => {
    const app = await importApp();
    const fileBuffer = Buffer.from('test-pdf');
    const expectedChecksum = createHash('sha256').update(fileBuffer).digest('hex');

    storageUpload.mockResolvedValue({
      storageProvider: 'memory',
      storageBucket: 'memory',
      storageKey: 'rep-1/exp-1/file.pdf',
      storageUrl: 'memory://rep-1/exp-1/file.pdf',
    });

    storageGetDownloadUrl.mockResolvedValue('https://example.com/download/1');

    receiptCreate.mockImplementation(async ({ data }: { data: Omit<ReceiptRecord, 'id' | 'expenseId' | 'uploadedAt' | 'createdAt' | 'updatedAt'> }) => {
      return {
        id: 'rcpt-1',
        expenseId: null,
        uploadedAt: new Date('2024-03-05T12:00:00Z'),
        createdAt: new Date('2024-03-05T12:00:00Z'),
        updatedAt: new Date('2024-03-05T12:00:00Z'),
        ...data,
      } as ReceiptRecord;
    });

    const response = await request(app)
      .post('/api/receipts')
      .set('x-api-key', 'test-key')
      .field('reportId', 'rep-1')
      .field('expenseId', 'exp-1')
      .attach('files', fileBuffer, {
        filename: 'receipt.pdf',
        contentType: 'application/pdf',
      });

    expect(response.status).toBe(201);
    expect(storageUpload).toHaveBeenCalledWith({
      reportId: 'rep-1',
      expenseId: 'exp-1',
      fileName: 'receipt.pdf',
      contentType: 'application/pdf',
      data: expect.any(Buffer),
    });

    expect(receiptCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reportId: 'rep-1',
        clientExpenseId: 'exp-1',
        storageProvider: 'memory',
        storageBucket: 'memory',
        storageKey: 'rep-1/exp-1/file.pdf',
        storageUrl: 'memory://rep-1/exp-1/file.pdf',
        fileName: 'receipt.pdf',
        contentType: 'application/pdf',
        fileSize: fileBuffer.length,
        checksum: expectedChecksum,
      }),
    });

    const body = response.body as { receipts: ReceiptRecord[] };
    expect(body.receipts).toHaveLength(1);
    expect(body.receipts[0]).toMatchObject({
      id: 'rcpt-1',
      downloadUrl: 'https://example.com/download/1',
    });
    expect(storageGetDownloadUrl).toHaveBeenCalledWith(
      expect.objectContaining({ storageKey: 'rep-1/exp-1/file.pdf' }),
      expect.any(Number)
    );
  });
});

describe('google drive receipt storage provider', () => {
  beforeEach(() => {
    driveFilesCreate.mockReset();
    driveFilesGet.mockReset();
    googleAuthAccessTokenMock.mockReset();
    googleAuthAccessTokenMock.mockResolvedValue('drive-token');
    process.env.RECEIPT_STORAGE_PROVIDER = 'gdrive';
    process.env.GDRIVE_FOLDER_ID = 'folder-123';
    process.env.GDRIVE_CREDENTIALS_JSON = JSON.stringify({
      type: 'service_account',
      client_email: 'svc@example.com',
      private_key: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n',
    });
  });

  afterEach(() => {
    delete process.env.RECEIPT_STORAGE_PROVIDER;
    delete process.env.GDRIVE_FOLDER_ID;
    delete process.env.GDRIVE_CREDENTIALS_JSON;
  });

  it('uploads receipts to Google Drive and returns download URLs', async () => {
    driveFilesCreate.mockResolvedValue({
      data: {
        id: 'drive-file-1',
        webViewLink: 'https://drive.google.com/file/d/drive-file-1/view',
        webContentLink: 'https://drive.google.com/uc?id=drive-file-1',
      },
    });

    await resetReceiptStorageCache();
    const storage = await getReceiptStorageActual();

    const buffer = Buffer.from('test drive upload');
    const stored = await storage.upload({
      reportId: 'rep-9',
      expenseId: 'exp-2',
      fileName: 'receipt.png',
      contentType: 'image/png',
      data: buffer,
    });

    expect(driveFilesCreate).toHaveBeenCalledTimes(1);
    const createArgs = driveFilesCreate.mock.calls[0]?.[0];
    expect(createArgs?.requestBody?.parents).toEqual(['folder-123']);
    expect(createArgs?.requestBody?.mimeType).toBe('image/png');
    expect(createArgs?.media?.mimeType).toBe('image/png');
    expect(typeof createArgs?.media?.body?.pipe).toBe('function');

    expect(stored).toMatchObject({
      storageProvider: 'gdrive',
      storageBucket: 'folder-123',
      storageKey: 'drive-file-1',
      storageUrl: 'https://drive.google.com/file/d/drive-file-1/view',
    });

    const downloadUrl = await storage.getDownloadUrl(stored, 300);
    expect(downloadUrl).toBe(
      'https://www.googleapis.com/drive/v3/files/drive-file-1?alt=media&access_token=drive-token'
    );
    expect(googleAuthAccessTokenMock).toHaveBeenCalled();
  });

  it('propagates Google Drive upload errors', async () => {
    driveFilesCreate.mockRejectedValue(new Error('drive upload failed'));

    await resetReceiptStorageCache();
    const storage = await getReceiptStorageActual();

    await expect(
      storage.upload({
        reportId: 'rep-10',
        expenseId: 'exp-3',
        fileName: 'receipt.pdf',
        contentType: 'application/pdf',
        data: Buffer.from('pdf'),
      })
    ).rejects.toThrow('drive upload failed');
  });
});
