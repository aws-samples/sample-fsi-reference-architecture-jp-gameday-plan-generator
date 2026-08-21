import type { InfraConfig, FailureScenario } from '../types/index.js';
import { generateInfrastructureScenarios, resetInfrastructureCounter } from './categories/infrastructure.js';
import { generateNetworkScenarios, resetNetworkCounter } from './categories/network.js';
import { generateDataScenarios, resetDataCounter } from './categories/data.js';
import { generateSecurityScenarios, resetSecurityCounter } from './categories/security.js';
import { generateOperationScenarios, resetOperationCounter } from './categories/operation.js';
import { multiRegionEnricher, resetMultiRegionCounter } from './enrichers/multi-region.js';
import { pqcEnricher, resetPqcCounter } from './enrichers/pqc.js';
import { isFISSupported, getUnsupportedInfo } from '../fis/actions.js';

/**
 * リソースタイプからカテゴリジェネレータへのマッピング
 * 各リソースタイプがどのカテゴリのシナリオ生成に関連するかを定義
 */
const RESOURCE_TYPE_CATEGORY_MAP: Record<string, string[]> = {
  'AWS::EC2::Instance': ['infrastructure', 'operation'],
  'AWS::RDS::DBInstance': ['data', 'infrastructure'],
  'AWS::S3::Bucket': ['data', 'security'],
  'AWS::Lambda::Function': ['infrastructure', 'operation'],
  'AWS::ECS::Service': ['infrastructure', 'operation'],
  'AWS::ElasticLoadBalancingV2::LoadBalancer': ['network'],
  'AWS::DynamoDB::Table': ['data'],
  'AWS::SQS::Queue': ['network'],
  'AWS::SNS::Topic': ['network'],
  'AWS::CloudFront::Distribution': ['network'],
};

/** カテゴリ名からジェネレータ関数へのマッピング */
const CATEGORY_GENERATORS: Record<string, (config: InfraConfig) => FailureScenario[]> = {
  infrastructure: generateInfrastructureScenarios,
  network: generateNetworkScenarios,
  data: generateDataScenarios,
  security: generateSecurityScenarios,
  operation: generateOperationScenarios,
};

/** エンリッチャー一覧 */
const ENRICHERS = [multiRegionEnricher, pqcEnricher];

/**
 * 全カウンターをリセット（テスト用）
 */
export function resetAllCounters(): void {
  resetInfrastructureCounter();
  resetNetworkCounter();
  resetDataCounter();
  resetSecurityCounter();
  resetOperationCounter();
  resetMultiRegionCounter();
  resetPqcCounter();
}

/**
 * 構成情報に含まれるリソースタイプから、実行すべきカテゴリを特定する
 */
function getApplicableCategories(config: InfraConfig): Set<string> {
  const categories = new Set<string>();
  for (const resource of config.resources) {
    const mapped = RESOURCE_TYPE_CATEGORY_MAP[resource.type];
    if (mapped) {
      for (const cat of mapped) {
        categories.add(cat);
      }
    }
  }
  return categories;
}

/**
 * シナリオエンジン: 構成情報から障害シナリオを生成する
 *
 * 1. 構成情報のリソースタイプに基づき、該当するカテゴリのジェネレータのみを実行
 * 2. 全カテゴリのシナリオを集約
 * 3. エンリッチャーを適用（マルチリージョン、PQC）
 */
export function generateScenarios(config: InfraConfig): FailureScenario[] {
  // カウンターをリセットして一意なIDを保証
  resetAllCounters();

  // 該当カテゴリを特定
  const applicableCategories = getApplicableCategories(config);

  // カテゴリ別にシナリオを生成
  let scenarios: FailureScenario[] = [];
  for (const category of applicableCategories) {
    const generator = CATEGORY_GENERATORS[category];
    if (generator) {
      const categoryScenarios = generator(config);
      scenarios = [...scenarios, ...categoryScenarios];
    }
  }

  // エンリッチャーを適用
  for (const enricher of ENRICHERS) {
    scenarios = enricher.enrich(config, scenarios);
  }

  // 各シナリオに executability を付与（既に付いていればそのまま）
  scenarios = scenarios.map(s => annotateExecutability(s, config));

  return scenarios;
}

/**
 * シナリオに「FIS で再現できるか」を判定して executability を付ける。
 * 影響リソースの最初の logicalId から型を引き、FIS supported / unsupported を見る。
 * 該当リソースが見つからない・型が判定できない場合は元のシナリオを返す。
 */
function annotateExecutability(
  scenario: FailureScenario,
  config: InfraConfig,
): FailureScenario {
  if (scenario.executability) return scenario;
  const firstResId = scenario.affectedResources[0];
  if (!firstResId) return scenario;
  const resource = config.resources.find(r => r.logicalId === firstResId);
  if (!resource) return scenario;

  if (isFISSupported(resource.type)) {
    return { ...scenario, executability: 'fis-supported' };
  }
  const info = getUnsupportedInfo(resource.type);
  if (info) {
    return {
      ...scenario,
      executability: 'fis-alternative',
      alternativeApproach: scenario.alternativeApproach
        ?? `${info.reason}。代替手段: ${info.alternatives.slice(0, 2).join(' / ')}`,
    };
  }
  return scenario;
}
