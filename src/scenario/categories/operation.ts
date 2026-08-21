import type { InfraConfig, FailureScenario } from '../../types/index.js';

let counter = 0;
function nextId(): string {
  return `scenario-operation-${++counter}`;
}

/** Reset counter (for testing) */
export function resetOperationCounter(): void {
  counter = 0;
}

/**
 * オペレーションミスカテゴリのシナリオ生成
 * - 設定変更ミス（EC2）
 * - デプロイ失敗（Lambda, ECS）
 */
export function generateOperationScenarios(config: InfraConfig): FailureScenario[] {
  const scenarios: FailureScenario[] = [];

  const ec2Resources = config.resources.filter((r) => r.type === 'AWS::EC2::Instance');
  const lambdaResources = config.resources.filter((r) => r.type === 'AWS::Lambda::Function');
  const ecsResources = config.resources.filter((r) => r.type === 'AWS::ECS::Service');

  // EC2 設定変更ミスシナリオ
  for (const ec2 of ec2Resources) {
    scenarios.push({
      id: nextId(),
      name: `設定変更ミス: ${ec2.logicalId}`,
      category: 'operation',
      severity: 'Medium',
      description: `EC2インスタンス ${ec2.logicalId} のセキュリティグループ設定を誤って変更した場合の影響と復旧を検証する`,
      affectedResources: [ec2.logicalId],
      impactScope: `${ec2.logicalId} へのネットワークアクセス`,
      prerequisites: [
        'EC2インスタンスが稼働中であること',
        'セキュリティグループの変更権限があること',
        '現在のセキュリティグループ設定をバックアップ済みであること',
      ],
      steps: [
        { order: 1, action: '現在のセキュリティグループ設定を記録', target: ec2.logicalId },
        { order: 2, action: 'セキュリティグループのインバウンドルールを誤った設定に変更', target: ec2.logicalId, parameters: { action: 'modify-security-group', removeAllInbound: true } },
        { order: 3, action: 'サービスへの影響を確認', target: ec2.logicalId },
        { order: 4, action: '設定ミスの検知と復旧手順を実行', target: ec2.logicalId },
      ],
      expectedOutcome: '設定変更の影響が迅速に検知され、元の設定に復旧できること',
      rollbackSteps: [
        'セキュリティグループを元の設定に復元',
        'ネットワーク接続の正常性を確認',
      ],
      estimatedDuration: 25,
      tags: ['operation', 'config-change', 'ec2'],
    });
  }

  // Lambda デプロイ失敗シナリオ
  for (const lambda of lambdaResources) {
    scenarios.push({
      id: nextId(),
      name: `デプロイ失敗: ${lambda.logicalId}`,
      category: 'operation',
      severity: 'High',
      description: `Lambda関数 ${lambda.logicalId} のデプロイ失敗をシミュレートし、ロールバック手順を検証する`,
      affectedResources: [lambda.logicalId],
      impactScope: `${lambda.logicalId} を呼び出すすべてのクライアント`,
      prerequisites: [
        'Lambda関数がデプロイ済みであること',
        'エイリアスまたはバージョン管理が設定されていること',
      ],
      steps: [
        { order: 1, action: '現在のLambda関数バージョンを記録', target: lambda.logicalId },
        { order: 2, action: '意図的にエラーを含むコードをデプロイ', target: lambda.logicalId, parameters: { action: 'deploy-broken-version' } },
        { order: 3, action: 'エラーメトリクスの増加を観測', target: lambda.logicalId },
        { order: 4, action: 'ロールバックを実行', target: lambda.logicalId },
      ],
      expectedOutcome: 'デプロイ失敗が検知され、前バージョンへのロールバックが正常に完了すること',
      rollbackSteps: [
        'Lambda関数を前バージョンにロールバック',
        'エイリアスを正常なバージョンに切り替え',
        '関数の正常動作を確認',
      ],
      estimatedDuration: 20,
      tags: ['operation', 'deploy-failure', 'lambda'],
    });
  }

  // ECS デプロイ失敗シナリオ
  for (const ecs of ecsResources) {
    scenarios.push({
      id: nextId(),
      name: `デプロイ失敗: ${ecs.logicalId}`,
      category: 'operation',
      severity: 'High',
      description: `ECSサービス ${ecs.logicalId} のデプロイ失敗をシミュレートし、ロールバック手順を検証する`,
      affectedResources: [ecs.logicalId],
      impactScope: `${ecs.logicalId} が提供するサービスエンドポイント`,
      prerequisites: [
        'ECSサービスが稼働中であること',
        'デプロイメント設定（ローリングアップデート等）が構成されていること',
      ],
      steps: [
        { order: 1, action: '現在のタスク定義リビジョンを記録', target: ecs.logicalId },
        { order: 2, action: '起動に失敗するタスク定義でデプロイを実行', target: ecs.logicalId, parameters: { action: 'deploy-broken-task-definition' } },
        { order: 3, action: 'デプロイメントの失敗とサーキットブレーカーの動作を観測', target: ecs.logicalId },
      ],
      expectedOutcome: 'ECSデプロイメントサーキットブレーカーが発動し、自動ロールバックが実行されること',
      rollbackSteps: [
        'ECSサービスを前のタスク定義リビジョンに更新',
        'タスクの正常起動を確認',
      ],
      estimatedDuration: 30,
      tags: ['operation', 'deploy-failure', 'ecs'],
    });
  }

  return scenarios;
}
