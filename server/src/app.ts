import express from 'express';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import reportsRouter from './routes/reports.js';
import { errorHandler } from './middleware/errorHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(helmet());
app.use(express.json({ limit: '1mb' }));

const publicDir = path.resolve(__dirname, '../../public');
app.use(express.static(publicDir));

app.use('/api/reports', reportsRouter);

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
