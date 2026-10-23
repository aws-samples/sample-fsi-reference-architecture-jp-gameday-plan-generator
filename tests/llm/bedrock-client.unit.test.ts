import { describe, it, expect } from 'vitest';
import {
  resolveModelId,
  supportsTemperature,
  isRawModelId,
  maxOutputTokensOf,
  SUPPORTED_MODELS,
  DEFAULT_MODEL_KEY,
} from '../../src/llm/bedrock-client.js';

// ============================================================
// モデルID解決
// 実機検証済み (us-west-2, 2026-09):
//   Claude Opus 4.6   → us.anthropic.claude-opus-4-6-v1 (-v1 必要。4.6 のみの命名規則)
//   Claude Opus 5.5   → us.anthropic.claude-opus-5-5
//   Claude Sonnet 5.5 → us.anthropic.claude-sonnet-5-5
//   GPT-5.6 sol/terra/luna → us.openai.gpt-5.6-{sol,terra,luna}
// ============================================================

describe('resolveModelId', () => {
  it('各キーが実機確認済みの inference profile ID に解決される', () => {
    expect(resolveModelId('claude-opus-4-6')).toBe('us.anthropic.claude-opus-4-6-v1');
    expect(resolveModelId('gpt-5.6-terra')).toBe('us.openai.gpt-5.6-terra');
    expect(resolveModelId('gpt-5.6-luna')).toBe('us.openai.gpt-5.6-luna');
    expect(resolveModelId('gpt-5.6-sol')).toBe('us.openai.gpt-5.6-sol');
    expect(resolveModelId('claude-sonnet-5-5')).toBe('us.anthropic.claude-sonnet-5-5');
    expect(resolveModelId('claude-opus-5-5')).toBe('us.anthropic.claude-opus-5-5');
  });

  it('既定キーは Claude Opus 4.6（ハンズオン手順書との互換性維持）', () => {
    expect(DEFAULT_MODEL_KEY).toBe('claude-opus-4-6');
    expect(SUPPORTED_MODELS[DEFAULT_MODEL_KEY].id).toBe('us.anthropic.claude-opus-4-6-v1');
  });

  it('未知キー / 未指定は既定モデルにフォールバック', () => {
    const def = SUPPORTED_MODELS[DEFAULT_MODEL_KEY].id;
    expect(resolveModelId('unknown')).toBe(def);
    expect(resolveModelId('claude-opus-4-7')).toBe(def); // 4.7 / 4.8 は v1.1.0 で廃止
    expect(resolveModelId(undefined)).toBe(def);
    expect(resolveModelId(null)).toBe(def);
  });

  it('SUPPORTED_MODELS の各IDは us. cross-region inference profile', () => {
    for (const m of Object.values(SUPPORTED_MODELS)) {
      expect(m.id).toMatch(/^us\.(anthropic\.claude-opus-4-6-v1|anthropic\.claude-(opus|sonnet)-5-5|openai\.gpt-5\.6-(sol|terra|luna))$/);
    }
  });
});

// ============================================================
// 生のモデルID判定
// ============================================================

describe('isRawModelId', () => {
  it('inference profile / foundation model の ID を生IDとして判定する', () => {
    expect(isRawModelId('us.openai.gpt-5.6-terra')).toBe(true);
    expect(isRawModelId('global.anthropic.claude-sonnet-5-5')).toBe(true);
    expect(isRawModelId('anthropic.claude-opus-5-5')).toBe(true);
    expect(isRawModelId('openai.gpt-5.6-sol')).toBe(true);
  });

  it('UI 用のモデルキーは生IDではない', () => {
    expect(isRawModelId('gpt-5.6-terra')).toBe(false);
    expect(isRawModelId('claude-opus-5-5')).toBe(false);
  });
});

// ============================================================
// temperature サポート判定
// Claude Opus 4.6 のみ対応。Claude 5.5 系 / GPT-5.6 系は非対応（送ると ValidationException）
// ============================================================

describe('supportsTemperature', () => {
  it('Claude Opus 4.6 のみ temperature 対応', () => {
    expect(supportsTemperature('us.anthropic.claude-opus-4-6-v1')).toBe(true);
  });

  it('4.6 以外の全対応モデルで temperature 非対応', () => {
    for (const [key, m] of Object.entries(SUPPORTED_MODELS)) {
      if (key === 'claude-opus-4-6') continue;
      expect(supportsTemperature(m.id)).toBe(false);
    }
  });
});

// ============================================================
// 最大出力トークン数
// 実機検証済み (us-west-2, 2026-09): Claude 4.6 / 5.5 系 = 128,000 / GPT-5.6 系 ≥ 131,072
// ============================================================

describe('maxOutputTokensOf', () => {
  it('Claude 4.6 / 5.5 系は 128,000', () => {
    expect(maxOutputTokensOf('us.anthropic.claude-opus-4-6-v1')).toBe(128_000);
    expect(maxOutputTokensOf('us.anthropic.claude-opus-5-5')).toBe(128_000);
    expect(maxOutputTokensOf('us.anthropic.claude-sonnet-5-5')).toBe(128_000);
  });

  it('GPT-5.6 系は 131,072', () => {
    expect(maxOutputTokensOf('us.openai.gpt-5.6-terra')).toBe(131_072);
  });

  it('未知モデルは安全側の 8192', () => {
    expect(maxOutputTokensOf('us.anthropic.claude-opus-4-8')).toBe(8192);
  });
});
