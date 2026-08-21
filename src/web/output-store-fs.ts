/**
 * ローカルファイルシステム実装
 */

import fs from 'node:fs';
import path from 'node:path';
import express, { type Application } from 'express';
import type { OutputStore } from './output-store.js';

export class FsOutputStore implements OutputStore {
  constructor(private baseDir: string) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  async put(key: string, content: string | Buffer): Promise<void> {
    const full = path.join(this.baseDir, key);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }

  async writeText(key: string, content: string): Promise<void> {
    return this.put(key, content);
  }

  async writeJson(key: string, data: unknown): Promise<void> {
    return this.put(key, JSON.stringify(data, null, 2));
  }

  async writeHtml(key: string, html: string): Promise<void> {
    return this.put(key, html);
  }

  async get(key: string): Promise<string | undefined> {
    const full = path.join(this.baseDir, key);
    if (!fs.existsSync(full)) return undefined;
    return fs.readFileSync(full, 'utf-8');
  }

  writeStaticMiddleware(app: Application, prefix: string = '/output'): void {
    app.use(prefix, express.static(this.baseDir));
  }
}
