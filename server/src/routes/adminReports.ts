import { Router } from 'express';
import archiver from 'archiver';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { getReceiptStorage } from '../lib/receiptStorage.js';
import { requireAdmin } from '../middleware/adminAuth.js';

const router = Router();

const querySchema = z
  .object({
    start: z.string().min(1),
    end: z.string().min(1),
    employees: z.union([z.string(), z.array(z.string())]).optional()
  })
  .transform((value) => {
    const startDate = new Date(value.start);
    const endDate = new Date(value.end);

    if (Number.isNaN(startDate.getTime())) {
      throw new Error('Invalid start date');
    }

    if (Number.isNaN(endDate.getTime())) {
      throw new Error('Invalid end date');
    }

    const employeesRaw = value.employees;
    const employees = Array.isArray(employeesRaw)
      ? employeesRaw
      : typeof employeesRaw === 'string'
      ? employeesRaw.split(',')
      : [];

    const normalizedEmployees = employees
      .map((employee) => employee.trim().toLowerCase())
      .filter(Boolean);

    return {
      start: startDate,
      end: endDate,
      employees: normalizedEmployees.length > 0 ? normalizedEmployees : undefined
    };
  });

function csvValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  const stringValue = String(value);

  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

router.get('/', requireAdmin(), async (req, res, next) => {
  let parsed;
  try {
    parsed = querySchema.parse(req.query);
  } catch (error) {
    return res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid query' });
  }

  if (parsed.start > parsed.end) {
    return res.status(400).json({ message: 'Start date must be before or equal to end date' });
  }

  try {
    const reports = await prisma.report.findMany({
      where: {
        finalizedAt: {
          gte: parsed.start,
          lte: parsed.end
        },
        ...(parsed.employees
          ? {
              employeeEmail: {
                in: parsed.employees
              }
            }
          : {})
      },
      include: {
        expenses: {
          orderBy: { incurredAt: 'asc' }
        },
        receipts: {
          orderBy: { uploadedAt: 'asc' }
        }
      },
      orderBy: { finalizedAt: 'asc' }
    });

    const storage = await getReceiptStorage();

    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('error', (error: Error) => {
      next(error);
    });

    const startLabel = parsed.start.toISOString().slice(0, 10);
    const endLabel = parsed.end.toISOString().slice(0, 10);
    const filename = `reports_${startLabel}_${endLabel}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');

    archive.pipe(res);

    const reportLines = [
      [
        'report_id',
        'employee_email',
        'finalized_at',
        'finalized_year',
        'finalized_month',
        'finalized_week',
        'header_json',
        'totals_json'
      ].join(',')
    ];

    const expenseLines = [
      [
        'report_id',
        'expense_id',
        'external_id',
        'category',
        'description',
        'amount',
        'currency',
        'incurred_at',
        'metadata_json'
      ].join(',')
    ];

    const receiptLines = [
      [
        'report_id',
        'receipt_id',
        'client_expense_id',
        'expense_id',
        'file_name',
        'content_type',
        'file_size',
        'storage_provider',
        'storage_bucket',
        'storage_key',
        'download_url'
      ].join(',')
    ];

    for (const report of reports) {
      reportLines.push(
        [
          csvValue(report.reportId),
          csvValue(report.employeeEmail.toLowerCase()),
          csvValue(report.finalizedAt.toISOString()),
          csvValue(report.finalizedYear),
          csvValue(report.finalizedMonth),
          csvValue(report.finalizedWeek),
          csvValue(report.header ? JSON.stringify(report.header) : ''),
          csvValue(report.totals ? JSON.stringify(report.totals) : '')
        ].join(',')
      );

      for (const expense of report.expenses) {
        const metadataRaw =
          expense.metadata === null || typeof expense.metadata === 'undefined'
            ? ''
            : JSON.stringify(expense.metadata);
        const metadataValue = metadataRaw === 'null' ? '' : metadataRaw;

        expenseLines.push(
          [
            csvValue(report.reportId),
            csvValue(expense.id),
            csvValue(expense.externalId ?? ''),
            csvValue(expense.category),
            csvValue(expense.description ?? ''),
            csvValue(expense.amount.toString()),
            csvValue(expense.currency),
            csvValue(expense.incurredAt ? expense.incurredAt.toISOString() : ''),
            csvValue(metadataValue)
          ].join(',')
        );
      }

      for (const receipt of report.receipts) {
        const downloadUrl = await storage.getDownloadUrl(
          {
            storageProvider: receipt.storageProvider,
            storageBucket: receipt.storageBucket,
            storageKey: receipt.storageKey,
            storageUrl: receipt.storageUrl,
          },
          Number(process.env.RECEIPT_URL_TTL_SECONDS ?? 900)
        );

        receiptLines.push(
          [
            csvValue(report.reportId),
            csvValue(receipt.id),
            csvValue(receipt.clientExpenseId),
            csvValue(receipt.expenseId ?? ''),
            csvValue(receipt.fileName),
            csvValue(receipt.contentType),
            csvValue(receipt.fileSize),
            csvValue(receipt.storageProvider),
            csvValue(receipt.storageBucket ?? ''),
            csvValue(receipt.storageKey),
            csvValue(downloadUrl ?? receipt.storageUrl ?? ''),
          ].join(',')
        );
      }
    }

    archive.append(reportLines.join('\n'), { name: 'reports.csv' });
    archive.append(expenseLines.join('\n'), { name: 'expenses.csv' });
    archive.append(receiptLines.join('\n'), { name: 'receipts.csv' });

    await archive.finalize();
  } catch (error) {
    return next(error);
  }
});

export default router;
