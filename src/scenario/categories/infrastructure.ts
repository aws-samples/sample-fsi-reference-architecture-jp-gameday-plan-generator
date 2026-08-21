import type { InfraConfig, FailureScenario, ScenarioStep } from '../../types/index.js';

let counter = 0;
function nextId(): string {
  return `scenario-infrastructure-${++counter}`;
}

/** Reset counter (for testing) */
export function resetInfrastructureCounter(): void {
  counter = 0;
}

/**
 * インフラ障害カテゴリのシナリオ生成
 * - EC2停止
 * - AZ障害
 * - Lambda スロットリング
 * - ECS タスク障害
 */
export function generateInfrastructureScenarios(config: InfraConfig): FailureScenario[] {
  const scenarios: FailureScenario[] = [];

  const ec2Resources = config.resources.filter((r) => r.type === 'AWS::EC2::Instance');
  const lambdaResources = config.resources.filter((r) => r.type === 'AWS::Lambda::Function');
  const ecsResources = config.resources.filter((r) => r.type === 'AWS::ECS::Service');
  const rdsResources = config.resources.filter((r) => r.type === 'AWS::RDS::DBInstance');

  // EC2インスタンス停止シナリオ
  for (const ec2 of ec2Resources) {
    scenarios.push({
      id: nextId(),
      name: `EC2インスタンス停止: ${ec2.logicalId}`,
      category: 'infrastructure',
      severity: 'High',
      description: `EC2インスタンス ${ec2.logicalId} を強制停止し、サービスへの影響と自動復旧を検証する`,
      affectedResources: [ec2.logicalId],
      impactScope: `${ec2.region} リージョンの ${ec2.logicalId} に依存するサービス`,
      prerequisites: [
        'AWS FIS実行用IAMロールが設定されていること',
        '対象インスタンスが実行中であること',
      ],
      steps: [
        { order: 1, action: 'EC2インスタンスの現在の状態を確認', target: ec2.logicalId },
        { order: 2, action: 'FIS実験でEC2インスタンスを停止', target: ec2.logicalId, parameters: { action: 'aws:ec2:stop-instances' } },
        { order: 3, action: 'サービスへの影響を観測', target: ec2.logicalId },
      ],
      expectedOutcome: 'Auto Scalingまたは手動復旧によりサービスが回復すること',
      rollbackSteps: [
        'EC2インスタンスを手動で起動',
        'サービスの正常性を確認',
      ],
      estimatedDuration: 30,
      tags: ['ec2', 'instance-stop'],
    });
  }

  // AZ障害シナリオ（EC2またはRDSが存在する場合）
  const azTargetResources = [...ec2Resources, ...rdsResources, ...ecsResources];
  if (azTargetResources.length > 0) {
    const affectedIds = azTargetResources.map((r) => r.logicalId);
    scenarios.push({
      id: nextId(),
      name: 'アベイラビリティゾーン障害シミュレーション',
      category: 'infrastructure',
      severity: 'Critical',
      description: '単一AZの障害をシミュレートし、マルチAZ構成の耐障害性を検証する',
      affectedResources: affectedIds,
      impactScope: '対象AZ内の全リソース',
      prerequisites: [
        'マルチAZ構成が推奨されること',
        'AWS FIS実行用IAMロールが設定されていること',
      ],
      steps: [
        { order: 1, action: '対象AZ内のリソース一覧を確認', target: 'availability-zone' },
        { order: 2, action: 'FIS実験でAZ障害を注入', target: 'availability-zone', parameters: { action: 'aws:ec2:stop-instances', selectionMode: 'ALL' } },
        { order: 3, action: '他AZへのフェイルオーバーを確認', target: 'availability-zone' },
      ],
      expectedOutcome: '他のAZでサービスが継続し、ユーザー影響が最小限であること',
      rollbackSteps: [
        '停止したインスタンスを再起動',
        '全AZのリソース正常性を確認',
      ],
      estimatedDuration: 45,
      tags: ['az-failure', 'high-availability'],
    });
  }

  // Lambdaスロットリングシナリオ
  for (const lambda of lambdaResources) {
    scenarios.push({
      id: nextId(),
      name: `Lambdaスロットリング: ${lambda.logicalId}`,
      category: 'infrastructure',
      severity: 'Medium',
      description: `Lambda関数 ${lambda.logicalId} の同時実行数制限によるスロットリングを検証する`,
      affectedResources: [lambda.logicalId],
      impactScope: `${lambda.logicalId} を呼び出すすべてのクライアント`,
      prerequisites: [
        'Lambda関数がデプロイ済みであること',
        'CloudWatchメトリクスが有効であること',
      ],
      steps: [
        { order: 1, action: 'Lambda関数の現在の同時実行数を確認', target: lambda.logicalId },
        { order: 2, action: 'FIS実験でAPIエラーを注入', target: lambda.logicalId, parameters: { action: 'aws:fis:inject-api-throttle-error' } },
        { order: 3, action: 'スロットリングメトリクスを観測', target: lambda.logicalId },
      ],
      expectedOutcome: 'リトライロジックまたはキューイングにより処理が最終的に完了すること',
      rollbackSteps: [
        'FIS実験を停止',
        'Lambda関数の正常動作を確認',
      ],
      estimatedDuration: 20,
      tags: ['lambda', 'throttling'],
    });
  }

  // ECSタスク障害シナリオ
  for (const ecs of ecsResources) {
    scenarios.push({
      id: nextId(),
      name: `ECSタスク障害: ${ecs.logicalId}`,
      category: 'infrastructure',
      severity: 'High',
      description: `ECSサービス ${ecs.logicalId} のタスクを強制停止し、サービスの自動復旧を検証する`,
      affectedResources: [ecs.logicalId],
      impactScope: `${ecs.logicalId} が提供するサービスエンドポイント`,
      prerequisites: [
        'ECSサービスが実行中であること',
        'タスク定義が正しく設定されていること',
      ],
      steps: [
        { order: 1, action: '実行中のタスク数を確認', target: ecs.logicalId },
        { order: 2, action: 'FIS実験でECSタスクを停止', target: ecs.logicalId, parameters: { action: 'aws:ecs:stop-task' } },
        { order: 3, action: 'タスクの再起動を観測', target: ecs.logicalId },
      ],
      expectedOutcome: 'ECSサービスが自動的に新しいタスクを起動し、サービスが復旧すること',
      rollbackSteps: [
        'ECSサービスのdesired countを確認・修正',
        'タスクの正常起動を確認',
      ],
      estimatedDuration: 25,
      tags: ['ecs', 'task-failure'],
    });
  }

  return scenarios;
}
