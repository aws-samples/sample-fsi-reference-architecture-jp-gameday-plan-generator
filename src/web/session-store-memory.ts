/**
 * インメモリ SessionStore 実装
 *
 * ローカル開発・単一プロセス用。
 */

import type { Session, SessionStore, SessionSummary } from './session-store.js';

const MAX_AGE_MS = 1000 * 60 * 60 * 2; // 2時間

/** Session → SessionSummary 変換ヘルパー */
export function toSummary(s: Session): SessionSummary {
  const breakdown = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  for (const sc of s.scenarios ?? []) {
    if (sc.severity in breakdown) breakdown[sc.severity as keyof typeof breakdown]++;
  }
  return {
    id: s.id,
    createdAt: s.createdAt,
    title: s.plan?.title ?? 'Untitled',
    scenarioCount: s.scenarios?.length ?? 0,
    duration: s.planOptions?.duration ?? 'unknown',
    advice: s.advice,
    resourceCount: s.config?.resources?.length ?? 0,
    severityBreakdown: breakdown,
    observationCount: s.observations?.length ?? 0,
    evaluationCount: s.evaluations?.length ?? 0,
    isMultiRegion: s.config?.metadata?.isMultiRegion ?? false,
    hasEncryption: s.config?.metadata?.hasEncryption ?? false,
    regions: s.config?.regions ?? [],
  };
}

export class MemorySessionStore implements SessionStore {
  private sessions = new Map<string, Session>();

  async save(session: Session): Promise<void> {
    this.sessions.set(session.id, session);
    this.cleanup();
  }

  async get(id: string): Promise<Session | undefined> {
    return this.sessions.get(id);
  }

  async update(id: string, patch: Partial<Session>): Promise<Session | undefined> {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    const updated = { ...s, ...patch };
    this.sessions.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.sessions.delete(id);
  }

  async list(limit = 50): Promise<SessionSummary[]> {
    this.cleanup();
    const all = Array.from(this.sessions.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
    return all.map(s => toSummary(s));
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, s] of this.sessions.entries()) {
      if (now - s.createdAt > MAX_AGE_MS) this.sessions.delete(id);
    }
  }
}
