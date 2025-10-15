import app from './app.js';
import { getConfig } from './config.js';

const {
  server: { port },
} = getConfig();

app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});
