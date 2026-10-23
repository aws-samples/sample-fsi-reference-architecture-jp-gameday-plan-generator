/**
 * Amazon Bedrock Converse API クライアント
 *
 * Claude（Anthropic）/ GPT（OpenAI）の複数モデルを切り替えられる共通LLMクライアント。
 * 画像解析・テキスト分析の両方に対応。
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type Message,
  type SystemContentBlock,
  type InferenceConfiguration,
  type ConverseCommandOutput,
} from '@aws-sdk/client-bedrock-runtime';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { getAwsRegion } from '../config/aws-region.js';

// ── 設定 ──

// 注意: モデルIDの命名規則はモデル・世代ごとに異なる（-v1 の有無、日付suffix等）。
// 以下は us-west-2 で実機確認済みの cross-region inference profile ID（2026-09）。
// 新モデルを追加する際は推測で揃えず、必ず `aws bedrock-runtime converse` で実機確認すること。
/** デフォルトのモデルID（環境変数で上書き可） */
const DEFAULT_MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-opus-4-6-v1';

// ── タイムアウト・リトライ設定 ──
// 生成系の呼び出しは数分かかるため、SDKデフォルト値に依存せず明示する。
/** 接続確立タイムアウト (ms) */
const CONNECTION_TIMEOUT_MS = 10_000;
/** レスポンス完了までのタイムアウト (ms)。長文生成があるため15分 */
const REQUEST_TIMEOUT_MS = 15 * 60 * 1000;
/** リトライ回数（初回 + 1リトライ）。長時間処理のため無闇に再試行しない */
const MAX_ATTEMPTS = 2;

/**
 * UIから選択可能なモデル一覧
 *
 * サンプル構成図2枚での実測（us-west-2, 2026-09）に基づく選定。
 * リソース認識精度は全モデル同等だったため、速度と記述の緻密さで使い分ける。
 */
export const SUPPORTED_MODELS = {
  // 既定。ハンズオン手順書との互換性維持のため据え置き（既定の変更はいつでも可能）。
  // 注意: ID は -v1 suffix が必要（4.6 のみの命名規則）。
  'claude-opus-4-6': {
    id: 'us.anthropic.claude-opus-4-6-v1',
    label: 'Claude Opus 4.6',
    description: '既定・従来モデル（構成図解析 30〜90秒）',
    maxOutputTokens: 128_000,
  },
  'gpt-5.6-terra': {
    id: 'us.openai.gpt-5.6-terra',
    label: 'GPT-5.6 terra',
    description: 'バランス型・高速（構成図解析 40〜50秒）',
    maxOutputTokens: 131_072,
  },
  'gpt-5.6-luna': {
    id: 'us.openai.gpt-5.6-luna',
    label: 'GPT-5.6 luna',
    description: '高速・軽量（構成図解析 30〜40秒）',
    maxOutputTokens: 131_072,
  },
  'gpt-5.6-sol': {
    id: 'us.openai.gpt-5.6-sol',
    label: 'GPT-5.6 sol',
    description: '高性能（構成図解析 60〜80秒）',
    maxOutputTokens: 131_072,
  },
  'claude-sonnet-5-5': {
    id: 'us.anthropic.claude-sonnet-5-5',
    label: 'Claude Sonnet 5.5',
    description: 'バランス型（構成図解析 50〜100秒）',
    maxOutputTokens: 128_000,
  },
  'claude-opus-5-5': {
    id: 'us.anthropic.claude-opus-5-5',
    label: 'Claude Opus 5.5',
    description: '最高品質・低速（構成図解析 100秒以上）・記述が詳細',
    maxOutputTokens: 128_000,
  },
} as const;

export type SupportedModelKey = keyof typeof SUPPORTED_MODELS;

/** UI/CLI 既定のモデルキー */
export const DEFAULT_MODEL_KEY: SupportedModelKey = 'claude-opus-4-6';

/** モデルキー（"gpt-5.6-terra"等）からBedrock model ID に解決 */
export function resolveModelId(key?: string | null): string {
  if (!key) return DEFAULT_MODEL_ID;
  const model = SUPPORTED_MODELS[key as SupportedModelKey];
  return model?.id ?? DEFAULT_MODEL_ID;
}

/** 文字列が生の Bedrock model ID（inference profile ID 含む）かどうか */
export function isRawModelId(value: string): boolean {
  return /^(us|global|eu|apac|jp)\.|^(anthropic|openai)\./.test(value);
}

/**
 * モデルが Converse の `temperature` パラメータをサポートするか判定する。
 *
 * Claude Opus 4.6 系のみ対応。それ以降の Claude（4.7+, 5.x）と GPT-5.6 系は
 * `temperature` 非対応で、送ると ValidationException になる（実機検証済み: us-west-2, 2026-09）。
 * 将来モデルは原則 temperature 非対応とみなす安全側デフォルト。
 */
export function supportsTemperature(modelId: string): boolean {
  return /claude-opus-4-6/.test(modelId);
}

/** モデルの最大出力トークン数（不明なモデルは安全側に 8192） */
export function maxOutputTokensOf(modelId: string): number {
  for (const m of Object.values(SUPPORTED_MODELS)) {
    if (m.id === modelId) return m.maxOutputTokens;
  }
  return 8192;
}

// ── 型定義 ──

export interface LLMRequest {
  systemPrompt: string;
  messages: LLMMessage[];
  maxTokens?: number;
  temperature?: number;
  /** モデルキー（"gpt-5.6-terra"等）またはBedrock model ID。未指定時はデフォルト */
  model?: string;
}

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: LLMContentBlock[];
}

export type LLMContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; format: ImageFormat; data: Buffer };

export type ImageFormat = 'png' | 'jpeg' | 'gif' | 'webp';

export type LLMResult =
  | { ok: true; text: string; usage: { inputTokens: number; outputTokens: number } }
  | { ok: false; error: string };

// ── クライアント ──

let clientInstance: BedrockRuntimeClient | null = null;

function getClient(): BedrockRuntimeClient {
  if (!clientInstance) {
    clientInstance = new BedrockRuntimeClient({
      region: getAwsRegion(),
      maxAttempts: MAX_ATTEMPTS,
      requestHandler: new NodeHttpHandler({
        connectionTimeout: CONNECTION_TIMEOUT_MS,
        requestTimeout: REQUEST_TIMEOUT_MS,
      }),
    });
  }
  return clientInstance;
}

/**
 * Bedrock Converse API を呼び出す
 */
export async function invokeLLM(request: LLMRequest): Promise<LLMResult> {
  const client = getClient();

  // system prompt 組み立て
  const system: SystemContentBlock[] = [
    { text: request.systemPrompt },
  ];

  // messages 組み立て
  const messages: Message[] = request.messages.map((msg) => ({
    role: msg.role,
    content: msg.content.map(toContentBlock),
  }));

  try {
    // モデルID解決: キー指定なら resolveModelId、生のIDが入っていればそのまま
    const modelId = request.model
      ? (isRawModelId(request.model) ? request.model : resolveModelId(request.model))
      : DEFAULT_MODEL_ID;

    // inference config を組み立てる。
    // - maxTokens はモデルの上限を超えないようにクランプする（超えると ValidationException）
    // - 現行モデルは `temperature` 非対応（送ると ValidationException）のため付与しない
    const inferenceConfig: InferenceConfiguration = {
      maxTokens: Math.min(request.maxTokens ?? 8192, maxOutputTokensOf(modelId)),
    };
    if (supportsTemperature(modelId)) {
      inferenceConfig.temperature = request.temperature ?? 0.3;
    }

    const command = new ConverseCommand({
      modelId,
      system,
      messages,
      inferenceConfig,
    });

    const response: ConverseCommandOutput = await client.send(command);

    // 出力トークン上限で打ち切られた場合は、途中で切れた本文を返さず明示エラーにする。
    // （切れたJSONを下流でパースすると「有効なJSONではありません」という誤った原因が
    //   表示されてしまうため、ここで原因を特定して伝える）
    if (response.stopReason === 'max_tokens') {
      return {
        ok: false,
        error:
          `モデルの出力が最大トークン数（${inferenceConfig.maxTokens}）に達し、途中で打ち切られました。` +
          '入力を簡素化するか、別のモデルを選択してください。',
      };
    }

    // レスポンスからテキストを抽出
    const outputMessage = response.output?.message;
    if (!outputMessage?.content) {
      return { ok: false, error: 'Bedrockからの応答にコンテンツが含まれていません' };
    }

    const textBlocks = outputMessage.content
      .filter((block): block is ContentBlock.TextMember => 'text' in block)
      .map((block) => block.text);

    if (textBlocks.length === 0) {
      return { ok: false, error: 'Bedrockからの応答にテキストが含まれていません' };
    }

    return {
      ok: true,
      text: textBlocks.join('\n'),
      usage: {
        inputTokens: response.usage?.inputTokens ?? 0,
        outputTokens: response.usage?.outputTokens ?? 0,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Bedrock API エラー: ${msg}` };
  }
}

/**
 * LLMContentBlock → Bedrock ContentBlock 変換
 */
function toContentBlock(block: LLMContentBlock): ContentBlock {
  if (block.type === 'text') {
    return { text: block.text };
  }
  // image
  return {
    image: {
      format: block.format,
      source: {
        bytes: new Uint8Array(block.data),
      },
    },
  };
}

/**
 * LLMレスポンスからJSONを抽出するヘルパー
 * マークダウンコードブロックで囲まれている場合も対応
 */
export function extractJSON(text: string): string {
  let cleaned = text.trim();
  // ```json ... ``` を除去
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```$/, '');
  }
  return cleaned.trim();
}
