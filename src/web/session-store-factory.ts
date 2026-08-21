/**
 * SessionStore ファクトリ
 *
 * 環境変数 SESSION_STORE で切り替え:
 *   - "memory" (デフォルト): MemorySessionStore
 *   - "dynamodb": DynamoDBSessionStore (要 SESSION_TABLE_NAME)
 */

import type { SessionStore } from './session-store.js';
import { MemorySessionStore } from './session-store-memory.js';
import { DynamoDBSessionStore } from './session-store-dynamodb.js';

let instance: SessionStore | null = null;

export function getSessionStore(): SessionStore {
  if (instance) return instance;

  const type = process.env.SESSION_STORE ?? 'memory';

  if (type === 'dynamodb') {
    const tableName = process.env.SESSION_TABLE_NAME;
    if (!tableName) throw new Error('SESSION_TABLE_NAME environment variable is required for dynamodb store');
    console.log(`  🗄️  SessionStore: DynamoDB (${tableName})`);
    instance = new DynamoDBSessionStore(tableName);
  } else {
    console.log('  🗄️  SessionStore: Memory');
    instance = new MemorySessionStore();
  }

  return instance;
}
