import type { InfraConfig, FailureScenario } from '../../types/index.js';

let counter = 0;
function nextId(): string {
  return `scenario-data-${++counter}`;
}

/** Reset counter (for testing) */
export function resetDataCounter(): void {
  counter = 0;
}

/**
 * データ障害カテゴリのシナリオ生成
 * - RDS障害（フェイルオーバー）
 * - S3アクセス不可
 * - DynamoDB スロットリング
 * - DynamoDB アクセス拒否
 */
export function generateDataScenarios(config: InfraConfig): FailureScenario[] {
  const scenarios: FailureScenario[] = [];

  const rdsResources = config.resources.filter((r) => r.type === 'AWS::RDS::DBInstance');
  const s3Resources = config.resources.filter((r) => r.type === 'AWS::S3::Bucket');
  const dynamoResources = config.resources.filter((r) => r.type === 'AWS::DynamoDB::Table');

  // RDS障害（フェイルオーバー）シナリオ
  for (const rds of rdsResources) {
    scenarios.push({
      id: nextId(),
      name: `RDSフェイルオーバー: ${rds.logicalId}`,
      category: 'data',
      severity: 'Critical',
      description: `RDSインスタンス ${rds.logicalId} の強制フェイルオーバーを実行し、データベースの可用性を検証する`,
      affectedResources: [rds.logicalId],
      impactScope: `${rds.logicalId} に接続するすべてのアプリケーション`,
      prerequisites: [
        'RDSインスタンスがマルチAZ構成であること（推奨）',
        'データベース接続のリトライロジックが実装されていること',
      ],
      steps: [
        { order: 1, action: '現在のデータベース接続状態を確認', target: rds.logicalId },
        { order: 2, action: 'FIS実験でRDSフェイルオーバーを実行', target: rds.logicalId, parameters: { action: 'aws:rds:reboot-db-instances', forceFailover: true } },
        { order: 3, action: 'フェイルオーバー完了とアプリケーション復旧を観測', target: rds.logicalId },
      ],
      expectedOutcome: 'フェイルオーバーが完了し、アプリケーションが自動的に再接続すること',
      rollbackSteps: [
        'RDSインスタンスの状態を確認',
        '必要に応じて手動でフェイルバック',
        'データベース接続の正常性を確認',
      ],
      estimatedDuration: 30,
      tags: ['rds', 'failover', 'database'],
    });
  }

  // S3アクセス不可シナリオ
  for (const s3 of s3Resources) {
    scenarios.push({
      id: nextId(),
      name: `S3アクセス拒否: ${s3.logicalId}`,
      category: 'data',
      severity: 'High',
      description: `S3バケット ${s3.logicalId} へのアクセスを一時的に拒否し、アプリケーションのエラーハンドリングを検証する`,
      affectedResources: [s3.logicalId],
      impactScope: `${s3.logicalId} を利用するすべてのサービス`,
      prerequisites: [
        'S3バケットが存在すること',
        'バケットポリシーの変更権限があること',
      ],
      steps: [
        { order: 1, action: '現在のバケットポリシーをバックアップ', target: s3.logicalId },
        { order: 2, action: 'バケットポリシーでアクセスを拒否', target: s3.logicalId, parameters: { effect: 'Deny', principal: '*' } },
        { order: 3, action: 'アプリケーションのエラーハンドリングを観測', target: s3.logicalId },
      ],
      expectedOutcome: 'アプリケーションが適切なエラーメッセージを返し、データ損失が発生しないこと',
      rollbackSteps: [
        'バケットポリシーを元の状態に復元',
        'S3アクセスの正常性を確認',
      ],
      estimatedDuration: 20,
      tags: ['s3', 'access-denied', 'data'],
    });
  }

  // DynamoDB スロットリングシナリオ
  for (const dynamo of dynamoResources) {
    scenarios.push({
      id: nextId(),
      name: `DynamoDBスロットリング: ${dynamo.logicalId}`,
      category: 'data',
      severity: 'Medium',
      description: `DynamoDBテーブル ${dynamo.logicalId} のキャパシティ制限によるスロットリングを検証する`,
      affectedResources: [dynamo.logicalId],
      impactScope: `${dynamo.logicalId} を利用するすべての読み書き操作`,
      prerequisites: [
        'DynamoDBテーブルが作成済みであること',
        'CloudWatchメトリクスが有効であること',
      ],
      steps: [
        { order: 1, action: '現在のキャパシティ使用率を確認', target: dynamo.logicalId },
        { order: 2, action: 'FIS実験でAPIスロットリングを注入', target: dynamo.logicalId, parameters: { action: 'aws:fis:inject-api-throttle-error' } },
        { order: 3, action: 'スロットリングメトリクスとリトライ動作を観測', target: dynamo.logicalId },
      ],
      expectedOutcome: 'エクスポネンシャルバックオフによるリトライが機能し、最終的にリクエストが成功すること',
      rollbackSteps: [
        'FIS実験を停止',
        'DynamoDBテーブルの正常動作を確認',
      ],
      estimatedDuration: 20,
      tags: ['dynamodb', 'throttling', 'data'],
    });
  }

  // DynamoDB アクセス拒否シナリオ
  for (const dynamo of dynamoResources) {
    scenarios.push({
      id: nextId(),
      name: `DynamoDBアクセス拒否: ${dynamo.logicalId}`,
      category: 'data',
      severity: 'High',
      description: `DynamoDBテーブル ${dynamo.logicalId} へのIAMアクセス権限を一時的に制限し、権限エラー時の挙動を検証する`,
      affectedResources: [dynamo.logicalId],
      impactScope: `${dynamo.logicalId} を利用するすべてのサービス`,
      prerequisites: [
        'DynamoDBテーブルが作成済みであること',
        'IAMポリシーの変更権限があること',
      ],
      steps: [
        { order: 1, action: '現在のIAMポリシーをバックアップ', target: dynamo.logicalId },
        { order: 2, action: 'IAMポリシーでDynamoDBアクセスを拒否', target: dynamo.logicalId, parameters: { effect: 'Deny' } },
        { order: 3, action: 'アクセス拒否時のアプリケーション挙動を観測', target: dynamo.logicalId },
      ],
      expectedOutcome: 'アプリケーションが適切なエラーハンドリングを行い、ユーザーに分かりやすいエラーを返すこと',
      rollbackSteps: [
        'IAMポリシーを元の状態に復元',
        'DynamoDBアクセスの正常性を確認',
      ],
      estimatedDuration: 20,
      tags: ['dynamodb', 'access-denied', 'data'],
    });
  }

  return scenarios;
}
