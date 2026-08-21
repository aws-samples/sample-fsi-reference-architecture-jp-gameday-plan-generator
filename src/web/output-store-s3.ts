/**
 * S3 出力ストア実装
 *
 * ALB経由のサーバーから直接S3にputし、配信もプロキシ経由。
 * 大量アクセスが想定される場合は署名付きURLやCloudFrontを推奨。
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import type { Application, Request, Response, NextFunction } from 'express';
import type { OutputStore } from './output-store.js';

function guessContentType(key: string, explicit?: string): string {
  if (explicit) return explicit;
  const ext = key.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    html: 'text/html; charset=utf-8',
    htm: 'text/html; charset=utf-8',
    json: 'application/json; charset=utf-8',
    md: 'text/markdown; charset=utf-8',
    txt: 'text/plain; charset=utf-8',
    yaml: 'text/yaml; charset=utf-8',
    yml: 'text/yaml; charset=utf-8',
    js: 'application/javascript; charset=utf-8',
    css: 'text/css; charset=utf-8',
  };
  return map[ext ?? ''] ?? 'application/octet-stream';
}

export class S3OutputStore implements OutputStore {
  private client: S3Client;

  constructor(
    private bucketName: string,
    private keyPrefix: string = '',
    region?: string,
  ) {
    this.client = new S3Client({ region: region ?? process.env.AWS_REGION });
  }

  private fullKey(key: string): string {
    const k = key.startsWith('/') ? key.slice(1) : key;
    return this.keyPrefix ? `${this.keyPrefix.replace(/\/$/, '')}/${k}` : k;
  }

  async put(key: string, content: string | Buffer, contentType?: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: this.fullKey(key),
        Body: content,
        ContentType: guessContentType(key, contentType),
      }),
    );
  }

  async writeText(key: string, content: string): Promise<void> {
    return this.put(key, content);
  }

  async writeJson(key: string, data: unknown): Promise<void> {
    return this.put(key, JSON.stringify(data, null, 2), 'application/json; charset=utf-8');
  }

  async writeHtml(key: string, html: string): Promise<void> {
    return this.put(key, html, 'text/html; charset=utf-8');
  }

  async get(key: string): Promise<string | undefined> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucketName,
          Key: this.fullKey(key),
        }),
      );
      const body = res.Body;
      if (!body) return undefined;
      // @ts-ignore - readable stream
      const chunks: Buffer[] = [];
      // @ts-ignore
      for await (const chunk of body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks).toString('utf-8');
    } catch {
      return undefined;
    }
  }

  writeStaticMiddleware(app: Application, prefix: string = '/output'): void {
    const self = this;
    app.use(prefix, async (req: Request, res: Response, _next: NextFunction) => {
      const key = req.path.replace(/^\//, '');
      if (!key) {
        res.status(404).send('Not Found');
        return;
      }
      try {
        const s3res = await self.client.send(
          new GetObjectCommand({
            Bucket: self.bucketName,
            Key: self.fullKey(key),
          }),
        );
        if (s3res.ContentType) res.setHeader('Content-Type', s3res.ContentType);
        // @ts-ignore
        for await (const chunk of s3res.Body) {
          res.write(chunk);
        }
        res.end();
      } catch {
        res.status(404).send('Not Found');
      }
    });
  }
}
