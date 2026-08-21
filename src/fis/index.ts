/**
 * FISテンプレートビルダー
 *
 * 障害シナリオからAWS FIS実験テンプレートを生成する。
 * FIS未サポートリソースに対しては代替手段を提案する。
 */

import type {
  FailureScenario,
  FISExperimentTemplate,
  FISTarget,
  FISAction,
  FISStopCondition,
  InfraConfig,
  Result,
} from '../types/index.js';
import {
  isFISSupported,
  getActionsForResource,
  getUnsupportedInfo,
  type FISActionMapping,
} from './actions.js';
import { validateFISTemplate, type ValidationResult } from './validator.js';

export type { ValidationResult } from './validator.js';
export {
  toCfn,
  buildConsoleDeepLink,
  buildDeployCommand,
  type CfnTemplate,
  type ToCfnOptions,
  type DeepLinkOptions,
} from './cfn-builder.js';

export interface FISBuildError {
  scenarioId: string;
  reason: string;
  alternatives?: string[];
}

/** デフォルトのIAMロールARN（プレースホルダー） */
const DEFAULT_ROLE_ARN = 'arn:aws:iam::ACCOUNT_ID:role/FISExperimentRole';

/** デフォルトの停止条件 */
const DEFAULT_STOP_CONDITION: FISStopCondition = {
  source: 'aws:cloudwatch:alarm',
  value: 'arn:aws:cloudwatch:REGION:ACCOUNT_ID:alarm:FISExperimentGuardrail',
};

/**
 * `AWS::Foo::Bar` 形式のリソースタイプを、FIS でサポートする
 * 共通リソースタイプに正規化する（既知のものだけ）。
 */
function normalizeResourceType(awsType: string): string | undefined {
  const map: Record<string, string> = {
    'AWS::EC2::Instance': 'AWS::EC2::Instance',
    'AWS::RDS::DBInstance': 'AWS::RDS::DBInstance',
    'AWS::RDS::DBCluster': 'AWS::RDS::DBInstance', // 近似
    'AWS::ECS::Service': 'AWS::ECS::Service',
    'AWS::ECS::TaskDefinition': 'AWS::ECS::Service',
    'AWS::ECS::Cluster': 'AWS::ECS::Service',
    'AWS::Lambda::Function': 'AWS::Lambda::Function',
    'AWS::ElasticLoadBalancingV2::LoadBalancer': 'AWS::ElasticLoadBalancingV2::LoadBalancer',
    'AWS::DynamoDB::Table': 'AWS::DynamoDB::Table',
    'AWS::S3::Bucket': 'AWS::S3::Bucket',
    'AWS::SNS::Topic': 'AWS::SNS::Topic',
    'AWS::SQS::Queue': 'AWS::SQS::Queue',
    'AWS::CloudFront::Distribution': 'AWS::CloudFront::Distribution',
  };
  return map[awsType];
}

/**
 * シナリオのステップからリソースタイプを推定する
 * 優先順位:
 *   1. config が与えられた場合は、affectedResources/step.target を Logical ID とみなして
 *      `InfraConfig.resources[].type` を直接引く（最も確実）
 *   2. 文字列パターンマッチ (EC2/RDS/ECS 等のキーワードを target/affectedResources に含む)
 */
function inferResourceType(scenario: FailureScenario, config?: InfraConfig): string | undefined {
  // ── 1. Logical ID 解決 ──
  if (config) {
    const idToType = new Map(config.resources.map(r => [r.logicalId, r.type]));
    const candidateIds = [
      ...scenario.steps.map(s => s.target),
      ...scenario.affectedResources,
    ];
    for (const id of candidateIds) {
      const awsType = idToType.get(id);
      if (awsType) {
        const normalized = normalizeResourceType(awsType);
        if (normalized) return normalized;
      }
    }
  }

  // ── 2. ステップのターゲット名から文字列マッチで推定 ──
  // 注意: より具体的なパターンを先にチェックする（例: RDS > EC2）
  for (const step of scenario.steps) {
    if (step.target.includes('RDS') || step.target.includes('DBInstance') || step.target.includes('DB Instance')) {
      return 'AWS::RDS::DBInstance';
    }
    if (step.target.includes('EC2') || step.target.includes('Instance')) {
      return 'AWS::EC2::Instance';
    }
    if (step.target.includes('ECS') || step.target.includes('Task') || step.target.includes('Service')) {
      return 'AWS::ECS::Service';
    }
    if (step.target.includes('Lambda') || step.target.includes('Function')) {
      return 'AWS::Lambda::Function';
    }
    if (step.target.includes('ELB') || step.target.includes('LoadBalancer') || step.target.includes('ALB')) {
      return 'AWS::ElasticLoadBalancingV2::LoadBalancer';
    }
    if (step.target.includes('DynamoDB') || step.target.includes('Table')) {
      return 'AWS::DynamoDB::Table';
    }
    if (step.target.includes('S3') || step.target.includes('Bucket')) {
      return 'AWS::S3::Bucket';
    }
    if (step.target.includes('SNS') || step.target.includes('Topic')) {
      return 'AWS::SNS::Topic';
    }
    if (step.target.includes('SQS') || step.target.includes('Queue')) {
      return 'AWS::SQS::Queue';
    }
    if (step.target.includes('CloudFront') || step.target.includes('Distribution')) {
      return 'AWS::CloudFront::Distribution';
    }
  }

  // affectedResourcesからも推定を試みる
  for (const resource of scenario.affectedResources) {
    const upper = resource.toUpperCase();
    if (upper.includes('RDS') || upper.includes('DATABASE') || upper.includes('DBINSTANCE')) return 'AWS::RDS::DBInstance';
    if (upper.includes('EC2') || upper.includes('INSTANCE')) return 'AWS::EC2::Instance';
    if (upper.includes('ECS')) return 'AWS::ECS::Service';
    if (upper.includes('LAMBDA')) return 'AWS::Lambda::Function';
    if (upper.includes('ELB') || upper.includes('LOADBALANCER') || upper.includes('ALB')) return 'AWS::ElasticLoadBalancingV2::LoadBalancer';
    if (upper.includes('DYNAMODB')) return 'AWS::DynamoDB::Table';
    if (upper.includes('S3') || upper.includes('BUCKET')) return 'AWS::S3::Bucket';
    if (upper.includes('SNS')) return 'AWS::SNS::Topic';
    if (upper.includes('SQS')) return 'AWS::SQS::Queue';
    if (upper.includes('CLOUDFRONT')) return 'AWS::CloudFront::Distribution';
  }

  return undefined;
}

/**
 * FISターゲットを構築する
 */
function buildTarget(resourceType: string, scenario: FailureScenario): FISTarget {
  return {
    resourceType: resourceType.replace('AWS::', 'aws:').replace(/::/g, ':').toLowerCase(),
    resourceTags: {
      'gameday:scenario': scenario.id,
    },
    selectionMode: 'ALL',
  };
}

/**
 * FISアクションを構築する
 */
function buildAction(
  mapping: FISActionMapping,
  targetKey: string,
): FISAction {
  const action: FISAction = {
    actionId: mapping.actionId,
    description: mapping.description,
    targets: { target: targetKey },
  };

  if (mapping.defaultParameters) {
    action.parameters = { ...mapping.defaultParameters };
  }

  if (mapping.defaultDuration) {
    action.duration = mapping.defaultDuration;
  }

  return action;
}

/**
 * 障害シナリオからFIS実験テンプレートを生成する
 *
 * @param scenario - 障害シナリオ
 * @returns FIS実験テンプレートまたはビルドエラー
 */
export function build(
  scenario: FailureScenario,
  config?: InfraConfig,
): Result<FISExperimentTemplate, FISBuildError> {
  // リソースタイプを推定
  const resourceType = inferResourceType(scenario, config);

  if (!resourceType) {
    return {
      ok: false,
      error: {
        scenarioId: scenario.id,
        reason: `シナリオ "${scenario.name}" からリソースタイプを特定できませんでした`,
        alternatives: ['シナリオのステップにリソースタイプ情報を追加してください'],
      },
    };
  }

  // FISサポート確認
  if (!isFISSupported(resourceType)) {
    const unsupportedInfo = getUnsupportedInfo(resourceType);
    return {
      ok: false,
      error: {
        scenarioId: scenario.id,
        reason: unsupportedInfo?.reason ?? `リソースタイプ ${resourceType} はAWS FISでサポートされていません`,
        alternatives: unsupportedInfo?.alternatives ?? [],
      },
    };
  }

  // アクションマッピングを取得
  const actionMappings = getActionsForResource(resourceType);
  if (!actionMappings || actionMappings.length === 0) {
    return {
      ok: false,
      error: {
        scenarioId: scenario.id,
        reason: `リソースタイプ ${resourceType} に対応するFISアクションが定義されていません`,
      },
    };
  }

  // 最初のアクションをデフォルトとして使用
  const primaryMapping = actionMappings[0];
  const targetKey = `target-${scenario.id}`;

  // ターゲット構築
  const target = buildTarget(resourceType, scenario);

  // アクション構築
  const action = buildAction(primaryMapping, targetKey);

  // テンプレート組み立て
  const template: FISExperimentTemplate = {
    description: `GameDay実験: ${scenario.name} - ${scenario.description}`,
    targets: {
      [targetKey]: target,
    },
    actions: {
      [`action-${scenario.id}`]: action,
    },
    stopConditions: [{ ...DEFAULT_STOP_CONDITION }],
    roleArn: DEFAULT_ROLE_ARN,
    tags: {
      'gameday:scenario-id': scenario.id,
      'gameday:category': scenario.category,
      'gameday:severity': scenario.severity,
    },
  };

  return { ok: true, value: template };
}

/**
 * FIS実験テンプレートをバリデーションする
 *
 * @param template - FIS実験テンプレート
 * @returns バリデーション結果
 */
export function validate(template: FISExperimentTemplate): ValidationResult {
  return validateFISTemplate(template);
}
