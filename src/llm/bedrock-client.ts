/**
 * Amazon Bedrock Converse API クライアント
 *
 * Claude Opus 4.6 (1M context) を使用した共通LLMクライアント。
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

// ── 設定 ──

// 注意: モデルIDのバージョンsuffix（-v1）はバージョンごとに付与規則が異なる。
// us-west-2 で動作確認した正しい inference profile ID:
//   4.6 → us.anthropic.claude-opus-4-6-v1   (-v1 が必要)
//   4.7 → us.anthropic.claude-opus-4-7       (-v1 なし)
//   4.8 → us.anthropic.claude-opus-4-8       (-v1 なし)
// 推測で揃えず、必ず `aws bedrock-runtime converse` で実機確認すること。
/** デフォルトのモデルID（環境変数で上書き可） */
const DEFAULT_MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-opus-4-6-v1';
const REGION = process.env.AWS_REGION ?? 'us-east-1';

/** UIから選択可能なモデル一覧 */
export const SUPPORTED_MODELS = {
  'claude-opus-4-6': {
    id: 'us.anthropic.claude-opus-4-6-v1',
    label: 'Claude Opus 4.6',
    description: 'バランス型・長文コンテキスト 1M tokens',
  },
  'claude-opus-4-7': {
    id: 'us.anthropic.claude-opus-4-7',
    label: 'Claude Opus 4.7',
    description: '推論性能向上',
  },
  'claude-opus-4-8': {
    id: 'us.anthropic.claude-opus-4-8',
    label: 'Claude Opus 4.8',
    description: '最新・1M context・推論強化',
  },
} as const;

export type SupportedModelKey = keyof typeof SUPPORTED_MODELS;

/** モデルキー（"claude-opus-4-6"等）からBedrock model ID に解決 */
export function resolveModelId(key?: string | null): string {
  if (!key) return DEFAULT_MODEL_ID;
  const model = SUPPORTED_MODELS[key as SupportedModelKey];
  return model?.id ?? DEFAULT_MODEL_ID;
}

/**
 * モデルが Converse の `temperature` パラメータをサポートするか判定する。
 *
 * Claude Opus 4.7 以降は `temperature` が廃止され、送ると
 * ValidationException ("temperature is deprecated for this model") になる。
 * 4.6 系（-v1）のみ temperature を受け付ける。
 *
 * 判定は実機検証済み（us-west-2, 2026-06）:
 *   us.anthropic.claude-opus-4-6-v1 → temperature OK
 *   us.anthropic.claude-opus-4-7    → temperature 不可
 *   us.anthropic.claude-opus-4-8    → temperature 不可
 */
export function supportsTemperature(modelId: string): boolean {
  // 4.6 系のみ許可（将来モデルは原則 temperature 非対応とみなす安全側デフォルト）
  return /claude-opus-4-6/.test(modelId);
}

// ── 型定義 ──

export interface LLMRequest {
  systemPrompt: string;
  messages: LLMMessage[];
  maxTokens?: number;
  temperature?: number;
  /** モデルキー（"claude-opus-4-6"等）またはBedrock model ID。未指定時はデフォルト */
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
    clientInstance = new BedrockRuntimeClient({ region: REGION });
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
      ? (request.model.startsWith('us.') || request.model.startsWith('anthropic.')
          ? request.model
          : resolveModelId(request.model))
      : DEFAULT_MODEL_ID;

    // inference config を組み立てる。
    // 注意: Claude Opus 4.7 以降は `temperature` パラメータが廃止されており、
    // 送ると ValidationException ("temperature is deprecated for this model") になる。
    // temperature 非対応モデルには付与しない。
    const inferenceConfig: InferenceConfiguration = {
      maxTokens: request.maxTokens ?? 8192,
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
