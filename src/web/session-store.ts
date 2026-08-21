/**
 * セッションストア抽象化
 *
 * ローカル（インメモリ）と本番（DynamoDB）を切り替え可能にする。
 */

import type {
  GameDayPlan,
  FailureScenario,
  ObservationPoint,
  EvaluationCriteria,
  InfraConfig,
  PlanOptions,
} from '../types/index.js';

export interface Session {
  id: string;
  createdAt: number;
  config: InfraConfig;
  scenarios: FailureScenario[];
  plan: GameDayPlan;
  observations: ObservationPoint[];
  evaluations: EvaluationCriteria[];
  planOptions: PlanOptions;
  advice: string;
  chatHistory: ChatMessage[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface SessionStore {
  save(session: Session): Promise<void>;
  get(id: string): Promise<Session | undefined>;
  update(id: string, patch: Partial<Session>): Promise<Session | undefined>;
  delete(id: string): Promise<boolean>;
  /** 最近のセッションをリスト（新しい順、最大limit件） */
  list(limit?: number): Promise<SessionSummary[]>;
}

/** リスト表示用の軽量サマリー */
export interface SessionSummary {
  id: string;
  createdAt: number;
  title: string;
  scenarioCount: number;
  duration: string;
  /** AI分析アドバイス（マークダウン） */
  advice?: string;
  /** リソース数 */
  resourceCount: number;
  /** 重大度別シナリオ数 */
  severityBreakdown: { Critical: number; High: number; Medium: number; Low: number };
  /** 観測ポイント数 */
  observationCount: number;
  /** 評価基準数 */
  evaluationCount: number;
  /** マルチリージョン構成か */
  isMultiRegion: boolean;
  /** 暗号化あり */
  hasEncryption: boolean;
  /** リージョン一覧 */
  regions: string[];
}

export function createSessionId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
