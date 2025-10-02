import dotenv from 'dotenv';
import app from './app.js';

dotenv.config();

const port = Number.parseInt(process.env.PORT ?? '3000', 10);

app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});
