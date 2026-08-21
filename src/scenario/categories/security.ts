import type { InfraConfig, FailureScenario } from '../../types/index.js';

let counter = 0;
function nextId(): string {
  return `scenario-security-${++counter}`;
}

/** Reset counter (for testing) */
export function resetSecurityCounter(): void {
  counter = 0;
}

/**
 * セキュリティインシデントカテゴリのシナリオ生成
 * - ランサムウェア感染シミュレーション（S3バケット対象）
 */
export function generateSecurityScenarios(config: InfraConfig): FailureScenario[] {
  const scenarios: FailureScenario[] = [];

  const s3Resources = config.resources.filter((r) => r.type === 'AWS::S3::Bucket');

  // ランサムウェア感染シミュレーション
  for (const s3 of s3Resources) {
    scenarios.push({
      id: nextId(),
      name: `ランサムウェア感染シミュレーション: ${s3.logicalId}`,
      category: 'security',
      severity: 'Critical',
      description: `S3バケット ${s3.logicalId} に対するランサムウェア攻撃をシミュレートし、データ保護とインシデント対応手順を検証する`,
      affectedResources: [s3.logicalId],
      impactScope: `${s3.logicalId} 内の全オブジェクトおよび依存サービス`,
      prerequisites: [
        'S3バケットのバージョニングが有効であること（推奨）',
        'バックアップ/リストア手順が文書化されていること',
        'インシデント対応チームが待機していること',
      ],
      steps: [
        { order: 1, action: 'S3バケットの現在の状態とバージョニング設定を確認', target: s3.logicalId },
        { order: 2, action: 'テスト用オブジェクトの暗号化（ランサムウェア模擬）を実行', target: s3.logicalId, parameters: { action: 'simulate-encryption', scope: 'test-prefix-only' } },
        { order: 3, action: 'インシデント検知アラームの発火を確認', target: s3.logicalId },
        { order: 4, action: 'インシデント対応手順に従い復旧を実施', target: s3.logicalId },
      ],
      expectedOutcome: 'バージョニングまたはバックアップからデータを復元でき、インシデント対応手順が機能すること',
      rollbackSteps: [
        'テスト用オブジェクトを削除',
        'S3バケットのバージョニングから正常なバージョンを復元',
        'セキュリティアラートをクリア',
      ],
      estimatedDuration: 60,
      tags: ['ransomware', 'security', 's3'],
    });
  }

  return scenarios;
}
