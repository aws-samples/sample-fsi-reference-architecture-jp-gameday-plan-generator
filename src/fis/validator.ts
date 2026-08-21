/**
 * FISスキーマバリデーション
 *
 * Zodスキーマを使用してFIS実験テンプレートの構造を検証し、
 * AWS FIS APIスキーマとの整合性を確認する。
 */

import type { FISExperimentTemplate } from '../types/index.js';
import { FISExperimentTemplateSchema } from '../types/index.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * FIS実験テンプレートをZodスキーマでバリデーションする
 *
 * @param template - 検証対象のFIS実験テンプレート
 * @returns バリデーション結果（valid: true/false, errors: エラーメッセージ配列）
 */
export function validateFISTemplate(template: FISExperimentTemplate): ValidationResult {
  const result = FISExperimentTemplateSchema.safeParse(template);

  if (result.success) {
    // 追加のセマンティックバリデーション
    const semanticErrors = validateSemantics(template);
    if (semanticErrors.length > 0) {
      return { valid: false, errors: semanticErrors };
    }
    return { valid: true, errors: [] };
  }

  // Zodバリデーションエラーを読みやすい形式に変換
  const errors = result.error.issues.map((issue) => {
    const path = issue.path.join('.');
    return `${path}: ${issue.message}`;
  });

  return { valid: false, errors };
}

/**
 * セマンティックバリデーション
 * Zodスキーマでは検証できないビジネスルールを検証する
 */
function validateSemantics(template: FISExperimentTemplate): string[] {
  const errors: string[] = [];

  // ターゲットが少なくとも1つ存在すること
  if (Object.keys(template.targets).length === 0) {
    errors.push('targets: 少なくとも1つのターゲットが必要です');
  }

  // アクションが少なくとも1つ存在すること
  if (Object.keys(template.actions).length === 0) {
    errors.push('actions: 少なくとも1つのアクションが必要です');
  }

  // 停止条件が少なくとも1つ存在すること
  if (template.stopConditions.length === 0) {
    errors.push('stopConditions: 少なくとも1つの停止条件が必要です');
  }

  // アクションが参照するターゲットが存在すること
  const targetKeys = new Set(Object.keys(template.targets));
  for (const [actionKey, action] of Object.entries(template.actions)) {
    if (action.targets) {
      for (const [, targetRef] of Object.entries(action.targets)) {
        if (!targetKeys.has(targetRef)) {
          errors.push(
            `actions.${actionKey}.targets: 参照先ターゲット "${targetRef}" が存在しません`,
          );
        }
      }
    }
  }

  // アクションのstartAfterが参照するアクションが存在すること
  const actionKeys = new Set(Object.keys(template.actions));
  for (const [actionKey, action] of Object.entries(template.actions)) {
    if (action.startAfter) {
      for (const ref of action.startAfter) {
        if (!actionKeys.has(ref)) {
          errors.push(
            `actions.${actionKey}.startAfter: 参照先アクション "${ref}" が存在しません`,
          );
        }
      }
    }
  }

  // roleArnの形式チェック（プレースホルダーも許容）
  if (!template.roleArn.startsWith('arn:aws:iam:')) {
    errors.push('roleArn: 有効なIAMロールARN形式である必要があります（arn:aws:iam:で始まること）');
  }

  return errors;
}
