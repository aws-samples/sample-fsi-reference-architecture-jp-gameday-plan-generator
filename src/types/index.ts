import { z } from 'zod';

// ============================================================
// Input Format & Error Types
// ============================================================

export type InputFormat = 'cdk-typescript' | 'cdk-python' | 'cfn-json' | 'cfn-yaml';

export interface ParseError {
  line: number;
  column: number;
  message: string;
  source: string;
}

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

// ============================================================
// 構成情報（中間表現）
// ============================================================

export interface EncryptionConfig {
  enabled: boolean;
  algorithm?: string;
  kmsKeyId?: string;
}

export interface AWSResource {
  logicalId: string;
  type: string;
  properties: Record<string, unknown>;
  region: string;
  tags?: Record<string, string>;
  encryption?: EncryptionConfig;
}

export interface ResourceDependency {
  source: string;
  target: string;
  type: 'hard' | 'soft';
}

export interface ConfigMetadata {
  parsedAt: string;
  sourceFile: string;
  resourceCount: number;
  isMultiRegion: boolean;
  hasEncryption: boolean;
  hasXRayTracing: boolean;
}


export interface InfraConfig {
  id: string;
  name: string;
  sourceFormat: InputFormat;
  regions: string[];
  resources: AWSResource[];
  dependencies: ResourceDependency[];
  metadata: ConfigMetadata;
}

// ============================================================
// 障害シナリオ
// ============================================================

export type ScenarioCategory =
  | 'infrastructure'
  | 'network'
  | 'data'
  | 'security'
  | 'operation';

export interface ScenarioStep {
  order: number;
  action: string;
  target: string;
  parameters?: Record<string, unknown>;
}

export interface FailureScenario {
  id: string;
  name: string;
  category: ScenarioCategory;
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  description: string;
  affectedResources: string[];
  impactScope: string;
  prerequisites: string[];
  steps: ScenarioStep[];
  expectedOutcome: string;
  rollbackSteps: string[];
  estimatedDuration: number;
  tags: string[];
  /** なぜこのシナリオが必要か（LLM生成 or ルールベース）。表示用。 */
  rationale?: string;
  /**
   * シナリオの実施可能性。
   * - fis-supported: AWS FIS でそのまま実施可能
   * - fis-alternative: FIS 直接対応はないが、SSM Run Command などで代替できる
   * - reference-only: 実環境での再現が困難。机上演習・参考シナリオとして残す
   */
  executability?: 'fis-supported' | 'fis-alternative' | 'reference-only';
  /** FIS 不可シナリオの代替手段の説明 (executability が fis-alternative / reference-only の場合) */
  alternativeApproach?: string;
  /**
   * このシナリオに紐づく評価基準。表示用にダッシュボード入口で詰める。
   * シナリオ詳細展開エリアに統合表示される（独立タブは廃止）。
   */
  evaluations?: EvaluationCriteria[];
}

// ============================================================
// GameDay実施計画
// ============================================================

export interface PlannedScenario {
  scenarioId: string;
  executionOrder: number;
  startTime: string;
  estimatedDuration: number;
  assignedTeam?: string;
}

export interface RoleAssignment {
  role: 'facilitator' | 'operator' | 'observer';
  description: string;
  responsibilities: string[];
  assignedCount: number;
}

export interface TimelineEntry {
  time: string;
  activity: string;
  scenarioId?: string;
  type: 'preparation' | 'execution' | 'review' | 'break';
}

export interface EscalationStep {
  condition: string;
  action: string;
  contactRole: string;
}

export interface GameDayPlan {
  id: string;
  title: string;
  duration: 'half-day' | 'full-day' | 'two-day';
  scenarios: PlannedScenario[];
  roles: RoleAssignment[];
  timeline: TimelineEntry[];
  escalationFlow: EscalationStep[];
  /**
   * 実施枠（duration）に収まりきらず、タイムラインに組み込まれなかったシナリオの ID。
   * 重大度の低いものから順に押し出される。空配列なら全シナリオが収まっている。
   */
  unscheduledScenarioIds: string[];
  /**
   * シナリオ実行に使える純粋な分数（duration 全体から準備・振り返り・休憩を除いたもの）。
   * UI/Markdown の警告表示で参照。
   */
  availableExecutionMinutes: number;
  /**
   * 全シナリオを実施するのに必要な最小実行分数（休憩なし、純粋な所要時間合計）。
   */
  totalRequestedMinutes: number;
}

export interface PlanOptions {
  duration: 'half-day' | 'full-day' | 'two-day';
  participantCount?: number;
  teamCount?: number;
}


// ============================================================
// FIS実験テンプレート
// ============================================================

export interface FISTargetFilter {
  path: string;
  values: string[];
}

export interface FISTarget {
  resourceType: string;
  resourceArns?: string[];
  resourceTags?: Record<string, string>;
  filters?: FISTargetFilter[];
  selectionMode: 'ALL' | 'COUNT' | 'PERCENT';
  parameters?: Record<string, string>;
}

export interface FISAction {
  actionId: string;
  description?: string;
  parameters?: Record<string, string>;
  targets?: Record<string, string>;
  startAfter?: string[];
  duration?: string;
}

export interface FISStopCondition {
  source: string;
  value?: string;
}

export interface FISExperimentTemplate {
  description: string;
  targets: Record<string, FISTarget>;
  actions: Record<string, FISAction>;
  stopConditions: FISStopCondition[];
  roleArn: string;
  tags: Record<string, string>;
}

// ============================================================
// 観測ポイント
// ============================================================

export interface CloudWatchConfig {
  namespace?: string;
  metricName?: string;
  dimensions?: Record<string, string>;
  statistic?: string;
  period?: number;
  alarmActions?: string[];
  logGroupName?: string;
  filterPattern?: string;
}

export interface ObservationPoint {
  id: string;
  scenarioId: string;
  type: 'metric' | 'alarm' | 'log-filter' | 'xray-trace';
  name: string;
  description: string;
  normalRange: { min?: number; max?: number };
  threshold: number;
  checkTiming: 'before' | 'during' | 'after';
  cloudwatchConfig: CloudWatchConfig;
}

// ============================================================
// 評価基準
// ============================================================

export interface EvaluationCriteria {
  id: string;
  scenarioId: string;
  name: string;
  type: 'detection-time' | 'recovery-time' | 'impact-accuracy' | 'communication';
  targetValue: number;
  unit: string;
  passThreshold: number;
  failThreshold: number;
}

export interface CriteriaResult {
  criteriaId: string;
  actualValue: number;
  passed: boolean;
  comment?: string;
}

export interface ScenarioScore {
  scenarioId: string;
  criteriaResults: CriteriaResult[];
  passed: boolean;
}

export interface ScoringReport {
  overallScore: number;
  scenarioScores: ScenarioScore[];
  improvements: string[];
  generatedAt: string;
}


// ============================================================
// ダッシュボード & GameDay結果
// ============================================================

export interface GameDayResult {
  planId: string;
  executedAt: string;
  scenarioResults: ScenarioScore[];
  overallScore: number;
}

export interface DashboardData {
  plan: GameDayPlan;
  scenarios: FailureScenario[];
  observations: ObservationPoint[];
  evaluations: EvaluationCriteria[];
  pastResults?: GameDayResult[];
  sessionId?: string;
  chatHistory?: Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }>;
  /** シナリオ別 FIS デプロイ情報 (CFn対応シナリオのみ)。タブで表示される */
  fisDeployments?: FISDeploymentInfo[];
  /** AI分析レポート（generateAdvice の Markdown） */
  advice?: string;
  /** 構成情報（レポートタブの「構成サマリー」表示に利用） */
  config?: InfraConfig;
  /** タイムラインエントリ毎の rationale (キーは entry インデックス) */
  timelineRationales?: Record<number, string>;
}

/** ダッシュボード用 FISデプロイ情報。CFnテンプレ + 各種コマンド/URLを含む */
export interface FISDeploymentInfo {
  scenarioId: string;
  scenarioName: string;
  /** デプロイ可能な CFn テンプレート (JSON) */
  cfnTemplate: object;
  /** AWS CLI deploy コマンド */
  deployCommand: string;
  /** CloudFormation コンソール ディープリンク (quickcreate) */
  consoleDeepLink: string;
  /** 個別 CFn ダウンロード URL (セッションが存在する場合のみ) */
  downloadUrl?: string;
}
// ============================================================
// Zodスキーマ定義
// ============================================================

// --- InfraConfig バリデーション用 ---

export const InputFormatSchema = z.enum([
  'cdk-typescript',
  'cdk-python',
  'cfn-json',
  'cfn-yaml',
]);

export const EncryptionConfigSchema = z.object({
  enabled: z.boolean(),
  algorithm: z.string().optional(),
  kmsKeyId: z.string().optional(),
});

export const AWSResourceSchema = z.object({
  logicalId: z.string().min(1),
  type: z.string().min(1),
  properties: z.record(z.unknown()),
  region: z.string().min(1),
  tags: z.record(z.string()).optional(),
  encryption: EncryptionConfigSchema.optional(),
});

export const ResourceDependencySchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  type: z.enum(['hard', 'soft']),
});

export const ConfigMetadataSchema = z.object({
  parsedAt: z.string().min(1),
  sourceFile: z.string().min(1),
  resourceCount: z.number().int().nonnegative(),
  isMultiRegion: z.boolean(),
  hasEncryption: z.boolean(),
  hasXRayTracing: z.boolean(),
});

export const InfraConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  sourceFormat: InputFormatSchema,
  regions: z.array(z.string().min(1)),
  resources: z.array(AWSResourceSchema),
  dependencies: z.array(ResourceDependencySchema),
  metadata: ConfigMetadataSchema,
});

// --- FISExperimentTemplate バリデーション用 ---

export const FISTargetFilterSchema = z.object({
  path: z.string().min(1),
  values: z.array(z.string()),
});

export const FISTargetSchema = z.object({
  resourceType: z.string().min(1),
  resourceArns: z.array(z.string()).optional(),
  resourceTags: z.record(z.string()).optional(),
  filters: z.array(FISTargetFilterSchema).optional(),
  selectionMode: z.enum(['ALL', 'COUNT', 'PERCENT']),
  parameters: z.record(z.string()).optional(),
});

export const FISActionSchema = z.object({
  actionId: z.string().min(1),
  description: z.string().optional(),
  parameters: z.record(z.string()).optional(),
  targets: z.record(z.string()).optional(),
  startAfter: z.array(z.string()).optional(),
  duration: z.string().optional(),
});

export const FISStopConditionSchema = z.object({
  source: z.string().min(1),
  value: z.string().optional(),
});

export const FISExperimentTemplateSchema = z.object({
  description: z.string(),
  targets: z.record(FISTargetSchema),
  actions: z.record(FISActionSchema),
  stopConditions: z.array(FISStopConditionSchema),
  roleArn: z.string().min(1),
  tags: z.record(z.string()),
});
