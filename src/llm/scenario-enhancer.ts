/**
 * LLMベースのシナリオ強化モジュール
 *
 * ルールベースで生成されたシナリオをLLMで分析・強化する。
 * - CFnテンプレートの構成を深く理解した追加シナリオの提案
 * - 既存シナリオの説明文・手順の充実化
 * - アーキテクチャ固有のリスク分析
 */

import { invokeLLM, extractJSON } from './bedrock-client.js';
import type { InfraConfig, FailureScenario, ScenarioCategory, ScenarioStep } from '../types/index.js';

// ── システムプロンプト ──

const SCENARIO_ANALYSIS_PROMPT = `あなたはAWS障害対応訓練（GameDay）の専門家です。
与えられたCloudFormation構成情報と既存の障害シナリオを分析し、
ルールベースでは検出できない追加の障害シナリオを提案してください。

以下の観点で分析してください:
1. リソース間の依存関係に起因するカスケード障害
2. 構成上の単一障害点（SPOF）
3. スケーリングやキャパシティに関する問題
4. セキュリティインシデントシナリオ
5. データ整合性に関する問題
6. 運用ミスに起因する障害

【重要】各シナリオごとに「実環境で再現可能か」を必ず判定してください:
- "fis-supported": AWS FIS でそのまま再現できる（EC2停止、RDSフェイルオーバー、ネットワーク遅延注入など）
- "fis-alternative": FIS では直接サポートされていないが、SSM Run Command / IAMポリシー一時変更 / セキュリティグループ操作などの代替手段で再現可能（S3アクセス拒否、SQSキューパージなど）
- "reference-only": 実環境での再現が現実的に困難。机上演習・Runbook整備・参考シナリオとして残すべきもの。例: ランサムウェア感染、長期データセンター火災、特定地域の災害、社内オペミスの複合パターン、人為的な悪意のある内部脅威

ルール:
- "reference-only" を提案する場合は、シナリオ数を盛りすぎない（多くて1〜2件）
- "fis-alternative" の場合は alternativeApproach に「具体的にどう再現するか」を 2〜3文で書く（例: "S3バケットポリシーに 'Effect: Deny' のステートメントを一時的に追加し、Lambda経由で5分後にロールバックする SSM Document を実行する"）
- "reference-only" の場合も alternativeApproach に「机上演習として何をどう議論するか」を簡潔に書く

出力はJSON配列形式で、各シナリオは以下の構造にしてください:
[
  {
    "name": "シナリオ名",
    "category": "infrastructure|network|data|security|operation",
    "severity": "Critical|High|Medium|Low",
    "executability": "fis-supported|fis-alternative|reference-only",
    "alternativeApproach": "代替手段または机上演習の進め方（fis-supported以外で必須、fis-supportedの場合は省略可）",
    "description": "詳細な説明",
    "affectedResources": ["影響を受けるリソースのlogicalId"],
    "impactScope": "影響範囲の説明",
    "prerequisites": ["前提条件"],
    "steps": [
      { "order": 1, "action": "アクション", "target": "対象" }
    ],
    "expectedOutcome": "期待される結果",
    "rollbackSteps": ["ロールバック手順"],
    "estimatedDuration": 30,
    "tags": ["タグ"]
  }
]

ルール:
- 既存シナリオと重複しないこと
- 各シナリオのaffectedResourcesは構成情報に含まれるリソースのlogicalIdを使用すること
- 最大5個までの追加シナリオを提案すること
- "reference-only" は最大1〜2件まで
- JSONのみを出力すること`;

const SCENARIO_DETAIL_PROMPT = `あなたはAWS障害対応訓練（GameDay）の専門家です。
与えられた障害シナリオの説明文と手順をより詳細で実践的な内容に強化してください。

各シナリオについて以下を改善してください:
1. description: より具体的な障害の発生メカニズムと影響の説明
2. steps: AWS CLIコマンドやコンソール操作を含む具体的な手順
3. expectedOutcome: 定量的な指標を含む期待結果
4. rollbackSteps: 具体的な復旧手順

出力はJSON配列形式で、入力と同じ構造のシナリオを返してください。
JSONのみを出力すること。`;

const ADVICE_PROMPT = `あなたはAWS障害対応訓練（GameDay）のシニアコンサルタントです。
与えられたシステム構成と生成された障害シナリオを分析し、
GameDay実施に関する実践的なアドバイスを日本語で提供してください。

以下の3セクションのみを、この見出し形式で出力してください:

## システム構成の特徴
このシステムのアーキテクチャ上の特徴を2〜3文で簡潔に説明する。

## 推奨するGameDayの焦点
特に重点的にテストすべきポイントを3〜5項目、箇条書き（- ）で。
各項目は1〜2文に収める。

## 注意すべきリスク
この構成特有の潜在的リスクを2〜3項目、箇条書き（- ）で。
各項目は1文に収める。

ルール:
- 上記3セクションのみ。「実施のコツ」など他のセクションは追加しない
- 見出しは必ず "## " で始める（"1. " のような番号付き見出しにはしない）
- 強調が必要な箇所のみ **太字** を使う。多用しない（1セクションあたり多くて2〜3箇所）
- 具体的なAWSサービス名やリソース名を使って説明する
- 数値や定量的な目標を含める（例: RTO 5分以内、検知時間3分以内）
- 表は使わず、箇条書きと短い文で読みやすくする
- プロフェッショナルだが堅すぎないトーンで`;

// ── 公開API ──

/**
 * LLMを使って追加シナリオを生成する
 *
 * ルールベースのシナリオ生成後に呼び出し、
 * アーキテクチャ固有の高度なシナリオを追加する。
 */
export async function generateLLMScenarios(
  config: InfraConfig,
  existingScenarios: FailureScenario[],
  modelKey?: string,
): Promise<FailureScenario[]> {
  // 構成情報のサマリーを作成（トークン節約）
  const configSummary = buildConfigSummary(config);
  const existingSummary = existingScenarios.map((s) => ({
    name: s.name,
    category: s.category,
    severity: s.severity,
    affectedResources: s.affectedResources,
  }));

  const result = await invokeLLM({
    systemPrompt: SCENARIO_ANALYSIS_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `## 構成情報\n${JSON.stringify(configSummary, null, 2)}\n\n## 既存シナリオ\n${JSON.stringify(existingSummary, null, 2)}\n\n上記の構成に対して、既存シナリオでカバーされていない追加の障害シナリオを提案してください。`,
          },
        ],
      },
    ],
    maxTokens: 8192,
    temperature: 0.4,
    model: modelKey,
  });

  if (!result.ok) {
    console.log(`    ⚠️  LLMシナリオ生成失敗: ${result.error}`);
    return [];
  }

  console.log(`    📊 トークン使用量: 入力=${result.usage.inputTokens}, 出力=${result.usage.outputTokens}`);

  try {
    const jsonStr = extractJSON(result.text);
    const rawScenarios = JSON.parse(jsonStr) as RawLLMScenario[];
    return rawScenarios.map((raw, i) => toLLMScenario(raw, existingScenarios.length + i + 1));
  } catch (err) {
    console.log(`    ⚠️  LLMレスポンスのパース失敗: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/**
 * LLMを使って既存シナリオの説明・手順を強化する
 */
export async function enhanceScenarioDetails(
  scenarios: FailureScenario[],
  config: InfraConfig,
): Promise<FailureScenario[]> {
  // シナリオが多い場合はバッチ処理（5個ずつ）
  const batchSize = 5;
  const enhanced: FailureScenario[] = [];

  for (let i = 0; i < scenarios.length; i += batchSize) {
    const batch = scenarios.slice(i, i + batchSize);
    const batchResult = await enhanceBatch(batch, config);
    enhanced.push(...batchResult);
  }

  return enhanced;
}

// ── 内部ヘルパー ──

interface RawLLMScenario {
  name: string;
  category: string;
  severity: string;
  description: string;
  affectedResources: string[];
  impactScope: string;
  prerequisites: string[];
  steps: Array<{ order: number; action: string; target: string; parameters?: Record<string, unknown> }>;
  expectedOutcome: string;
  rollbackSteps: string[];
  estimatedDuration: number;
  tags: string[];
  executability?: string;
  alternativeApproach?: string;
}

function toLLMScenario(raw: RawLLMScenario, index: number): FailureScenario {
  const validCategories: ScenarioCategory[] = ['infrastructure', 'network', 'data', 'security', 'operation'];
  const validSeverities = ['Critical', 'High', 'Medium', 'Low'] as const;
  const validExecutability = ['fis-supported', 'fis-alternative', 'reference-only'] as const;
  const exec = validExecutability.includes(raw.executability as typeof validExecutability[number])
    ? (raw.executability as FailureScenario['executability'])
    : undefined;

  return {
    id: `llm-scenario-${index}`,
    name: raw.name || `LLM生成シナリオ ${index}`,
    category: validCategories.includes(raw.category as ScenarioCategory)
      ? (raw.category as ScenarioCategory)
      : 'operation',
    severity: validSeverities.includes(raw.severity as typeof validSeverities[number])
      ? (raw.severity as FailureScenario['severity'])
      : 'Medium',
    description: raw.description || '',
    affectedResources: raw.affectedResources || [],
    impactScope: raw.impactScope || '',
    prerequisites: raw.prerequisites || [],
    steps: (raw.steps || []).map((s, si): ScenarioStep => ({
      order: s.order ?? si + 1,
      action: s.action || '',
      target: s.target || '',
      parameters: s.parameters,
    })),
    expectedOutcome: raw.expectedOutcome || '',
    rollbackSteps: raw.rollbackSteps || [],
    estimatedDuration: raw.estimatedDuration || 30,
    tags: [...(raw.tags || []), 'llm-generated'],
    executability: exec,
    alternativeApproach: raw.alternativeApproach,
  };
}

async function enhanceBatch(
  scenarios: FailureScenario[],
  config: InfraConfig,
): Promise<FailureScenario[]> {
  const configSummary = buildConfigSummary(config);

  const result = await invokeLLM({
    systemPrompt: SCENARIO_DETAIL_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `## 構成情報\n${JSON.stringify(configSummary, null, 2)}\n\n## 強化対象シナリオ\n${JSON.stringify(scenarios, null, 2)}\n\n上記シナリオの説明文と手順をより詳細で実践的な内容に強化してください。`,
          },
        ],
      },
    ],
    maxTokens: 8192,
    temperature: 0.3,
  });

  if (!result.ok) {
    console.log(`    ⚠️  シナリオ強化失敗: ${result.error}`);
    return scenarios; // 失敗時は元のシナリオをそのまま返す
  }

  try {
    const jsonStr = extractJSON(result.text);
    const enhanced = JSON.parse(jsonStr) as RawLLMScenario[];
    return enhanced.map((raw, i) => ({
      ...scenarios[i],
      description: raw.description || scenarios[i].description,
      steps: (raw.steps || []).map((s, si): ScenarioStep => ({
        order: s.order ?? si + 1,
        action: s.action || '',
        target: s.target || '',
        parameters: s.parameters,
      })),
      expectedOutcome: raw.expectedOutcome || scenarios[i].expectedOutcome,
      rollbackSteps: raw.rollbackSteps || scenarios[i].rollbackSteps,
    }));
  } catch {
    return scenarios;
  }
}

function buildConfigSummary(config: InfraConfig): object {
  return {
    name: config.name,
    regions: config.regions,
    isMultiRegion: config.metadata.isMultiRegion,
    hasEncryption: config.metadata.hasEncryption,
    hasXRayTracing: config.metadata.hasXRayTracing,
    resources: config.resources.map((r) => ({
      logicalId: r.logicalId,
      type: r.type,
      region: r.region,
      hasEncryption: r.encryption?.enabled ?? false,
    })),
    dependencies: config.dependencies,
  };
}

/**
 * LLMを使ってアーキテクチャ分析とGameDayアドバイスを生成する
 *
 * 「このシステムはこういう特徴があるので、こういうGameDayを実施すべき」
 * という自然言語のアドバイスコメントを返す。
 */
export async function generateAdvice(
  config: InfraConfig,
  scenarios: FailureScenario[],
  modelKey?: string,
): Promise<string> {
  const configSummary = buildConfigSummary(config);
  const scenarioSummary = scenarios.map((s) => ({
    name: s.name,
    category: s.category,
    severity: s.severity,
    description: s.description,
  }));

  const result = await invokeLLM({
    systemPrompt: ADVICE_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `## 構成情報\n${JSON.stringify(configSummary, null, 2)}\n\n## 生成されたシナリオ（${scenarios.length}件）\n${JSON.stringify(scenarioSummary, null, 2)}\n\nこのシステム構成に対するGameDay実施のアドバイスをお願いします。`,
          },
        ],
      },
    ],
    maxTokens: 3072,
    temperature: 0.5,
    model: modelKey,
  });

  if (!result.ok) {
    console.log(`    ⚠️  アドバイス生成失敗: ${result.error}`);
    return '';
  }

  console.log(`    📊 アドバイス生成トークン: 入力=${result.usage.inputTokens}, 出力=${result.usage.outputTokens}`);
  return result.text.trim();
}

// ============================================================
// シナリオ rationale 生成（なぜこのシナリオが必要か）
// ============================================================

const RATIONALE_PROMPT = `あなたはAWS障害対応訓練（GameDay）の専門家です。
与えられたシステム構成情報と各シナリオに対して、
「なぜそのシナリオが必要か」という根拠を、各シナリオ1件あたり2〜4文で説明してください。

各 rationale で含めるべき要素:
- このアーキテクチャ特有の理由（汎用的な説明はNG）
- 検証することで得られる価値（何がわかるか、何を改善できるか）
- 想定される実環境でのインシデント例（あれば）

出力は厳密にJSON形式で、scenarioId をキーにした配列で返してください:
[
  { "scenarioId": "<id>", "rationale": "<2〜4文の理由>" },
  ...
]
JSONのみ出力すること。`;

interface RawRationale {
  scenarioId: string;
  rationale: string;
}

/**
 * 各シナリオに対し、なぜそれが必要かをLLMに書かせる。
 * バッチ処理（10件ずつ）。失敗時は元のscenariosをそのまま返す。
 */
export async function generateRationales(
  scenarios: FailureScenario[],
  config: InfraConfig,
  modelKey?: string,
): Promise<FailureScenario[]> {
  if (scenarios.length === 0) return scenarios;

  const configSummary = buildConfigSummary(config);
  const batchSize = 10;
  const rationaleMap = new Map<string, string>();

  for (let i = 0; i < scenarios.length; i += batchSize) {
    const batch = scenarios.slice(i, i + batchSize);
    const summary = batch.map(s => ({
      id: s.id,
      name: s.name,
      category: s.category,
      severity: s.severity,
      description: s.description,
      affectedResources: s.affectedResources,
      impactScope: s.impactScope,
    }));

    const result = await invokeLLM({
      systemPrompt: RATIONALE_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `## 構成情報\n${JSON.stringify(configSummary, null, 2)}\n\n## 対象シナリオ（${batch.length}件）\n${JSON.stringify(summary, null, 2)}\n\n各シナリオの rationale を出力してください。`,
            },
          ],
        },
      ],
      maxTokens: 4096,
      temperature: 0.4,
      model: modelKey,
    });

    if (!result.ok) {
      console.log(`    ⚠️  Rationale生成失敗 (batch ${i / batchSize + 1}): ${result.error}`);
      continue;
    }

    try {
      const raw = JSON.parse(extractJSON(result.text)) as RawRationale[];
      for (const r of raw) {
        if (r.scenarioId && r.rationale) rationaleMap.set(r.scenarioId, r.rationale.trim());
      }
    } catch (err) {
      console.log(`    ⚠️  Rationale パース失敗: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`    ✅ Rationale生成: ${rationaleMap.size}/${scenarios.length}件`);
  return scenarios.map(s => ({
    ...s,
    rationale: rationaleMap.get(s.id) ?? s.rationale,
  }));
}


