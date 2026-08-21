/**
 * 非同期ジョブストア（永続化対応）
 *
 * generateリクエストをバックグラウンド実行し、
 * SSEで進捗をクライアントに通知する。
 *
 * 状態は環境変数 JOB_STORE で切り替え:
 *   - "memory" (デフォルト): プロセスローカル
 *   - "dynamodb": DynamoDB（同じテーブルにjob:プレフィックスで保存）
 */

import { EventEmitter } from 'node:events';
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb';

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface JobProgress {
  step: string;
  message: string;
  percent: number;
}

export interface JobState {
  id: string;
  status: JobStatus;
  progress: JobProgress;
  sessionId?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Job extends JobState {
  emitter: EventEmitter;
}

const JOB_TTL_SECONDS = 60 * 30; // 30分
const ID_PREFIX = 'job:';

// ローカルEventEmitterはプロセス内で保持（SSE用）
const emitters = new Map<string, EventEmitter>();

let dynamoClient: DynamoDBClient | null = null;
function getDynamo(): DynamoDBClient | null {
  if (process.env.JOB_STORE !== 'dynamodb') return null;
  if (!dynamoClient) {
    dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });
  }
  return dynamoClient;
}

const inMemoryStore = new Map<string, JobState>();

export function createJobId(): string {
  return `j_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function createJob(): Promise<Job> {
  const now = Date.now();
  const state: JobState = {
    id: createJobId(),
    status: 'pending',
    progress: { step: 'initializing', message: '初期化中...', percent: 0 },
    createdAt: now,
    updatedAt: now,
  };
  await persistJobState(state);
  const emitter = new EventEmitter();
  emitters.set(state.id, emitter);
  return { ...state, emitter };
}

export async function getJob(id: string): Promise<Job | undefined> {
  const state = await loadJobState(id);
  if (!state) return undefined;
  let emitter = emitters.get(id);
  if (!emitter) {
    emitter = new EventEmitter();
    emitters.set(id, emitter);
  }
  return { ...state, emitter };
}

export async function updateJobProgress(id: string, progress: JobProgress): Promise<void> {
  const state = await loadJobState(id);
  if (!state) return;
  state.progress = progress;
  state.status = 'running';
  state.updatedAt = Date.now();
  await persistJobState(state);
  emitters.get(id)?.emit('progress', progress);
}

export async function completeJob(id: string, sessionId: string): Promise<void> {
  const state = await loadJobState(id);
  if (!state) return;
  state.status = 'completed';
  state.sessionId = sessionId;
  state.progress = { step: 'completed', message: '完了', percent: 100 };
  state.updatedAt = Date.now();
  await persistJobState(state);
  emitters.get(id)?.emit('completed', { sessionId });
}

export async function failJob(id: string, error: string): Promise<void> {
  const state = await loadJobState(id);
  if (!state) return;
  state.status = 'failed';
  state.error = error;
  state.updatedAt = Date.now();
  await persistJobState(state);
  emitters.get(id)?.emit('failed', { error });
}

// ── 内部 ──

async function persistJobState(state: JobState): Promise<void> {
  inMemoryStore.set(state.id, state);
  cleanupMemory();

  const client = getDynamo();
  if (!client) return;

  const tableName = process.env.SESSION_TABLE_NAME;
  if (!tableName) return;

  const expiresAt = Math.floor(Date.now() / 1000) + JOB_TTL_SECONDS;
  await client.send(
    new PutItemCommand({
      TableName: tableName,
      Item: {
        id: { S: ID_PREFIX + state.id },
        expiresAt: { N: String(expiresAt) },
        data: { S: JSON.stringify(state) },
      },
    }),
  );
}

async function loadJobState(id: string): Promise<JobState | undefined> {
  // メモリキャッシュ優先（同一プロセスならEventEmitterと一貫性が取れる）
  const cached = inMemoryStore.get(id);
  if (cached) return cached;

  const client = getDynamo();
  if (!client) return undefined;

  const tableName = process.env.SESSION_TABLE_NAME;
  if (!tableName) return undefined;

  const res = await client.send(
    new GetItemCommand({
      TableName: tableName,
      Key: { id: { S: ID_PREFIX + id } },
    }),
  );
  if (!res.Item?.data?.S) return undefined;

  try {
    const state = JSON.parse(res.Item.data.S) as JobState;
    inMemoryStore.set(id, state);
    return state;
  } catch {
    return undefined;
  }
}

function cleanupMemory(): void {
  const now = Date.now();
  const maxAge = JOB_TTL_SECONDS * 1000;
  for (const [id, s] of inMemoryStore.entries()) {
    if (now - s.createdAt > maxAge) {
      inMemoryStore.delete(id);
      emitters.delete(id);
    }
  }
}
