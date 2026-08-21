import type { InfraConfig, FailureScenario } from '../../types/index.js';

let counter = 0;
function nextId(): string {
  return `scenario-enricher-multiregion-${++counter}`;
}

/** Reset counter (for testing) */
export function resetMultiRegionCounter(): void {
  counter = 0;
}

/**
 * マルチリージョン構成検出時にフェイルオーバーシナリオを追加するエンリッチャー
 */
export const multiRegionEnricher = {
  shouldApply(config: InfraConfig): boolean {
    return config.metadata.isMultiRegion;
  },

  enrich(config: InfraConfig, scenarios: FailureScenario[]): FailureScenario[] {
    if (!this.shouldApply(config)) {
      return scenarios;
    }

    const regions = config.regions;
    const additionalScenarios: FailureScenario[] = [];

    // リージョン間フェイルオーバーシナリオ
    additionalScenarios.push({
      id: nextId(),
      name: 'リージョン間フェイルオーバー検証',
      category: 'infrastructure',
      severity: 'Critical',
      description: `プライマリリージョン（${regions[0]}）の障害時にセカンダリリージョン（${regions[1]}）へのフェイルオーバーを検証する`,
      affectedResources: config.resources.map((r) => r.logicalId),
      impactScope: `${regions[0]} リージョンの全サービス`,
      prerequisites: [
        'マルチリージョン構成がデプロイ済みであること',
        'Route 53ヘルスチェックが設定されていること',
        'データレプリケーションが有効であること',
      ],
      steps: [
        { order: 1, action: '両リージョンのサービス正常性を確認', target: regions[0] },
        { order: 2, action: `プライマリリージョン（${regions[0]}）のサービスを停止`, target: regions[0], parameters: { action: 'simulate-region-failure' } },
        { order: 3, action: `セカンダリリージョン（${regions[1]}）へのフェイルオーバーを観測`, target: regions[1] },
        { order: 4, action: 'フェイルオーバー後のサービス正常性を確認', target: regions[1] },
      ],
      expectedOutcome: 'セカンダリリージョンでサービスが継続し、データの整合性が保たれること',
      rollbackSteps: [
        `プライマリリージョン（${regions[0]}）のサービスを復旧`,
        'トラフィックをプライマリリージョンに戻す',
        '両リージョンのデータ整合性を確認',
      ],
      estimatedDuration: 60,
      tags: ['multi-region', 'failover'],
    });

    // リージョン間データ同期検証シナリオ
    additionalScenarios.push({
      id: nextId(),
      name: 'リージョン間データ同期遅延検証',
      category: 'data',
      severity: 'High',
      description: `リージョン間（${regions[0]} ↔ ${regions[1]}）のデータ同期に遅延が発生した場合の影響を検証する`,
      affectedResources: config.resources
        .filter((r) =>
          ['AWS::RDS::DBInstance', 'AWS::DynamoDB::Table', 'AWS::S3::Bucket'].includes(r.type),
        )
        .map((r) => r.logicalId),
      impactScope: 'リージョン間のデータレプリケーション',
      prerequisites: [
        'クロスリージョンレプリケーションが設定されていること',
        'レプリケーションラグのモニタリングが有効であること',
      ],
      steps: [
        { order: 1, action: '現在のレプリケーションラグを確認', target: regions[0] },
        { order: 2, action: 'ネットワークレイテンシを注入してレプリケーション遅延をシミュレート', target: regions[0], parameters: { delay: '5000ms' } },
        { order: 3, action: 'レプリケーションラグの増加とアプリケーションへの影響を観測', target: regions[1] },
      ],
      expectedOutcome: 'レプリケーション遅延が検知され、結果整合性の範囲内でサービスが継続すること',
      rollbackSteps: [
        'ネットワークレイテンシ注入を停止',
        'レプリケーションラグが正常値に戻ることを確認',
      ],
      estimatedDuration: 40,
      tags: ['multi-region', 'data-sync', 'replication'],
    });

    return [...scenarios, ...additionalScenarios];
  },
};
