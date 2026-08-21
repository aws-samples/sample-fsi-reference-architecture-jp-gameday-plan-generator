import type {
  InfraConfig,
  InputFormat,
  ParseError,
  Result,
} from '../types/index.js';
import { parseCfnJson, parseCfnYaml } from './cfn-parser.js';

// ============================================================
// パーサーファサード
// ============================================================

/**
 * 入力文字列からフォーマットを自動判定する
 */
export function detectFormat(input: string): InputFormat {
  const trimmed = input.trim();

  // 空文字列の場合はデフォルトでcfn-jsonとして扱う（パース時にエラーになる）
  if (trimmed.length === 0) {
    return 'cfn-json';
  }

  // JSON判定: { で始まる
  if (trimmed.startsWith('{')) {
    return 'cfn-json';
  }

  // JSON判定: [ で始まる（配列はCFnとしては不正だが、JSONとして解析を試みる）
  if (trimmed.startsWith('[')) {
    return 'cfn-json';
  }

  // CDK TypeScript判定: import文やcdk関連キーワード
  if (
    /^\s*(import\s+|const\s+|export\s+|\/\/|\/\*)/m.test(trimmed) &&
    /cdk|constructs|aws-/i.test(trimmed)
  ) {
    return 'cdk-typescript';
  }

  // CDK Python判定: from/import文やcdk関連キーワード
  if (
    /^\s*(from\s+|import\s+|#|def\s+|class\s+)/m.test(trimmed) &&
    /aws_cdk|constructs/i.test(trimmed)
  ) {
    return 'cdk-python';
  }

  // YAML判定: YAMLドキュメント開始マーカーまたはキーバリュー形式
  if (
    trimmed.startsWith('---') ||
    trimmed.startsWith('AWSTemplateFormatVersion') ||
    trimmed.startsWith('Resources:') ||
    trimmed.startsWith('Description:') ||
    /^[A-Za-z_][A-Za-z0-9_]*\s*:/m.test(trimmed)
  ) {
    return 'cfn-yaml';
  }

  // デフォルト: JSONとして試行（パース時にエラーになる）
  return 'cfn-json';
}

/**
 * フォーマットに応じたパーサーへディスパッチし、構成情報を解析する
 */
export function parse(
  input: string,
  format?: InputFormat,
  sourceFile?: string,
): Result<InfraConfig, ParseError> {
  const detectedFormat = format ?? detectFormat(input);

  switch (detectedFormat) {
    case 'cfn-json':
      return parseCfnJson(input, sourceFile ?? 'template.json');

    case 'cfn-yaml':
      return parseCfnYaml(input, sourceFile ?? 'template.yaml');

    case 'cdk-typescript':
      return {
        ok: false,
        error: {
          line: 1,
          column: 1,
          message:
            'CDK TypeScriptの直接解析は未対応です。CDK Synthを実行してCloudFormationテンプレートに変換してから入力してください。',
          source: input.slice(0, 100),
        },
      };

    case 'cdk-python':
      return {
        ok: false,
        error: {
          line: 1,
          column: 1,
          message:
            'CDK Pythonの直接解析は未対応です。CDK Synthを実行してCloudFormationテンプレートに変換してから入力してください。',
          source: input.slice(0, 100),
        },
      };

    default: {
      const _exhaustive: never = detectedFormat;
      return {
        ok: false,
        error: {
          line: 1,
          column: 1,
          message: `未対応のフォーマットです: ${_exhaustive}`,
          source: input.slice(0, 100),
        },
      };
    }
  }
}
