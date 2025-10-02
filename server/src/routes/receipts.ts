import { Router } from 'express';
import multer from 'multer';
import { createHash } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import {
  getReceiptStorage,
  RECEIPT_ALLOWED_MIME_PREFIXES,
  RECEIPT_ALLOWED_MIME_TYPES,
} from '../lib/receiptStorage.js';
import { authenticate } from '../middleware/authenticate.js';

const MAX_FILE_SIZE = Number(process.env.RECEIPT_MAX_BYTES ?? 10 * 1024 * 1024);
const MAX_FILE_COUNT = Number(process.env.RECEIPT_MAX_FILES ?? 5);
const SIGNED_URL_TTL_SECONDS = Number(process.env.RECEIPT_URL_TTL_SECONDS ?? 900);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILE_COUNT,
  },
});

const router = Router();

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return `${bytes}`;
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 10 ? 1 : 2)} MB`;
}

function isMimeAllowed(mime: string) {
  if (!mime) return false;
  if (RECEIPT_ALLOWED_MIME_TYPES.has(mime)) return true;
  return RECEIPT_ALLOWED_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix));
}

router.post('/', authenticate, (req, res, next) => {
  upload.array('files', MAX_FILE_COUNT)(req, res, async (err: unknown) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({
            message: `Each receipt must be smaller than ${formatBytes(MAX_FILE_SIZE)}.`,
          });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({
            message: `You can upload up to ${MAX_FILE_COUNT} receipt files per request.`,
          });
        }
        return res.status(400).json({ message: err.message });
      }

      return next(err);
    }

    const { reportId, expenseId } = req.body as {
      reportId?: string;
      expenseId?: string;
    };

    if (!reportId || !expenseId) {
      return res.status(400).json({ message: 'reportId and expenseId are required.' });
    }

    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) {
      return res.status(400).json({ message: 'Select at least one receipt to upload.' });
    }

    const disallowed = files.find((file) => !isMimeAllowed(file.mimetype));
    if (disallowed) {
      return res.status(415).json({ message: `Unsupported file type: ${disallowed.mimetype || disallowed.originalname}` });
    }

    try {
      const storage = await getReceiptStorage();
      const uploads = await Promise.all(
        files.map(async (file) => {
          const checksum = createHash('sha256').update(file.buffer).digest('hex');
          const stored = await storage.upload({
            reportId,
            expenseId,
            fileName: file.originalname,
            contentType: file.mimetype,
            data: file.buffer,
          });

          return {
            file,
            checksum,
            stored,
          };
        })
      );

      const created = await prisma.$transaction((tx) => {
        return Promise.all(
          uploads.map(({ file, checksum, stored }) =>
            tx.receipt.create({
              data: {
                reportId,
                clientExpenseId: expenseId,
                storageProvider: stored.storageProvider,
                storageBucket: stored.storageBucket,
                storageKey: stored.storageKey,
                storageUrl: stored.storageUrl,
                fileName: file.originalname,
                contentType: file.mimetype,
                fileSize: file.size,
                checksum,
              },
            })
          )
        );
      });

      const receiptsWithUrls = await Promise.all(
        created.map(async (receipt) => {
          const downloadUrl = await storage.getDownloadUrl(
            {
              storageProvider: receipt.storageProvider,
              storageBucket: receipt.storageBucket,
              storageKey: receipt.storageKey,
              storageUrl: receipt.storageUrl,
            },
            SIGNED_URL_TTL_SECONDS
          );

          return {
            ...receipt,
            downloadUrl,
          };
        })
      );

      return res.status(201).json({ receipts: receiptsWithUrls });
    } catch (error) {
      return next(error);
    }
  });
});

export default router;
