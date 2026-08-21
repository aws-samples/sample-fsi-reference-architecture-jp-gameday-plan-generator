/**
 * セッション管理 - ファクトリ経由でストアを提供
 *
 * 後方互換のためこのモジュールがAPIの窓口。
 * 実体はmemory/dynamodbを環境変数で切り替え。
 */

export type { Session, ChatMessage, SessionSummary } from './session-store.js';
export { createSessionId } from './session-store.js';

import { getSessionStore } from './session-store-factory.js';
import type { Session, SessionSummary } from './session-store.js';

export async function saveSession(session: Session): Promise<void> {
  return getSessionStore().save(session);
}

export async function getSession(id: string): Promise<Session | undefined> {
  return getSessionStore().get(id);
}

export async function updateSession(id: string, patch: Partial<Session>): Promise<Session | undefined> {
  return getSessionStore().update(id, patch);
}

export async function deleteSession(id: string): Promise<boolean> {
  return getSessionStore().delete(id);
}

export async function listSessions(limit?: number): Promise<SessionSummary[]> {
  return getSessionStore().list(limit);
}
