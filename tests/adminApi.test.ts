import { Buffer } from 'node:buffer';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { unzipSync } from 'fflate';

const adminUserFindUnique = vi.fn();
const reportFindMany = vi.fn();
const getReceiptStorage = vi.fn();
const downloadUrlMock = vi.fn();

vi.mock('../server/src/lib/prisma.js', () => ({
  prisma: {
    adminUser: {
      findUnique: adminUserFindUnique
    },
    report: {
      findMany: reportFindMany
    }
  }
}));

vi.mock('../server/src/lib/receiptStorage.js', () => ({
  getReceiptStorage,
}));

const importApp = async () => {
  const module = await import('../server/src/app.ts');
  return module.default;
};

const hashedPassword = '$2a$10$6szdT0Ir.ksjzE5K0e90gePHGWhfsB5hugPuhPghsrPc7hiDhinCm';

function binaryParser(res, callback) {
  res.setEncoding('binary');
  const chunks: Buffer[] = [];
  res.on('data', (chunk) => chunks.push(Buffer.from(chunk, 'binary')));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

describe('admin authentication and exports', () => {
  beforeEach(() => {
    process.env.ADMIN_JWT_SECRET = 'test-secret';
    adminUserFindUnique.mockReset();
    reportFindMany.mockReset();
    getReceiptStorage.mockReset();
    downloadUrlMock.mockReset();
    getReceiptStorage.mockResolvedValue({
      getDownloadUrl: downloadUrlMock,
    });
  });

  it('rejects report exports without a valid session', async () => {
    const app = await importApp();

    const response = await request(app)
      .get('/api/admin/reports')
      .query({ start: '2024-01-01', end: '2024-01-31' });

    expect(response.status).toBe(401);
    expect(reportFindMany).not.toHaveBeenCalled();
  });

  it('logs in a CFO user and returns the active session', async () => {
    const app = await importApp();

    const adminRecord = {
      id: 'admin-1',
      username: 'cfo',
      passwordHash: hashedPassword,
      role: 'CFO'
    };

    adminUserFindUnique.mockImplementation(async ({ where }) => {
      if ('username' in where && where.username === 'cfo') {
        return adminRecord;
      }

      if ('id' in where && where.id === 'admin-1') {
        return adminRecord;
      }

      return null;
    });

    const loginResponse = await request(app)
      .post('/api/admin/login')
      .send({ username: 'CFO', password: 'SuperSecret!1' });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.user).toMatchObject({ username: 'cfo', role: 'CFO' });
    const [cookie] = loginResponse.get('set-cookie');
    expect(cookie).toContain('admin_session');

    const sessionResponse = await request(app)
      .get('/api/admin/session')
      .set('Cookie', cookie)
      .expect(200);

    expect(sessionResponse.body.user).toMatchObject({ username: 'cfo', role: 'CFO' });
  });

  it('prevents non-privileged roles from downloading exports', async () => {
    const app = await importApp();

    const analystRecord = {
      id: 'admin-2',
      username: 'analyst',
      passwordHash: hashedPassword,
      role: 'ANALYST'
    };

    adminUserFindUnique.mockImplementation(async ({ where }) => {
      if ('username' in where && where.username === 'analyst') {
        return analystRecord;
      }

      if ('id' in where && where.id === 'admin-2') {
        return analystRecord;
      }

      return null;
    });

    const loginResponse = await request(app)
      .post('/api/admin/login')
      .send({ username: 'analyst', password: 'SuperSecret!1' });

    expect(loginResponse.status).toBe(200);

    const [cookie] = loginResponse.get('set-cookie');
    expect(cookie).toBeDefined();

    const exportResponse = await request(app)
      .get('/api/admin/reports')
      .set('Cookie', cookie)
      .query({ start: '2024-02-01', end: '2024-02-28' });

    expect(exportResponse.status).toBe(403);
    expect(reportFindMany).not.toHaveBeenCalled();
  });

  it('streams a ZIP archive containing CSV exports for the requested range', async () => {
    const app = await importApp();

    const adminRecord = {
      id: 'admin-9',
      username: 'finance-chief',
      passwordHash: hashedPassword,
      role: 'CFO'
    };

    adminUserFindUnique.mockImplementation(async ({ where }) => {
      if ('username' in where && where.username === 'finance-chief') {
        return adminRecord;
      }

      if ('id' in where && where.id === 'admin-9') {
        return adminRecord;
      }

      return null;
    });

    reportFindMany.mockResolvedValue([
      {
        reportId: 'rep-123',
        employeeEmail: 'Employee@example.com',
        finalizedAt: new Date('2024-03-05T12:00:00Z'),
        finalizedYear: 2024,
        finalizedMonth: 3,
        finalizedWeek: 10,
        header: { department: 'Logistics' },
        totals: { submitted: 250.75 },
        expenses: [
          {
            id: 'exp-1',
            reportId: 'rep-123',
            externalId: null,
            category: 'travel',
            description: 'Airfare',
            amount: { toString: () => '150.25' },
            currency: 'USD',
            incurredAt: new Date('2024-03-01T00:00:00Z'),
            metadata: { payment: 'company' }
          },
          {
            id: 'exp-2',
            reportId: 'rep-123',
            externalId: 'CC-42',
            category: 'meals',
            description: 'Client dinner',
            amount: { toString: () => '100.50' },
            currency: 'USD',
            incurredAt: null,
            metadata: null
          }
        ],
        receipts: [
          {
            id: 'rcpt-1',
            reportId: 'rep-123',
            clientExpenseId: 'exp-1',
            expenseId: 'exp-1',
            fileName: 'airfare.pdf',
            contentType: 'application/pdf',
            fileSize: 102400,
            storageProvider: 'memory',
            storageBucket: 'memory',
            storageKey: 'rep-123/exp-1/airfare.pdf',
            storageUrl: null,
          }
        ]
      }
    ]);

    downloadUrlMock.mockResolvedValue('https://example.com/receipts/rcpt-1');

    const loginResponse = await request(app)
      .post('/api/admin/login')
      .send({ username: 'Finance-Chief', password: 'SuperSecret!1' });

    const [cookie] = loginResponse.get('set-cookie');

    const exportResponse = await request(app)
      .get('/api/admin/reports')
      .set('Cookie', cookie)
      .query({
        start: '2024-03-01',
        end: '2024-03-31',
        employees: 'employee@example.com'
      })
      .buffer()
      .parse(binaryParser)
      .expect(200);

    expect(exportResponse.headers['content-type']).toBe('application/zip');

    const zipEntries = unzipSync(new Uint8Array(exportResponse.body));
    expect(zipEntries['receipts.csv']).toBeDefined();
    const reportsCsv = new TextDecoder().decode(zipEntries['reports.csv']);
    const expensesCsv = new TextDecoder().decode(zipEntries['expenses.csv']);
    const receiptsCsv = new TextDecoder().decode(zipEntries['receipts.csv']);

    expect(reportsCsv).toContain('rep-123');
    expect(reportsCsv).toContain('employee@example.com');
    expect(expensesCsv).toContain('exp-1');
    expect(expensesCsv).toContain('Airfare');
    expect(receiptsCsv).toContain('rcpt-1');
    expect(receiptsCsv).toContain('https://example.com/receipts/rcpt-1');
    expect(downloadUrlMock).toHaveBeenCalled();

    const callArgs = reportFindMany.mock.calls.at(-1)?.[0];
    expect(callArgs?.where?.finalizedAt?.gte.toISOString()).toBe(new Date('2024-03-01').toISOString());
    expect(callArgs?.where?.finalizedAt?.lte.toISOString()).toBe(new Date('2024-03-31').toISOString());
    expect(callArgs?.where?.employeeEmail?.in).toEqual(['employee@example.com']);
  });
});
