/**
 * FISアクション定義
 *
 * リソースタイプ別のFISアクションマッピングと、
 * FIS未サポートリソースに対する代替手段の定義
 */

export interface FISActionMapping {
  actionId: string;
  description: string;
  defaultParameters?: Record<string, string>;
  defaultDuration?: string;
}

export interface UnsupportedResourceInfo {
  reason: string;
  alternatives: string[];
}

/**
 * リソースタイプ → FISアクションのマッピング
 * シナリオカテゴリとリソースタイプの組み合わせで適切なアクションを選択
 */
export const FIS_ACTION_MAP: Record<string, FISActionMapping[]> = {
  'AWS::EC2::Instance': [
    {
      actionId: 'aws:ec2:stop-instances',
      description: 'EC2インスタンスを停止',
      defaultDuration: 'PT5M',
    },
    {
      actionId: 'aws:ec2:terminate-instances',
      description: 'EC2インスタンスを終了',
    },
  ],
  'AWS::RDS::DBInstance': [
    {
      actionId: 'aws:rds:reboot-db-instances',
      description: 'RDSインスタンスを再起動（フェイルオーバー付き）',
      defaultParameters: { forceFailover: 'true' },
    },
  ],
  'AWS::ECS::Service': [
    {
      actionId: 'aws:ecs:stop-task',
      description: 'ECSタスクを停止',
    },
  ],
  'AWS::Lambda::Function': [
    {
      actionId: 'aws:fis:inject-api-internal-error',
      description: 'Lambda関数にAPI内部エラーを注入',
      defaultDuration: 'PT5M',
    },
    {
      actionId: 'aws:fis:inject-api-throttle-error',
      description: 'Lambda関数にスロットリングエラーを注入',
      defaultDuration: 'PT5M',
    },
  ],
  'AWS::ElasticLoadBalancingV2::LoadBalancer': [
    {
      actionId: 'aws:fis:inject-api-internal-error',
      description: 'ネットワーク障害シミュレーション（ELB経由）',
      defaultDuration: 'PT5M',
    },
  ],
  'AWS::DynamoDB::Table': [
    {
      actionId: 'aws:fis:inject-api-throttle-error',
      description: 'DynamoDBスロットリングエラーを注入',
      defaultDuration: 'PT5M',
    },
  ],
};

/**
 * FIS未サポートリソースの代替手段マッピング
 */
export const UNSUPPORTED_RESOURCES: Record<string, UnsupportedResourceInfo> = {
  'AWS::S3::Bucket': {
    reason: 'S3はAWS FISで直接サポートされていません',
    alternatives: [
      'バケットポリシーの変更によるアクセス拒否シミュレーション',
      'VPCエンドポイントポリシーの変更によるアクセス制限',
      'IAMポリシーの一時的な変更によるアクセス制御',
    ],
  },
  'AWS::SNS::Topic': {
    reason: 'SNSはAWS FISで直接サポートされていません',
    alternatives: [
      'SSM Run Commandによるサブスクリプション無効化',
      'SNSトピックポリシーの一時的な変更',
      'Lambda関数経由でのメッセージ配信遅延シミュレーション',
    ],
  },
  'AWS::SQS::Queue': {
    reason: 'SQSはAWS FISで直接サポートされていません',
    alternatives: [
      'SSM Run Commandによるキューパージ',
      'SQSキューポリシーの一時的な変更',
      'Lambda関数経由でのメッセージ処理遅延シミュレーション',
    ],
  },
  'AWS::CloudFront::Distribution': {
    reason: 'CloudFrontはAWS FISで直接サポートされていません',
    alternatives: [
      'Route 53ヘルスチェックによるフェイルオーバーテスト',
      'オリジンサーバーの障害シミュレーション',
      'WAFルールによるアクセスブロック',
    ],
  },
};

/**
 * リソースタイプに対応するFISアクションを取得
 * 最初のアクション（デフォルト）を返す
 */
export function getActionsForResource(resourceType: string): FISActionMapping[] | undefined {
  return FIS_ACTION_MAP[resourceType];
}

/**
 * リソースタイプがFISでサポートされているか判定
 */
export function isFISSupported(resourceType: string): boolean {
  return resourceType in FIS_ACTION_MAP;
}

/**
 * FIS未サポートリソースの代替手段情報を取得
 */
export function getUnsupportedInfo(resourceType: string): UnsupportedResourceInfo | undefined {
  return UNSUPPORTED_RESOURCES[resourceType];
}
