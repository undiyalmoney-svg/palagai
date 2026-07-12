import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const browserDir = join(process.cwd(), 'dist', 'palagai', 'browser');
const csr = join(browserDir, 'index.csr.html');
const index = join(browserDir, 'index.html');

if (existsSync(csr) && !existsSync(index)) {
  copyFileSync(csr, index);
  console.log('Created dist/palagai/browser/index.html from index.csr.html');
}
