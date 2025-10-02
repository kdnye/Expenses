import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import reportsRouter from './routes/reports.js';
import adminAuthRouter from './routes/adminAuth.js';
import adminReportsRouter from './routes/adminReports.js';
import adminApprovalsRouter from './routes/adminApprovals.js';
import receiptsRouter from './routes/receipts.js';
import { errorHandler } from './middleware/errorHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(helmet());
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

const rootDir = path.resolve(__dirname, '../../');
const publicDir = path.join(rootDir, 'public');
const adminHtmlPath = path.join(rootDir, 'admin.html');
const adminScriptPath = path.join(rootDir, 'src', 'admin.js');

if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
}

app.use('/api/reports', reportsRouter);
app.use('/api/receipts', receiptsRouter);
app.use('/api/admin', adminAuthRouter);
app.use('/api/admin/reports', adminReportsRouter);
app.use('/api/admin/approvals', adminApprovalsRouter);

const noCacheHeaders = {
  'Cache-Control': 'no-store',
  Pragma: 'no-cache'
} as const;

app.get('/admin', (req, res, next) => {
  if (!fs.existsSync(adminHtmlPath)) {
    return res.status(404).json({ message: 'Admin SPA not found' });
  }

  res.set(noCacheHeaders);
  res.sendFile(adminHtmlPath, (err) => {
    if (err) {
      next(err);
    }
  });
});

app.get('/src/admin.js', (req, res, next) => {
  if (!fs.existsSync(adminScriptPath)) {
    return res.status(404).json({ message: 'Admin script not found' });
  }

  res.set(noCacheHeaders);
  res.sendFile(adminScriptPath, (err) => {
    if (err) {
      next(err);
    }
  });
});

app.get('*', (req, res, next) => {
  const indexFile = path.join(publicDir, 'index.html');

  if (!fs.existsSync(indexFile)) {
    return res.status(404).json({
      message: 'SPA build not found. Ensure the /public directory contains index.html.'
    });
  }

  res.sendFile(indexFile, (err) => {
    if (err) {
      next(err);
    }
  });
});

app.use(errorHandler);

export default app;
