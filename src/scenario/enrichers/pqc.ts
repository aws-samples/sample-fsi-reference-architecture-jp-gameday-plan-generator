import type { InfraConfig, FailureScenario } from '../../types/index.js';

let counter = 0;
function nextId(): string {
  return `scenario-enricher-pqc-${++counter}`;
}

/** Reset counter (for testing) */
export function resetPqcCounter(): void {
  counter = 0;
}

/**
 * 暗号化設定検出時にPQC（ポスト量子暗号）移行シナリオを追加するエンリッチャー
 */
export const pqcEnricher = {
  shouldApply(config: InfraConfig): boolean {
    return config.metadata.hasEncryption;
  },

  enrich(config: InfraConfig, scenarios: FailureScenario[]): FailureScenario[] {
    if (!this.shouldApply(config)) {
      return scenarios;
    }

    const encryptedResources = config.resources.filter((r) => r.encryption?.enabled === true);
    const affectedIds =
      encryptedResources.length > 0
        ? encryptedResources.map((r) => r.logicalId)
        : config.resources.slice(0, 1).map((r) => r.logicalId);

    const additionalScenarios: FailureScenario[] = [];

    // PQC移行準備検証シナリオ
    additionalScenarios.push({
      id: nextId(),
      name: 'PQC（ポスト量子暗号）移行準備検証',
      category: 'security',
      severity: 'High',
      description:
        '現在の暗号化設定をポスト量子暗号（PQC）対応アルゴリズムに移行する準備状況を検証する',
      affectedResources: affectedIds,
      impactScope: '暗号化が設定されたすべてのリソース',
      prerequisites: [
        '暗号化設定が有効なリソースが存在すること',
        'KMSキーの管理権限があること',
        'PQC対応の暗号化ライブラリが利用可能であること',
      ],
      steps: [
        {
          order: 1,
          action: '現在の暗号化アルゴリズムとKMSキー設定を棚卸し',
          target: 'kms',
        },
        {
          order: 2,
          action: 'PQC対応アルゴリズム（ML-KEM等）でのテスト暗号化を実行',
          target: 'kms',
          parameters: { algorithm: 'ML-KEM-768' },
        },
        {
          order: 3,
          action: 'PQCアルゴリズムでの暗号化・復号のパフォーマンスを測定',
          target: 'kms',
        },
        {
          order: 4,
          action: '既存データの再暗号化手順を検証',
          target: 'kms',
        },
      ],
      expectedOutcome:
        'PQC対応アルゴリズムでの暗号化・復号が正常に動作し、パフォーマンスへの影響が許容範囲内であること',
      rollbackSteps: [
        'テスト用のPQC暗号化データを削除',
        '既存の暗号化設定に影響がないことを確認',
      ],
      estimatedDuration: 45,
      tags: ['pqc', 'encryption', 'security'],
    });

    // 暗号化キーローテーション検証シナリオ
    additionalScenarios.push({
      id: nextId(),
      name: '暗号化キーローテーション検証',
      category: 'security',
      severity: 'Medium',
      description:
        'KMSキーのローテーションを実行し、暗号化されたデータへのアクセスが継続できることを検証する',
      affectedResources: affectedIds,
      impactScope: 'KMSキーで暗号化されたすべてのデータ',
      prerequisites: [
        'KMSキーが作成済みであること',
        'キーローテーションの権限があること',
      ],
      steps: [
        {
          order: 1,
          action: '現在のKMSキーの状態とローテーション履歴を確認',
          target: 'kms',
        },
        {
          order: 2,
          action: 'KMSキーのローテーションを実行',
          target: 'kms',
          parameters: { action: 'rotate-key' },
        },
        {
          order: 3,
          action: 'ローテーション後に既存データの復号が可能であることを確認',
          target: 'kms',
        },
      ],
      expectedOutcome:
        'キーローテーション後も既存データの復号が可能で、新規データは新しいキーで暗号化されること',
      rollbackSteps: [
        'キーローテーションに問題がある場合、AWSサポートに連絡',
        '暗号化されたデータへのアクセスを確認',
      ],
      estimatedDuration: 30,
      tags: ['pqc', 'encryption', 'key-rotation'],
    });

    return [...scenarios, ...additionalScenarios];
  },
};
