/**
 * 出力ファイルストア抽象化
 *
 * ローカル（filesystem）と本番（S3）を切り替え可能にする。
 */

import type { Application } from 'express';

export interface OutputStore {
  /** キー（相対パス）でファイルを書き込み */
  put(key: string, content: string | Buffer, contentType?: string): Promise<void>;

  /** テキスト書き込み（gameday-plan.md等） */
  writeText(key: string, content: string): Promise<void>;

  /** JSON書き込み */
  writeJson(key: string, data: unknown): Promise<void>;

  /** HTML書き込み */
  writeHtml(key: string, html: string): Promise<void>;

  /** キーでファイル読み込み */
  get(key: string): Promise<string | undefined>;

  /** /output/* の静的配信ミドルウェアをExpressアプリに登録 */
  writeStaticMiddleware(app: Application, prefix?: string): void;
}
