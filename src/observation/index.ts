import type {
  FailureScenario,
  InfraConfig,
  ObservationPoint,
  CloudWatchConfig,
} from '../types/index.js';

// ============================================================
// ID生成用カウンター
// ============================================================

let observationCounter = 0;

export function resetObservationCounter(): void {
  observationCounter = 0;
}

function nextId(prefix: string): string {
  observationCounter++;
  return `${prefix}-${String(observationCounter).padStart(3, '0')}`;
}

// ============================================================
// カテゴリ別メトリクス定義
// ============================================================

interface MetricDefinition {
  type: ObservationPoint['type'];
  name: string;
  description: string;
  namespace: string;
  metricName: string;
  normalRange: { min?: number; max?: number };
  threshold: number;
  statistic: string;
  period: number;
}

const CATEGORY_METRICS: Record<string, MetricDefinition[]> = {
  infrastructure: [
    {
      type: 'metric',
      name: 'CPU使用率',
      description: 'EC2インスタンスのCPU使用率を監視',
      namespace: 'AWS/EC2',
      metricName: 'CPUUtilization',
      normalRange: { min: 0, max: 70 },
      threshold: 90,
      statistic: 'Average',
      period: 60,
    },
    {
      type: 'alarm',
      name: 'ステータスチェック失敗',
      description: 'EC2インスタンスのステータスチェック失敗を検知',
      namespace: 'AWS/EC2',
      metricName: 'StatusCheckFailed',
      normalRange: { min: 0, max: 0 },
      threshold: 1,
      statistic: 'Maximum',
      period: 60,
    },
    {
      type: 'metric',
      name: '正常ホスト数',
      description: 'ロードバランサー配下の正常ホスト数を監視',
      namespace: 'AWS/ApplicationELB',
      metricName: 'HealthyHostCount',
      normalRange: { min: 1, max: 100 },
      threshold: 0,
      statistic: 'Minimum',
      period: 60,
    },
  ],
  network: [
    {
      type: 'metric',
      name: 'レイテンシ',
      description: 'ターゲットグループのレスポンスレイテンシを監視',
      namespace: 'AWS/ApplicationELB',
      metricName: 'TargetResponseTime',
      normalRange: { min: 0, max: 500 },
      threshold: 2000,
      statistic: 'Average',
      period: 60,
    },
    {
      type: 'alarm',
      name: '5XXエラー数',
      description: 'ターゲットの5XXエラー数を検知',
      namespace: 'AWS/ApplicationELB',
      metricName: 'HTTPCode_Target_5XX_Count',
      normalRange: { min: 0, max: 5 },
      threshold: 50,
      statistic: 'Sum',
      period: 300,
    },
    {
      type: 'metric',
      name: '異常ホスト数',
      description: 'ロードバランサー配下の異常ホスト数を監視',
      namespace: 'AWS/ApplicationELB',
      metricName: 'UnHealthyHostCount',
      normalRange: { min: 0, max: 0 },
      threshold: 1,
      statistic: 'Maximum',
      period: 60,
    },
  ],
  data: [
    {
      type: 'metric',
      name: 'DB接続数',
      description: 'RDSインスタンスのアクティブ接続数を監視',
      namespace: 'AWS/RDS',
      metricName: 'DatabaseConnections',
      normalRange: { min: 0, max: 100 },
      threshold: 200,
      statistic: 'Average',
      period: 60,
    },
    {
      type: 'alarm',
      name: '空きストレージ容量',
      description: 'RDSインスタンスの空きストレージ容量を監視',
      namespace: 'AWS/RDS',
      metricName: 'FreeStorageSpace',
      normalRange: { min: 5000000000, max: undefined },
      threshold: 1000000000,
      statistic: 'Minimum',
      period: 300,
    },
    {
      type: 'metric',
      name: '読み取りレイテンシ',
      description: 'RDSインスタンスの読み取りレイテンシを監視',
      namespace: 'AWS/RDS',
      metricName: 'ReadLatency',
      normalRange: { min: 0, max: 0.01 },
      threshold: 0.05,
      statistic: 'Average',
      period: 60,
    },
    {
      type: 'metric',
      name: '書き込みレイテンシ',
      description: 'RDSインスタンスの書き込みレイテンシを監視',
      namespace: 'AWS/RDS',
      metricName: 'WriteLatency',
      normalRange: { min: 0, max: 0.01 },
      threshold: 0.05,
      statistic: 'Average',
      period: 60,
    },
  ],
  security: [
    {
      type: 'log-filter',
      name: 'S3アクセスログ',
      description: 'S3バケットへの不正アクセスパターンを監視',
      namespace: 'AWS/S3',
      metricName: 'NumberOfObjects',
      normalRange: { min: 0, max: 1000000 },
      threshold: 100,
      statistic: 'Sum',
      period: 300,
    },
    {
      type: 'log-filter',
      name: 'CloudTrailイベント',
      description: 'CloudTrailの異常なAPIコールパターンを監視',
      namespace: 'AWS/CloudTrail',
      metricName: 'EventCount',
      normalRange: { min: 0, max: 1000 },
      threshold: 500,
      statistic: 'Sum',
      period: 300,
    },
  ],
  operation: [
    {
      type: 'metric',
      name: 'デプロイメントステータス',
      description: 'デプロイメントの成功/失敗状態を監視',
      namespace: 'AWS/CodeDeploy',
      metricName: 'DeploymentStatus',
      normalRange: { min: 0, max: 0 },
      threshold: 1,
      statistic: 'Sum',
      period: 300,
    },
    {
      type: 'alarm',
      name: 'エラー数',
      description: 'Lambda関数のエラー数を監視',
      namespace: 'AWS/Lambda',
      metricName: 'Errors',
      normalRange: { min: 0, max: 5 },
      threshold: 50,
      statistic: 'Sum',
      period: 300,
    },
  ],
};

// ============================================================
// 確認タイミングの割り当て
// ============================================================

const TIMING_CYCLE: Array<ObservationPoint['checkTiming']> = ['before', 'during', 'after'];

// ============================================================
// 観測ポイント生成
// ============================================================

/**
 * 障害シナリオと構成情報から観測ポイントを生成する
 *
 * - シナリオのカテゴリに基づいてCloudWatchメトリクス、アラーム、ログフィルタを生成
 * - X-Rayトレーシングが有効な場合はxray-trace観測ポイントを追加
 */
export function generateObservationPoints(
  scenarios: FailureScenario[],
  config: InfraConfig,
): ObservationPoint[] {
  resetObservationCounter();

  const points: ObservationPoint[] = [];

  for (const scenario of scenarios) {
    const metrics = CATEGORY_METRICS[scenario.category] ?? [];

    for (let i = 0; i < metrics.length; i++) {
      const metric = metrics[i];
      const timing = TIMING_CYCLE[i % TIMING_CYCLE.length];

      const cloudwatchConfig: CloudWatchConfig = {
        namespace: metric.namespace,
        metricName: metric.metricName,
        statistic: metric.statistic,
        period: metric.period,
      };

      if (metric.type === 'alarm') {
        cloudwatchConfig.alarmActions = [
          'arn:aws:sns:us-east-1:123456789012:gameday-alarm-topic',
        ];
      }

      if (metric.type === 'log-filter') {
        cloudwatchConfig.logGroupName = `/aws/gameday/${scenario.category}`;
        cloudwatchConfig.filterPattern = 'ERROR';
      }

      points.push({
        id: nextId('obs'),
        scenarioId: scenario.id,
        type: metric.type,
        name: metric.name,
        description: metric.description,
        normalRange: { ...metric.normalRange },
        threshold: metric.threshold,
        checkTiming: timing,
        cloudwatchConfig,
      });
    }

    // X-Rayトレーシングが有効な場合、xray-trace観測ポイントを追加
    if (config.metadata.hasXRayTracing) {
      points.push({
        id: nextId('obs'),
        scenarioId: scenario.id,
        type: 'xray-trace',
        name: 'X-Rayトレース分析',
        description: `${scenario.name}に関連するX-Rayトレースの異常を監視`,
        normalRange: { min: 0, max: 1000 },
        threshold: 5000,
        checkTiming: 'during',
        cloudwatchConfig: {
          namespace: 'AWS/X-Ray',
          metricName: 'ResponseTime',
          statistic: 'Average',
          period: 60,
        },
      });
    }
  }

  return points;
}

// ============================================================
// CloudFormationテンプレート出力
// ============================================================

/**
 * 観測ポイントからCloudFormationテンプレートを生成する
 *
 * - alarm タイプの観測ポイントから AWS::CloudWatch::Alarm リソースを生成
 * - 全観測ポイントの情報を含む AWS::CloudWatch::Dashboard リソースを生成
 */
export function toCloudFormation(points: ObservationPoint[]): Record<string, unknown> {
  const resources: Record<string, unknown> = {};

  // アラームリソースの生成
  const alarmPoints = points.filter((p) => p.type === 'alarm');
  for (const point of alarmPoints) {
    const alarmLogicalId = `GameDayAlarm${sanitizeId(point.id)}`;
    resources[alarmLogicalId] = {
      Type: 'AWS::CloudWatch::Alarm',
      Properties: {
        AlarmName: point.name,
        AlarmDescription: point.description,
        Namespace: point.cloudwatchConfig.namespace,
        MetricName: point.cloudwatchConfig.metricName,
        Statistic: point.cloudwatchConfig.statistic,
        Period: point.cloudwatchConfig.period,
        EvaluationPeriods: 1,
        Threshold: point.threshold,
        ComparisonOperator: 'GreaterThanOrEqualToThreshold',
        AlarmActions: point.cloudwatchConfig.alarmActions ?? [],
      },
    };
  }

  // ダッシュボードリソースの生成
  if (points.length > 0) {
    const dashboardWidgets = points
      .filter((p) => p.type === 'metric' || p.type === 'alarm')
      .map((point, index) => ({
        type: 'metric',
        x: (index % 3) * 8,
        y: Math.floor(index / 3) * 6,
        width: 8,
        height: 6,
        properties: {
          title: point.name,
          metrics: [
            [
              point.cloudwatchConfig.namespace,
              point.cloudwatchConfig.metricName,
            ],
          ],
          period: point.cloudwatchConfig.period,
          stat: point.cloudwatchConfig.statistic,
        },
      }));

    resources['GameDayDashboard'] = {
      Type: 'AWS::CloudWatch::Dashboard',
      Properties: {
        DashboardName: 'GameDay-Observation-Dashboard',
        DashboardBody: JSON.stringify({ widgets: dashboardWidgets }),
      },
    };
  }

  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'GameDay観測ポイント - CloudWatchアラームとダッシュボード',
    Resources: resources,
  };
}

/**
 * IDをCloudFormation論理IDとして安全な形式に変換
 */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '');
}
