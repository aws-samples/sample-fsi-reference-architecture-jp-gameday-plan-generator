/**
 * FIS実験テンプレート → デプロイ可能なCloudFormationテンプレート変換
 *
 * 内部の `FISExperimentTemplate` (FIS API shape) を、
 * IAMロール / CloudWatchアラーム / `AWS::FIS::ExperimentTemplate` を
 * 同梱した1スタックの CFn テンプレートに変換する。
 *
 * 生成テンプレートはデプロイ後すぐに `aws fis start-experiment` で
 * 実行できる状態 (= プレースホルダーが残らない) を目指す。
 */

import type { FISExperimentTemplate, FISTarget, FISAction } from '../types/index.js';

// ============================================================
// CFnリソース表現
// ============================================================

interface CfnResource {
  Type: string;
  Properties: Record<string, unknown>;
  DependsOn?: string[];
  Metadata?: Record<string, unknown>;
}

export interface CfnTemplate {
  AWSTemplateFormatVersion: '2010-09-09';
  Description: string;
  Parameters: Record<string, CfnParameter>;
  Resources: Record<string, CfnResource>;
  Outputs: Record<string, CfnOutput>;
}

interface CfnParameter {
  Type: string;
  Default?: string | number;
  Description?: string;
  AllowedValues?: string[];
}

interface CfnOutput {
  Description?: string;
  Value: unknown;
  Export?: { Name: unknown };
}

// ============================================================
// IAMポリシー: actionId → 必要権限のマッピング
// ============================================================

/**
 * IAM ポリシーステートメント表現。
 */
interface PolicyStatement {
  Sid?: string;
  Effect: 'Allow';
  Action: string[];
  Resource: string | string[];
  Condition?: Record<string, Record<string, string>>;
}

/**
 * 各 FIS actionId が要求する「破壊的 (mutating) アクション」と、
 * そのリソーススコープ。破壊的アクションはリソースレベル制限が可能なため、
 * `Resource: '*'` を避けて ARN パターンにスコープする (least privilege)。
 * https://docs.aws.amazon.com/fis/latest/userguide/security-iam-awsmanpol.html を簡素化。
 */
const ACTION_SCOPED_PERMISSIONS: Record<
  string,
  { sid: string; actions: string[]; targetResourceType: string; arnPatterns: string[] }
> = {
  'aws:ec2:stop-instances': {
    sid: 'Ec2StopStartInstances',
    actions: ['ec2:StartInstances', 'ec2:StopInstances'],
    targetResourceType: 'aws:ec2:instance',
    arnPatterns: ['arn:aws:ec2:*:*:instance/*'],
  },
  'aws:ec2:terminate-instances': {
    sid: 'Ec2TerminateInstances',
    actions: ['ec2:TerminateInstances'],
    targetResourceType: 'aws:ec2:instance',
    arnPatterns: ['arn:aws:ec2:*:*:instance/*'],
  },
  'aws:rds:reboot-db-instances': {
    sid: 'RdsRebootDbInstances',
    actions: ['rds:RebootDBInstance'],
    targetResourceType: 'aws:rds:db',
    arnPatterns: ['arn:aws:rds:*:*:db:*'],
  },
  'aws:rds:failover-db-cluster': {
    sid: 'RdsFailoverDbCluster',
    actions: ['rds:FailoverDBCluster'],
    targetResourceType: 'aws:rds:cluster',
    arnPatterns: ['arn:aws:rds:*:*:cluster:*'],
  },
  'aws:ecs:stop-task': {
    sid: 'EcsStopTask',
    actions: ['ecs:StopTask'],
    targetResourceType: 'aws:ecs:task',
    arnPatterns: ['arn:aws:ecs:*:*:task/*'],
  },
};

/**
 * 各 FIS actionId が要求する「読み取り専用等の非スコープアクション」。
 * Describe / List 系および fis:InjectApi* はリソースレベル制限に
 * 対応しないため `Resource: '*'` のステートメントに集約する。
 */
const ACTION_UNSCOPED_PERMISSIONS: Record<string, string[]> = {
  'aws:ec2:stop-instances': ['ec2:DescribeInstances'],
  'aws:ec2:terminate-instances': ['ec2:DescribeInstances'],
  'aws:rds:reboot-db-instances': ['rds:DescribeDBInstances'],
  'aws:rds:failover-db-cluster': ['rds:DescribeDBClusters'],
  'aws:ecs:stop-task': ['ecs:DescribeTasks', 'ecs:ListTasks'],
  'aws:fis:inject-api-internal-error': ['fis:InjectApiInternalError'],
  'aws:fis:inject-api-throttle-error': ['fis:InjectApiThrottleError'],
  'aws:fis:inject-api-unavailable-error': ['fis:InjectApiUnavailableError'],
};

/**
 * 全 FIS アクションが共通で必要とする CloudWatch / ログ権限。
 * いずれもリソースレベル制限非対応のため '*' に残す。
 */
const COMMON_FIS_PERMISSIONS: string[] = [
  'cloudwatch:DescribeAlarms',
  'logs:CreateLogDelivery',
  'logs:DescribeLogGroups',
];

// ============================================================
// ヘルパー: アクションが要求する権限をステートメント群に集約
// ============================================================

/**
 * FIS アクション定義から IAM ポリシーステートメント群を構築する。
 *
 * - 破壊的アクション: サービス別ステートメントに分割し、ARN パターンでスコープ。
 *   さらに、アクションが参照するターゲットが
 *   - `resourceArns` を持つ場合はその ARN 群に直接スコープ
 *   - `resourceTags` を持つ場合は `aws:ResourceTag/...` 条件を付与
 *   して「実験対象のリソースのみ」操作可能に絞る。
 * - 読み取り専用 / リソースレベル制限非対応のアクション: `Resource: '*'` の
 *   単一ステートメントに集約。
 */
function buildPolicyStatements(
  actions: Record<string, FISAction>,
  targets: Record<string, FISTarget>,
): PolicyStatement[] {
  const unscoped = new Set<string>(COMMON_FIS_PERMISSIONS);
  const scoped: PolicyStatement[] = [];
  const seen = new Set<string>();
  const usedSids = new Set<string>();

  for (const a of Object.values(actions)) {
    for (const p of ACTION_UNSCOPED_PERMISSIONS[a.actionId] ?? []) {
      unscoped.add(p);
    }

    const spec = ACTION_SCOPED_PERMISSIONS[a.actionId];
    if (!spec) continue;

    // アクションが参照するターゲット定義からリソーススコープを導出する
    const refTargets = Object.values(a.targets ?? {})
      .map(key => targets[key])
      .filter((t): t is FISTarget => !!t && t.resourceType === spec.targetResourceType);

    let resource: string[] = spec.arnPatterns;
    let condition: Record<string, Record<string, string>> | undefined;

    if (refTargets.length > 0 && refTargets.every(t => (t.resourceArns?.length ?? 0) > 0)) {
      // ターゲットが明示的な ARN 指定なら、その ARN 群へ直接スコープ
      resource = [...new Set(refTargets.flatMap(t => t.resourceArns ?? []))].sort();
    } else {
      // タグ選択ターゲットなら aws:ResourceTag 条件で対象を絞る
      const merged: Record<string, string> = {};
      let conflict = false;
      for (const t of refTargets) {
        for (const [k, v] of Object.entries(t.resourceTags ?? {})) {
          if (merged[k] !== undefined && merged[k] !== v) conflict = true;
          merged[k] = v;
        }
      }
      if (!conflict && Object.keys(merged).length > 0) {
        condition = {
          StringEquals: Object.fromEntries(
            Object.entries(merged).map(([k, v]) => [`aws:ResourceTag/${k}`, v]),
          ),
        };
      }
    }

    let sid = spec.sid;
    let n = 2;
    const stmtKey = JSON.stringify({ actions: spec.actions, resource, condition });
    if (seen.has(stmtKey)) continue;
    seen.add(stmtKey);
    while (usedSids.has(sid)) sid = `${spec.sid}${n++}`;
    usedSids.add(sid);

    scoped.push({
      Sid: sid,
      Effect: 'Allow',
      Action: [...spec.actions].sort(),
      Resource: resource,
      ...(condition ? { Condition: condition } : {}),
    });
  }

  return [
    {
      Sid: 'NonResourceScopedActions',
      Effect: 'Allow',
      Action: [...unscoped].sort(),
      Resource: '*',
    },
    ...scoped,
  ];
}

// ============================================================
// 各リソース生成
// ============================================================

/**
 * FIS 実験ロール: FIS サービスから AssumeRole され、
 * 上記アクションを実行できる最小権限ポリシーを持つ。
 *
 * 破壊的アクション (instance停止/終了、DB再起動/フェイルオーバー、タスク停止) は
 * サービス別ステートメントで ARN パターン + タグ条件にスコープし、
 * 実験対象外のリソースへの影響を防ぐ。実運用ではさらに対象リソースの
 * 個別 ARN へ絞り込むことを推奨 (生成テンプレートの Metadata に注記)。
 */
function buildFISRole(
  stackPrefix: string,
  actions: Record<string, FISAction>,
  targets: Record<string, FISTarget>,
): CfnResource {
  const statements = buildPolicyStatements(actions, targets);

  return {
    Type: 'AWS::IAM::Role',
    Properties: {
      RoleName: { 'Fn::Sub': `${stackPrefix}-fis-role-\${AWS::StackName}` },
      AssumeRolePolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { Service: 'fis.amazonaws.com' },
            Action: 'sts:AssumeRole',
          },
        ],
      },
      Description: `GameDay FIS experiment role for ${stackPrefix}`,
      Policies: [
        {
          PolicyName: 'fis-experiment-permissions',
          PolicyDocument: {
            Version: '2012-10-17',
            Statement: statements,
          },
        },
      ],
    },
    Metadata: {
      SecurityNote:
        '破壊的アクションは ARN パターンとターゲットのタグ条件でスコープ済み。' +
        '本番利用の前に、Resource を実験対象リソースの個別 ARN へさらに絞り込むこと。',
    },
  };
}

/**
 * 実験中のガードレールとなる CloudWatch アラーム。
 * 実験中にこのアラームが ALARM 状態になると FIS が StopCondition を発動する。
 *
 * デフォルトでは「アカウント全体のEC2 CPU平均が高すぎる/エラーが多発する」を
 * シンプルに検知するアラームを生成する。実環境ではユーザーが Parameter で
 * 既存アラームARNを与えて差し替えるのが推奨。
 */
function buildGuardrailAlarm(stackPrefix: string): CfnResource {
  return {
    Type: 'AWS::CloudWatch::Alarm',
    Properties: {
      AlarmName: { 'Fn::Sub': `${stackPrefix}-guardrail-\${AWS::StackName}` },
      AlarmDescription: 'GameDay 実験のガードレール。ALARM 状態で実験を強制停止する',
      ComparisonOperator: 'GreaterThanThreshold',
      EvaluationPeriods: 1,
      MetricName: 'CPUUtilization',
      Namespace: 'AWS/EC2',
      Period: 60,
      Statistic: 'Average',
      Threshold: 95,
      TreatMissingData: 'notBreaching',
    },
  };
}

/**
 * `FISTarget` を CFn `AWS::FIS::ExperimentTemplate` の Targets エントリ形式に変換。
 *
 * - `resourceTags` → CFn `ResourceTags` (`Map[String, String]`)
 * - `selectionMode` → そのまま
 * - `parameters` / `filters` などはオプション
 */
function targetToCfn(target: FISTarget): Record<string, unknown> {
  const out: Record<string, unknown> = {
    ResourceType: target.resourceType,
    SelectionMode: target.selectionMode,
  };

  if (target.resourceArns && target.resourceArns.length > 0) {
    out.ResourceArns = target.resourceArns;
  }

  if (target.resourceTags && Object.keys(target.resourceTags).length > 0) {
    out.ResourceTags = target.resourceTags;
  }

  if (target.filters && target.filters.length > 0) {
    out.Filters = target.filters.map(f => ({
      Path: f.path,
      Values: f.values,
    }));
  }

  if (target.parameters && Object.keys(target.parameters).length > 0) {
    out.Parameters = target.parameters;
  }

  return out;
}

/**
 * `FISAction` を CFn のアクション形式へ変換。
 * - `targets` の値（ターゲットキー参照）はそのまま CFn の `Targets` マップへ。
 * - `duration` は `parameters.duration` に集約される (FIS の慣習)。
 */
function actionToCfn(action: FISAction): Record<string, unknown> {
  const out: Record<string, unknown> = {
    ActionId: action.actionId,
  };

  if (action.description) out.Description = action.description;

  // duration は FIS の Parameters に "duration" として渡るのが正
  const params: Record<string, string> = { ...(action.parameters ?? {}) };
  if (action.duration && !params.duration) {
    params.duration = action.duration;
  }
  if (Object.keys(params).length > 0) out.Parameters = params;

  if (action.targets && Object.keys(action.targets).length > 0) {
    out.Targets = action.targets;
  }

  if (action.startAfter && action.startAfter.length > 0) {
    out.StartAfter = action.startAfter;
  }

  return out;
}

// ============================================================
// メイン: FISExperimentTemplate → CFnTemplate
// ============================================================

export interface ToCfnOptions {
  /** ロジカルIDの接頭辞 (デフォルト: "GameDay") */
  stackPrefix?: string;
  /** シナリオID。Description / 出力に含める */
  scenarioId: string;
  /** シナリオ名。Description に含める */
  scenarioName?: string;
}

/**
 * FIS 実験テンプレートを、デプロイ可能な CloudFormation テンプレート (JSON) に変換する。
 *
 * 出力テンプレートは:
 * - `AWS::IAM::Role` (FIS実行ロール、最小権限)
 * - `AWS::CloudWatch::Alarm` (ガードレール) — `ExistingGuardrailAlarmArn` パラメータが
 *   未指定の場合のみ生成
 * - `AWS::FIS::ExperimentTemplate` (実験本体)
 * を含む。Outputs に ExperimentTemplate ID / RoleArn / CFn コンソール用 URL を出力する。
 */
export function toCfn(
  template: FISExperimentTemplate,
  options: ToCfnOptions,
): CfnTemplate {
  const stackPrefix = options.stackPrefix ?? 'GameDay';
  const safePrefix = stackPrefix.replace(/[^A-Za-z0-9]/g, '');

  // ── Parameters ──
  const parameters: Record<string, CfnParameter> = {
    ExistingGuardrailAlarmArn: {
      Type: 'String',
      Default: '',
      Description:
        '既存のCloudWatchアラームARNを指定すると、それを停止条件として使用する。空の場合はテンプレート内で新規アラームを生成。',
    },
    ExistingFISRoleArn: {
      Type: 'String',
      Default: '',
      Description:
        '既存のFIS実行ロールARNを指定すると、それを使用する。空の場合はテンプレート内で新規生成。',
    },
  };

  // ── Resources ──
  const resources: Record<string, CfnResource> = {};

  const fisRoleLogicalId = `${safePrefix}FISRole`;
  resources[fisRoleLogicalId] = buildFISRole(stackPrefix, template.actions, template.targets);

  const guardrailLogicalId = `${safePrefix}GuardrailAlarm`;
  resources[guardrailLogicalId] = buildGuardrailAlarm(stackPrefix);

  // ── Targets / Actions の変換 ──
  const cfnTargets: Record<string, Record<string, unknown>> = {};
  for (const [key, target] of Object.entries(template.targets)) {
    cfnTargets[key] = targetToCfn(target);
  }

  const cfnActions: Record<string, Record<string, unknown>> = {};
  for (const [key, action] of Object.entries(template.actions)) {
    cfnActions[key] = actionToCfn(action);
  }

  // ── StopConditions: 既存ARNがあればそれ、なければ生成したアラームの ARN を Ref ──
  // CFn では条件分岐に Conditions を使う。
  const stopConditions = template.stopConditions.map(sc => {
    if (sc.value && sc.value.includes('FISExperimentGuardrail')) {
      // プレースホルダーARNだった場合はテンプレ内アラームに差し替え
      return {
        Source: 'aws:cloudwatch:alarm',
        Value: {
          'Fn::If': [
            'UseGeneratedGuardrail',
            { 'Fn::GetAtt': [guardrailLogicalId, 'Arn'] },
            { Ref: 'ExistingGuardrailAlarmArn' },
          ],
        },
      };
    }
    if (sc.source === 'none') {
      return { Source: 'none' };
    }
    return { Source: sc.source, ...(sc.value ? { Value: sc.value } : {}) };
  });

  const fisTemplateLogicalId = `${safePrefix}ExperimentTemplate`;
  resources[fisTemplateLogicalId] = {
    Type: 'AWS::FIS::ExperimentTemplate',
    Properties: {
      Description: template.description,
      RoleArn: {
        'Fn::If': [
          'UseGeneratedRole',
          { 'Fn::GetAtt': [fisRoleLogicalId, 'Arn'] },
          { Ref: 'ExistingFISRoleArn' },
        ],
      },
      StopConditions: stopConditions,
      Targets: cfnTargets,
      Actions: cfnActions,
      Tags: {
        ...template.tags,
        'gameday:scenario-id': options.scenarioId,
        'gameday:source': 'gameday-plan-generator',
      },
    },
    DependsOn: [fisRoleLogicalId, guardrailLogicalId],
  };

  // ── Outputs ──
  const outputs: Record<string, CfnOutput> = {
    ExperimentTemplateId: {
      Description: 'FIS実験テンプレートID。`aws fis start-experiment` で使用',
      Value: { Ref: fisTemplateLogicalId },
    },
    StartExperimentCommand: {
      Description: '実験を開始するAWS CLIコマンド',
      Value: {
        'Fn::Sub': `aws fis start-experiment --experiment-template-id \${${fisTemplateLogicalId}} --region \${AWS::Region}`,
      },
    },
    FISRoleArn: {
      Description: 'FIS実験ロールARN',
      Value: {
        'Fn::If': [
          'UseGeneratedRole',
          { 'Fn::GetAtt': [fisRoleLogicalId, 'Arn'] },
          { Ref: 'ExistingFISRoleArn' },
        ],
      },
    },
  };

  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: `GameDay FIS Experiment: ${options.scenarioName ?? options.scenarioId}`,
    Parameters: parameters,
    Resources: resources,
    Outputs: outputs,
    // Conditions は CfnTemplate 型に明示してないので拡張して付与
    ...({
      Conditions: {
        UseGeneratedGuardrail: {
          'Fn::Equals': [{ Ref: 'ExistingGuardrailAlarmArn' }, ''],
        },
        UseGeneratedRole: {
          'Fn::Equals': [{ Ref: 'ExistingFISRoleArn' }, ''],
        },
      },
    } as Record<string, unknown>),
  };
}

// ============================================================
// CFn コンソール ディープリンク
// ============================================================

export interface DeepLinkOptions {
  /** S3 にアップロードしたテンプレートの公開URL。指定があればこちらを優先 */
  templateUrl?: string;
  /** スタック名 (デフォルト: scenarioIdから生成) */
  stackName?: string;
  /** リージョン (デフォルト: ap-northeast-1) */
  region?: string;
  /** scenarioId (stackName 自動生成用) */
  scenarioId: string;
}

/**
 * CFn コンソールの `quickcreate` URL を生成。
 * `templateUrl` が指定されていれば、その S3 URL からテンプレートを読み込んで
 * 即スタック作成画面を開く。
 *
 * https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/cfn-console-create-stack-parameters.html
 */
export function buildConsoleDeepLink(options: DeepLinkOptions): string {
  const region = options.region ?? 'ap-northeast-1';
  const stackName =
    options.stackName ??
    `gameday-fis-${options.scenarioId}`.replace(/[^A-Za-z0-9-]/g, '-').slice(0, 64);

  const params = new URLSearchParams({
    stackName,
  });
  if (options.templateUrl) {
    params.set('templateURL', options.templateUrl);
  }

  return `https://${region}.console.aws.amazon.com/cloudformation/home?region=${region}#/stacks/quickcreate?${params.toString()}`;
}

// ============================================================
// AWS CLI deploy コマンド生成
// ============================================================

/**
 * `aws cloudformation deploy` コマンドを生成。
 * ユーザーがコピペで実行できるように、絶対パスではなく相対パス前提。
 */
export function buildDeployCommand(options: {
  templateFile: string;
  scenarioId: string;
  region?: string;
}): string {
  const region = options.region ?? 'ap-northeast-1';
  const stackName = `gameday-fis-${options.scenarioId}`
    .replace(/[^A-Za-z0-9-]/g, '-')
    .slice(0, 64);

  return [
    'aws cloudformation deploy',
    `  --template-file ${options.templateFile}`,
    `  --stack-name ${stackName}`,
    '  --capabilities CAPABILITY_NAMED_IAM',
    `  --region ${region}`,
  ].join(' \\\n');
}
