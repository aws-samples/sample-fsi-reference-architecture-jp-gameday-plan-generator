/**
 * DynamoDB SessionStore 実装
 *
 * 本番環境（ECS/Lambda）用。TTLで自動削除。
 *
 * DynamoDBテーブル構造:
 *   PK: id (String)
 *   TTL: expiresAt (Number, epoch seconds)
 *   data: JSON文字列（Sessionオブジェクト全体）
 */

import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  DeleteItemCommand,
  ScanCommand,
} from '@aws-sdk/client-dynamodb';
import type { Session, SessionStore, SessionSummary } from './session-store.js';
import { toSummary } from './session-store-memory.js';

const TTL_SECONDS = 60 * 60 * 24 * 7; // 7日

export class DynamoDBSessionStore implements SessionStore {
  private client: DynamoDBClient;

  constructor(
    private tableName: string,
    region?: string,
  ) {
    this.client = new DynamoDBClient({ region: region ?? process.env.AWS_REGION });
  }

  async save(session: Session): Promise<void> {
    const expiresAt = Math.floor(Date.now() / 1000) + TTL_SECONDS;
    await this.client.send(
      new PutItemCommand({
        TableName: this.tableName,
        Item: {
          id: { S: session.id },
          expiresAt: { N: String(expiresAt) },
          data: { S: JSON.stringify(session) },
        },
      }),
    );
  }

  async get(id: string): Promise<Session | undefined> {
    const res = await this.client.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: { id: { S: id } },
      }),
    );
    if (!res.Item?.data?.S) return undefined;
    try {
      return JSON.parse(res.Item.data.S) as Session;
    } catch {
      return undefined;
    }
  }

  async update(id: string, patch: Partial<Session>): Promise<Session | undefined> {
    const current = await this.get(id);
    if (!current) return undefined;
    const updated = { ...current, ...patch };
    await this.save(updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    await this.client.send(
      new DeleteItemCommand({
        TableName: this.tableName,
        Key: { id: { S: id } },
      }),
    );
    return true;
  }

  async list(limit = 50): Promise<SessionSummary[]> {
    // Scanで全件取得（展示用なので件数少ない前提）
    const res = await this.client.send(
      new ScanCommand({
        TableName: this.tableName,
        Limit: 200,
      }),
    );
    const items = res.Items ?? [];
    const sessions: Session[] = [];
    for (const item of items) {
      if (item.data?.S) {
        try {
          sessions.push(JSON.parse(item.data.S) as Session);
        } catch {
          // ignore
        }
      }
    }
    return sessions
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map(s => toSummary(s));
  }
}
