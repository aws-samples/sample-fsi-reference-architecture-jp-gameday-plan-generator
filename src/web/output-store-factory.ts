/**
 * OutputStore ファクトリ
 *
 * 環境変数 OUTPUT_STORE で切り替え:
 *   - "fs" (デフォルト): FsOutputStore (要 baseDir)
 *   - "s3": S3OutputStore (要 OUTPUT_BUCKET_NAME, OUTPUT_KEY_PREFIX 任意)
 */

import type { OutputStore } from './output-store.js';
import { FsOutputStore } from './output-store-fs.js';
import { S3OutputStore } from './output-store-s3.js';

let instance: OutputStore | null = null;

export function getOutputStore(localBaseDir: string): OutputStore {
  if (instance) return instance;

  const type = process.env.OUTPUT_STORE ?? 'fs';

  if (type === 's3') {
    const bucket = process.env.OUTPUT_BUCKET_NAME;
    if (!bucket) throw new Error('OUTPUT_BUCKET_NAME environment variable is required for s3 store');
    const prefix = process.env.OUTPUT_KEY_PREFIX ?? '';
    console.log(`  📦 OutputStore: S3 (s3://${bucket}/${prefix})`);
    instance = new S3OutputStore(bucket, prefix);
  } else {
    console.log(`  📦 OutputStore: FS (${localBaseDir})`);
    instance = new FsOutputStore(localBaseDir);
  }

  return instance;
}
