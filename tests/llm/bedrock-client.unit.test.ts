import { describe, it, expect } from 'vitest';
import {
  resolveModelId,
  supportsTemperature,
  SUPPORTED_MODELS,
} from '../../src/llm/bedrock-client.js';

// ============================================================
// モデルID解決
// 実機検証済み (us-west-2, 2026-06):
//   4.6 → us.anthropic.claude-opus-4-6-v1  (-v1 必要)
//   4.7 → us.anthropic.claude-opus-4-7     (-v1 なし)
//   4.8 → us.anthropic.claude-opus-4-8     (-v1 なし)
// ============================================================

describe('resolveModelId', () => {
  it('4.6 は -v1 付きの inference profile ID を返す', () => {
    expect(resolveModelId('claude-opus-4-6')).toBe('us.anthropic.claude-opus-4-6-v1');
  });

  it('4.7 は -v1 なしの ID を返す', () => {
    expect(resolveModelId('claude-opus-4-7')).toBe('us.anthropic.claude-opus-4-7');
  });

  it('4.8 は -v1 なしの ID を返す', () => {
    expect(resolveModelId('claude-opus-4-8')).toBe('us.anthropic.claude-opus-4-8');
  });

  it('未知キー / 未指定はデフォルト(4.6)にフォールバック', () => {
    expect(resolveModelId('unknown')).toBe('us.anthropic.claude-opus-4-6-v1');
    expect(resolveModelId(undefined)).toBe('us.anthropic.claude-opus-4-6-v1');
    expect(resolveModelId(null)).toBe('us.anthropic.claude-opus-4-6-v1');
  });

  it('SUPPORTED_MODELS の各IDは正しいプレフィックスを持つ', () => {
    for (const m of Object.values(SUPPORTED_MODELS)) {
      expect(m.id).toMatch(/^us\.anthropic\.claude-opus-4-[678]/);
    }
  });
});

// ============================================================
// temperature サポート判定
// 4.7 以降は temperature 廃止（送ると ValidationException）
// ============================================================

describe('supportsTemperature', () => {
  it('4.6 系は temperature をサポートする', () => {
    expect(supportsTemperature('us.anthropic.claude-opus-4-6-v1')).toBe(true);
  });

  it('4.7 / 4.8 は temperature 非対応', () => {
    expect(supportsTemperature('us.anthropic.claude-opus-4-7')).toBe(false);
    expect(supportsTemperature('us.anthropic.claude-opus-4-8')).toBe(false);
  });

  it('resolveModelId と組み合わせても整合する', () => {
    expect(supportsTemperature(resolveModelId('claude-opus-4-6'))).toBe(true);
    expect(supportsTemperature(resolveModelId('claude-opus-4-7'))).toBe(false);
    expect(supportsTemperature(resolveModelId('claude-opus-4-8'))).toBe(false);
  });
});
