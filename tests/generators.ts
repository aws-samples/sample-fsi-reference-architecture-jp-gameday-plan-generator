// fast-check Arbitrary generators for property-based testing
import fc from 'fast-check';
import type {
  InputFormat,
  EncryptionConfig,
  AWSResource,
  ResourceDependency,
  ConfigMetadata,
  InfraConfig,
  ScenarioCategory,
  ScenarioStep,
  FailureScenario,
  FISTargetFilter,
  FISTarget,
  FISAction,
  FISStopCondition,
  FISExperimentTemplate,
  PlanOptions,
  PlannedScenario,
  RoleAssignment,
  TimelineEntry,
  EscalationStep,
  GameDayPlan,
  CloudWatchConfig,
  ObservationPoint,
  EvaluationCriteria,
  CriteriaResult,
  ScenarioScore,
  GameDayResult,
  DashboardData,
} from '../src/types/index.js';

// ============================================================
// 定数定義
// ============================================================

const AWS_RESOURCE_TYPES = [
  'AWS::EC2::Instance',
  'AWS::RDS::DBInstance',
  'AWS::S3::Bucket',
  'AWS::Lambda::Function',
  'AWS::ECS::Service',
  'AWS::ElasticLoadBalancingV2::LoadBalancer',
  'AWS::DynamoDB::Table',
  'AWS::SQS::Queue',
  'AWS::SNS::Topic',
  'AWS::CloudFront::Distribution',
] as const;

const AWS_REGIONS = [
  'us-east-1',
  'us-west-2',
  'eu-west-1',
  'eu-central-1',
  'ap-northeast-1',
  'ap-southeast-1',
  'ap-southeast-2',
] as const;

const INPUT_FORMATS: InputFormat[] = [
  'cdk-typescript',
  'cdk-python',
  'cfn-json',
  'cfn-yaml',
];

const SCENARIO_CATEGORIES: ScenarioCategory[] = [
  'infrastructure',
  'network',
  'data',
  'security',
  'operation',
];

const SEVERITY_LEVELS = ['Critical', 'High', 'Medium', 'Low'] as const;

const ENCRYPTION_ALGORITHMS = ['AES-256', 'AES-128', 'aws:kms', 'RSA-2048'] as const;

// ============================================================
// 基本ジェネレータ
// ============================================================

/** 非空の英数字ID */
const idArb = fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9-]{2,20}$/);

/** AWSリージョン */
const regionArb = fc.constantFrom(...AWS_REGIONS);

/** AWSリソースタイプ */
const resourceTypeArb = fc.constantFrom(...AWS_RESOURCE_TYPES);

/** InputFormat */
const inputFormatArb: fc.Arbitrary<InputFormat> = fc.constantFrom(...INPUT_FORMATS);

/** ScenarioCategory */
const scenarioCategoryArb: fc.Arbitrary<ScenarioCategory> = fc.constantFrom(...SCENARIO_CATEGORIES);

/** Severity */
const severityArb = fc.constantFrom(...SEVERITY_LEVELS);

/** ISO 8601 日時文字列 */
const isoDateArb = fc.date({
  min: new Date('2024-01-01'),
  max: new Date('2025-12-31'),
}).map((d) => d.toISOString());

/** HH:mm 形式の時刻 */
const timeArb = fc.tuple(
  fc.integer({ min: 0, max: 23 }),
  fc.integer({ min: 0, max: 59 }),
).map(([h, m]) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);

/** 非空文字列 */
const nonEmptyStringArb = fc.stringMatching(/^[a-zA-Z0-9 _-]{1,50}$/);

/** タグ用 Record<string, string> */
const tagsArb = fc.dictionary(
  fc.stringMatching(/^[A-Za-z]{1,10}$/),
  fc.stringMatching(/^[A-Za-z0-9-]{1,20}$/),
  { minKeys: 0, maxKeys: 3 },
);

/** プロパティ用 Record<string, unknown> */
const propertiesArb = fc.dictionary(
  fc.stringMatching(/^[A-Za-z]{1,15}$/),
  fc.oneof(fc.string(), fc.integer(), fc.boolean()),
  { minKeys: 0, maxKeys: 5 },
);

// ============================================================
// EncryptionConfig
// ============================================================

const encryptionConfigArb: fc.Arbitrary<EncryptionConfig> = fc.record({
  enabled: fc.boolean(),
  algorithm: fc.option(fc.constantFrom(...ENCRYPTION_ALGORITHMS), { nil: undefined }),
  kmsKeyId: fc.option(
    fc.stringMatching(/^[a-f0-9-]{8,36}$/).map((s) => `key-${s}`),
    { nil: undefined },
  ),
});

// ============================================================
// AWSResource
// ============================================================

export const awsResourceArb: fc.Arbitrary<AWSResource> = fc.record({
  logicalId: idArb,
  type: resourceTypeArb,
  properties: propertiesArb,
  region: regionArb,
  tags: fc.option(tagsArb, { nil: undefined }),
  encryption: fc.option(encryptionConfigArb, { nil: undefined }),
});

// ============================================================
// ResourceDependency
// ============================================================

const resourceDependencyArb: fc.Arbitrary<ResourceDependency> = fc.record({
  source: idArb,
  target: idArb,
  type: fc.constantFrom('hard' as const, 'soft' as const),
});

// ============================================================
// ConfigMetadata
// ============================================================

const configMetadataArb = (opts: {
  resourceCount: number;
  isMultiRegion: boolean;
  hasEncryption: boolean;
  hasXRayTracing: boolean;
}): fc.Arbitrary<ConfigMetadata> =>
  fc.record({
    parsedAt: isoDateArb,
    sourceFile: nonEmptyStringArb.map((s) => `${s}.json`),
    resourceCount: fc.constant(opts.resourceCount),
    isMultiRegion: fc.constant(opts.isMultiRegion),
    hasEncryption: fc.constant(opts.hasEncryption),
    hasXRayTracing: fc.constant(opts.hasXRayTracing),
  });

// ============================================================
// InfraConfig
// ============================================================

export const infraConfigArb: fc.Arbitrary<InfraConfig> = fc
  .tuple(
    idArb,
    nonEmptyStringArb,
    inputFormatArb,
    fc.array(regionArb, { minLength: 1, maxLength: 4 }),
    fc.array(awsResourceArb, { minLength: 0, maxLength: 8 }),
    fc.array(resourceDependencyArb, { minLength: 0, maxLength: 5 }),
    fc.boolean(), // hasXRayTracing
  )
  .map(([id, name, sourceFormat, regions, resources, dependencies, hasXRayTracing]) => {
    const uniqueRegions = [...new Set(regions)];
    const isMultiRegion = uniqueRegions.length > 1;
    const hasEncryption = resources.some((r) => r.encryption?.enabled === true);

    // Ensure resources use regions from the config's region list
    const fixedResources = resources.map((r, i) => ({
      ...r,
      region: uniqueRegions[i % uniqueRegions.length],
    }));

    const config: InfraConfig = {
      id,
      name,
      sourceFormat,
      regions: uniqueRegions,
      resources: fixedResources,
      dependencies,
      metadata: {
        parsedAt: new Date().toISOString(),
        sourceFile: `${name}.json`,
        resourceCount: fixedResources.length,
        isMultiRegion,
        hasEncryption,
        hasXRayTracing,
      },
    };
    return config;
  });

// ============================================================
// ScenarioStep
// ============================================================

const scenarioStepArb: fc.Arbitrary<ScenarioStep> = fc.record({
  order: fc.integer({ min: 1, max: 20 }),
  action: nonEmptyStringArb,
  target: idArb,
  parameters: fc.option(propertiesArb, { nil: undefined }),
});

// ============================================================
// FailureScenario
// ============================================================

export const failureScenarioArb: fc.Arbitrary<FailureScenario> = fc.record({
  id: idArb,
  name: nonEmptyStringArb,
  category: scenarioCategoryArb,
  severity: severityArb,
  description: nonEmptyStringArb,
  affectedResources: fc.array(idArb, { minLength: 1, maxLength: 5 }),
  impactScope: nonEmptyStringArb,
  prerequisites: fc.array(nonEmptyStringArb, { minLength: 1, maxLength: 3 }),
  steps: fc.array(scenarioStepArb, { minLength: 1, maxLength: 5 }),
  expectedOutcome: nonEmptyStringArb,
  rollbackSteps: fc.array(nonEmptyStringArb, { minLength: 1, maxLength: 3 }),
  estimatedDuration: fc.integer({ min: 5, max: 180 }),
  tags: fc.array(fc.constantFrom('pqc', 'ransomware', 'multi-region', 'failover', 'encryption'), {
    minLength: 0,
    maxLength: 3,
  }),
});

// ============================================================
// FIS関連
// ============================================================

const fisTargetFilterArb: fc.Arbitrary<FISTargetFilter> = fc.record({
  path: nonEmptyStringArb,
  values: fc.array(nonEmptyStringArb, { minLength: 1, maxLength: 3 }),
});

const fisTargetArb: fc.Arbitrary<FISTarget> = fc.record({
  resourceType: fc.constantFrom(
    'aws:ec2:instance',
    'aws:rds:db-instance',
    'aws:ecs:task',
    'aws:lambda:function',
  ),
  resourceArns: fc.option(
    fc.array(
      fc.stringMatching(/^arn:aws:[a-z0-9]+:[a-z0-9-]+:[0-9]{12}:[a-z0-9/]+$/).map(
        () => `arn:aws:ec2:us-east-1:123456789012:instance/i-abc123`,
      ),
      { minLength: 1, maxLength: 2 },
    ),
    { nil: undefined },
  ),
  resourceTags: fc.option(tagsArb, { nil: undefined }),
  filters: fc.option(fc.array(fisTargetFilterArb, { minLength: 1, maxLength: 2 }), {
    nil: undefined,
  }),
  selectionMode: fc.constantFrom('ALL' as const, 'COUNT' as const, 'PERCENT' as const),
  parameters: fc.option(
    fc.dictionary(
      fc.stringMatching(/^[a-zA-Z]{1,10}$/),
      fc.stringMatching(/^[a-zA-Z0-9]{1,10}$/),
      { minKeys: 1, maxKeys: 2 },
    ),
    { nil: undefined },
  ),
});

const fisActionArb: fc.Arbitrary<FISAction> = fc.record({
  actionId: fc.constantFrom(
    'aws:ec2:stop-instances',
    'aws:ec2:terminate-instances',
    'aws:rds:reboot-db-instances',
    'aws:ecs:stop-task',
    'aws:fis:inject-api-internal-error',
  ),
  description: fc.option(nonEmptyStringArb, { nil: undefined }),
  parameters: fc.option(
    fc.dictionary(
      fc.stringMatching(/^[a-zA-Z]{1,15}$/),
      fc.stringMatching(/^[a-zA-Z0-9]{1,15}$/),
      { minKeys: 1, maxKeys: 2 },
    ),
    { nil: undefined },
  ),
  targets: fc.option(
    fc.dictionary(
      fc.stringMatching(/^[A-Za-z]{1,10}$/),
      fc.stringMatching(/^[a-z0-9-]{1,15}$/),
      { minKeys: 1, maxKeys: 2 },
    ),
    { nil: undefined },
  ),
  startAfter: fc.option(fc.array(nonEmptyStringArb, { minLength: 1, maxLength: 2 }), {
    nil: undefined,
  }),
  duration: fc.option(fc.constantFrom('PT5M', 'PT10M', 'PT30M', 'PT1H'), { nil: undefined }),
});

const fisStopConditionArb: fc.Arbitrary<FISStopCondition> = fc.record({
  source: fc.constantFrom('aws:cloudwatch:alarm', 'none'),
  value: fc.option(
    fc.constant('arn:aws:cloudwatch:us-east-1:123456789012:alarm:stop-condition'),
    { nil: undefined },
  ),
});

export const fisTemplateArb: fc.Arbitrary<FISExperimentTemplate> = fc
  .tuple(
    nonEmptyStringArb,
    fc.dictionary(idArb, fisTargetArb, { minKeys: 1, maxKeys: 3 }),
    fc.dictionary(idArb, fisActionArb, { minKeys: 1, maxKeys: 3 }),
    fc.array(fisStopConditionArb, { minLength: 1, maxLength: 2 }),
    tagsArb,
  )
  .map(([description, targets, actions, stopConditions, tags]) => ({
    description,
    targets,
    actions,
    stopConditions,
    roleArn: `arn:aws:iam::123456789012:role/FISExperimentRole`,
    tags,
  }));

// ============================================================
// PlanOptions
// ============================================================

export const planOptionsArb: fc.Arbitrary<PlanOptions> = fc.record({
  duration: fc.constantFrom('half-day' as const, 'full-day' as const, 'two-day' as const),
  participantCount: fc.option(fc.integer({ min: 1, max: 100 }), { nil: undefined }),
  teamCount: fc.option(fc.integer({ min: 1, max: 10 }), { nil: undefined }),
});

// ============================================================
// GameDayPlan 関連
// ============================================================

const plannedScenarioArb: fc.Arbitrary<PlannedScenario> = fc.record({
  scenarioId: idArb,
  executionOrder: fc.integer({ min: 1, max: 20 }),
  startTime: timeArb,
  estimatedDuration: fc.integer({ min: 5, max: 120 }),
  assignedTeam: fc.option(nonEmptyStringArb, { nil: undefined }),
});

const roleAssignmentArb: fc.Arbitrary<RoleAssignment> = fc.record({
  role: fc.constantFrom('facilitator' as const, 'operator' as const, 'observer' as const),
  description: nonEmptyStringArb,
  responsibilities: fc.array(nonEmptyStringArb, { minLength: 1, maxLength: 3 }),
  assignedCount: fc.integer({ min: 1, max: 20 }),
});

const timelineEntryArb: fc.Arbitrary<TimelineEntry> = fc.record({
  time: timeArb,
  activity: nonEmptyStringArb,
  scenarioId: fc.option(idArb, { nil: undefined }),
  type: fc.constantFrom(
    'preparation' as const,
    'execution' as const,
    'review' as const,
    'break' as const,
  ),
});

const escalationStepArb: fc.Arbitrary<EscalationStep> = fc.record({
  condition: nonEmptyStringArb,
  action: nonEmptyStringArb,
  contactRole: nonEmptyStringArb,
});

const gameDayPlanArb: fc.Arbitrary<GameDayPlan> = fc.record({
  id: idArb,
  title: nonEmptyStringArb,
  duration: fc.constantFrom('half-day' as const, 'full-day' as const, 'two-day' as const),
  scenarios: fc.array(plannedScenarioArb, { minLength: 1, maxLength: 5 }),
  roles: fc.array(roleAssignmentArb, { minLength: 1, maxLength: 3 }),
  timeline: fc.array(timelineEntryArb, { minLength: 1, maxLength: 10 }),
  escalationFlow: fc.array(escalationStepArb, { minLength: 1, maxLength: 3 }),
});

// ============================================================
// ObservationPoint
// ============================================================

const cloudWatchConfigArb: fc.Arbitrary<CloudWatchConfig> = fc.record({
  namespace: fc.option(fc.constantFrom('AWS/EC2', 'AWS/RDS', 'AWS/Lambda', 'AWS/ECS'), {
    nil: undefined,
  }),
  metricName: fc.option(
    fc.constantFrom('CPUUtilization', 'DatabaseConnections', 'Errors', 'Duration'),
    { nil: undefined },
  ),
  dimensions: fc.option(tagsArb, { nil: undefined }),
  statistic: fc.option(fc.constantFrom('Average', 'Sum', 'Maximum', 'Minimum'), {
    nil: undefined,
  }),
  period: fc.option(fc.constantFrom(60, 300, 900), { nil: undefined }),
  alarmActions: fc.option(
    fc.array(fc.constant('arn:aws:sns:us-east-1:123456789012:alarm-topic'), {
      minLength: 1,
      maxLength: 2,
    }),
    { nil: undefined },
  ),
  logGroupName: fc.option(nonEmptyStringArb.map((s) => `/aws/lambda/${s}`), { nil: undefined }),
  filterPattern: fc.option(fc.constantFrom('ERROR', 'WARN', 'Exception'), { nil: undefined }),
});

const observationPointArb: fc.Arbitrary<ObservationPoint> = fc.record({
  id: idArb,
  scenarioId: idArb,
  type: fc.constantFrom(
    'metric' as const,
    'alarm' as const,
    'log-filter' as const,
    'xray-trace' as const,
  ),
  name: nonEmptyStringArb,
  description: nonEmptyStringArb,
  normalRange: fc.record({
    min: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: undefined }),
    max: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: undefined }),
  }),
  threshold: fc.double({ min: 0, max: 1000, noNaN: true }),
  checkTiming: fc.constantFrom('before' as const, 'during' as const, 'after' as const),
  cloudwatchConfig: cloudWatchConfigArb,
});

// ============================================================
// EvaluationCriteria
// ============================================================

const evaluationCriteriaArb: fc.Arbitrary<EvaluationCriteria> = fc
  .tuple(
    idArb,
    idArb,
    nonEmptyStringArb,
    fc.constantFrom(
      'detection-time' as const,
      'recovery-time' as const,
      'impact-accuracy' as const,
      'communication' as const,
    ),
    fc.integer({ min: 1, max: 60 }),
  )
  .map(([id, scenarioId, name, type, targetValue]) => ({
    id,
    scenarioId,
    name,
    type,
    targetValue,
    unit: type === 'impact-accuracy' || type === 'communication' ? 'percent' : 'minutes',
    passThreshold: targetValue,
    failThreshold: targetValue * 2,
  }));

// ============================================================
// GameDayResult
// ============================================================

const criteriaResultArb: fc.Arbitrary<CriteriaResult> = fc.record({
  criteriaId: idArb,
  actualValue: fc.double({ min: 0, max: 120, noNaN: true }),
  passed: fc.boolean(),
  comment: fc.option(nonEmptyStringArb, { nil: undefined }),
});

const scenarioScoreArb: fc.Arbitrary<ScenarioScore> = fc.record({
  scenarioId: idArb,
  criteriaResults: fc.array(criteriaResultArb, { minLength: 1, maxLength: 4 }),
  passed: fc.boolean(),
});

const gameDayResultArb: fc.Arbitrary<GameDayResult> = fc.record({
  planId: idArb,
  executedAt: isoDateArb,
  scenarioResults: fc.array(scenarioScoreArb, { minLength: 1, maxLength: 5 }),
  overallScore: fc.double({ min: 0, max: 100, noNaN: true }),
});

// ============================================================
// DashboardData
// ============================================================

export const dashboardDataArb: fc.Arbitrary<DashboardData> = fc
  .tuple(
    gameDayPlanArb,
    fc.array(failureScenarioArb, { minLength: 1, maxLength: 5 }),
    fc.array(observationPointArb, { minLength: 1, maxLength: 5 }),
    fc.array(evaluationCriteriaArb, { minLength: 1, maxLength: 5 }),
    fc.option(fc.array(gameDayResultArb, { minLength: 1, maxLength: 3 }), { nil: undefined }),
  )
  .map(([plan, scenarios, observations, evaluations, pastResults]) => ({
    plan,
    scenarios,
    observations,
    evaluations,
    pastResults,
  }));

// ============================================================
// 不正入力文字列
// ============================================================

export const invalidInputArb: fc.Arbitrary<string> = fc.oneof(
  // ランダム文字列
  fc.string({ minLength: 1, maxLength: 200 }),
  // 部分的に有効なJSON
  fc.constant('{'),
  fc.constant('{"Resources": }'),
  fc.constant('{"Resources": {"MyEC2": {"Type": }}}'),
  // 部分的に有効なYAML
  fc.constant('Resources:\n  MyEC2:\n    Type:'),
  fc.constant('---\nResources: [invalid'),
  // 空白・特殊文字
  fc.constant(''),
  fc.constant('   '),
  fc.constant('\n\n\n'),
  fc.constant('<html>not a template</html>'),
  fc.constant('SELECT * FROM resources'),
);
