import { beforeEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('../server/src/lib/receiptStorage.js', () => ({
  getReceiptStorage: vi.fn(),
  RECEIPT_ALLOWED_MIME_PREFIXES: ['image/'],
  RECEIPT_ALLOWED_MIME_TYPES: new Set(['application/pdf']),
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
