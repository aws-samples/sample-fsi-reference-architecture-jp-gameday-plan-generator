/**
 * チャットベースの計画編集モジュール
 *
 * ユーザーの自然言語指示を解釈し、
 * 構造化されたアクション（シナリオ除外、期間変更など）に変換する。
 */

import { invokeLLM, extractJSON } from './bedrock-client.js';
import type { FailureScenario, GameDayPlan, PlanOptions } from '../types/index.js';
import type { ChatMessage } from '../web/session.js';

// ── アクション型定義 ──

export type ChatAction =
  | { type: 'change-duration'; duration: 'half-day' | 'full-day' | 'two-day' }
  | { type: 'change-participants'; count: number }
  | { type: 'exclude-scenarios'; scenarioIds: string[] }
  | { type: 'include-scenarios'; scenarioIds: string[] }
  | { type: 'reorder-scenarios'; scenarioIds: string[] }
  | { type: 'none' };

export interface ChatResponse {
  message: string;
  actions: ChatAction[];
}

// ── システムプロンプト ──

const CHAT_SYSTEM_PROMPT = `あなたはAWS障害対応訓練（GameDay）の計画編集アシスタントです。
ユーザーの指示を解釈し、計画に対する変更アクションを提案してください。

## 出力形式
必ず以下のJSON形式のみで返答してください（マークダウンのコードブロックなし）:

{
  "message": "ユーザーへの応答メッセージ（日本語、50〜200文字）",
  "actions": [
    { "type": "アクション種別", ...パラメータ }
  ]
}

## サポートするアクション

1. 実施時間の変更
   { "type": "change-duration", "duration": "half-day" | "full-day" | "two-day" }

2. 参加者数の変更
   { "type": "change-participants", "count": 1〜100の整数 }

3. シナリオの除外（タイムラインから外す）
   { "type": "exclude-scenarios", "scenarioIds": ["id1", "id2"] }

4. 除外済みシナリオを戻す
   { "type": "include-scenarios", "scenarioIds": ["id1"] }

5. シナリオの実行順序を変更
   { "type": "reorder-scenarios", "scenarioIds": ["id1", "id3", "id2"] }

6. 変更なし（質問への回答など）
   { "type": "none" }

## ルール

- ユーザーが「半日にして」と言ったら change-duration: half-day
- 「参加者を8人に」→ change-participants: 8
- 「ネットワーク系のシナリオを外して」→ 該当するシナリオIDをexclude-scenariosに
- 「Critical優先順にして」→ reorder-scenariosで重大度順に並べる
- 質問（「どんなシナリオがある？」など）は "none" アクションで、messageに回答を書く
- 複数の指示が含まれる場合は複数のアクションを返す
- 不明確な指示は推測せず、確認を求めるmessageを返す
- シナリオIDは必ず現状のシナリオ一覧に存在するものを使用
- 日本語で自然な口調、でもプロフェッショナルに`;

// ── 公開API ──

export async function processChatMessage(params: {
  userMessage: string;
  scenarios: FailureScenario[];
  plan: GameDayPlan;
  planOptions: PlanOptions;
  chatHistory: ChatMessage[];
}): Promise<ChatResponse> {
  const { userMessage, scenarios, plan, planOptions, chatHistory } = params;

  // 現状のサマリー
  const currentState = {
    duration: planOptions.duration,
    participantCount: planOptions.participantCount,
    totalScenarios: scenarios.length,
    scheduledScenarios: plan.scenarios.length,
    scenarios: scenarios.map(s => ({
      id: s.id,
      name: s.name,
      category: s.category,
      severity: s.severity,
      estimatedDuration: s.estimatedDuration,
      included: plan.scenarios.some(p => p.scenarioId === s.id),
    })),
  };

  // 過去のやりとり（直近5件）
  const recentHistory = chatHistory.slice(-10).map(m => ({
    role: m.role,
    content: m.content,
  }));

  const result = await invokeLLM({
    systemPrompt: CHAT_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `## 現在の計画状態\n${JSON.stringify(currentState, null, 2)}\n\n## 最近の会話履歴\n${JSON.stringify(recentHistory, null, 2)}\n\n## ユーザーの指示\n${userMessage}`,
          },
        ],
      },
    ],
    maxTokens: 2048,
    temperature: 0.3,
  });

  if (!result.ok) {
    return {
      message: `申し訳ありません、リクエストの処理中にエラーが発生しました: ${result.error}`,
      actions: [{ type: 'none' }],
    };
  }

  try {
    const json = extractJSON(result.text);
    const parsed = JSON.parse(json) as ChatResponse;
    if (!parsed.message || !Array.isArray(parsed.actions)) {
      throw new Error('invalid response shape');
    }
    return parsed;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`    ⚠️  チャット応答のパース失敗: ${msg}`);
    return {
      message: result.text,
      actions: [{ type: 'none' }],
    };
  }
}
