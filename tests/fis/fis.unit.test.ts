import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { build, validate } from '../../src/fis/index.js';
import {
  FISExperimentTemplateSchema,
  type FailureScenario,
  type FISExperimentTemplate,
} from '../../src/types/index.js';
import { fisTemplateArb } from '../generators.js';

// ============================================================
// テストヘルパー: シナリオビルダー
// ============================================================

function makeScenario(
  id: string,
  opts: Partial<FailureScenario> = {},
): FailureScenario {
  return {
    id,
    name: opts.name ?? `Scenario ${id}`,
    category: opts.category ?? 'infrastructure',
    severity: opts.severity ?? 'High',
    description: opts.description ?? `desc for ${id}`,
    affectedResources: opts.affectedResources ?? [`res-${id}`],
    impactScope: opts.impactScope ?? 'local',
    prerequisites: opts.prerequisites ?? ['prereq'],
    steps: opts.steps ?? [{ order: 1, action: 'execute', target: 'EC2Instance' }],
    expectedOutcome: opts.expectedOutcome ?? 'recovered',
    rollbackSteps: opts.rollbackSteps ?? ['rollback'],
    estimatedDuration: opts.estimatedDuration ?? 30,
    tags: opts.tags ?? [],
  };
}

// ============================================================
// FIS サポートリソースの正常系
// ============================================================

describe('fis.build: サポートリソース', () => {
  it('EC2シナリオから有効なFISテンプレートが生成される', () => {
    const scenario = makeScenario('ec2-stop', {
      name: 'EC2 Stop',
      steps: [{ order: 1, action: 'Stop', target: 'EC2Instance' }],
    });
    const result = build(scenario);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const template = result.value;
    expect(template.description).toContain('EC2 Stop');
    expect(Object.keys(template.targets).length).toBeGreaterThan(0);
    expect(Object.keys(template.actions).length).toBeGreaterThan(0);
    expect(template.stopConditions.length).toBeGreaterThanOrEqual(1);
  });

  it('RDSシナリオから有効なFISテンプレートが生成される', () => {
    const scenario = makeScenario('rds-fo', {
      name: 'RDS Failover',
      category: 'data',
      steps: [{ order: 1, action: 'Reboot', target: 'RDSDBInstance' }],
    });
    const result = build(scenario);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const action = Object.values(result.value.actions)[0];
    expect(action.actionId).toContain('aws:rds');
  });

  it('ECSシナリオから有効なFISテンプレートが生成される', () => {
    const scenario = makeScenario('ecs-stop', {
      steps: [{ order: 1, action: 'Stop', target: 'ECSTask' }],
    });
    const result = build(scenario);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const action = Object.values(result.value.actions)[0];
    expect(action.actionId).toContain('aws:ecs');
  });

  it('Lambdaシナリオから有効なFISテンプレートが生成される', () => {
    const scenario = makeScenario('lambda-err', {
      steps: [{ order: 1, action: 'Inject', target: 'LambdaFunction' }],
    });
    const result = build(scenario);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const action = Object.values(result.value.actions)[0];
    expect(action.actionId).toContain('aws:fis:inject');
  });
});

// ============================================================
// Zodスキーマ / validate() 準拠
// ============================================================

describe('fis.build: スキーマとvalidate()', () => {
  it('生成されたテンプレートがFISExperimentTemplateSchemaに準拠', () => {
    const scenarios: FailureScenario[] = [
      makeScenario('ec2', { steps: [{ order: 1, action: 'S', target: 'EC2Instance' }] }),
      makeScenario('rds', { steps: [{ order: 1, action: 'S', target: 'RDSDBInstance' }] }),
      makeScenario('lam', { steps: [{ order: 1, action: 'S', target: 'LambdaFunction' }] }),
      makeScenario('ecs', { steps: [{ order: 1, action: 'S', target: 'ECSService' }] }),
    ];

    for (const scenario of scenarios) {
      const result = build(scenario);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const schemaResult = FISExperimentTemplateSchema.safeParse(result.value);
      expect(schemaResult.success).toBe(true);
    }
  });

  it('生成されたテンプレートがvalidate()を通過する', () => {
    const scenarios: FailureScenario[] = [
      makeScenario('ec2', { steps: [{ order: 1, action: 'S', target: 'EC2Instance' }] }),
      makeScenario('rds', { steps: [{ order: 1, action: 'S', target: 'RDSDBInstance' }] }),
      makeScenario('lam', { steps: [{ order: 1, action: 'S', target: 'LambdaFunction' }] }),
    ];

    for (const scenario of scenarios) {
      const result = build(scenario);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const validation = validate(result.value);
      expect(validation.valid).toBe(true);
      expect(validation.errors).toEqual([]);
    }
  });
});

// ============================================================
// FIS形式の厳密な検証
// ============================================================

describe('fis.build: AWS FIS形式の厳密な検証', () => {
  it('ターゲットのresourceTypeはaws:形式（AWS::ではない）', () => {
    const scenario = makeScenario('ec2', {
      steps: [{ order: 1, action: 'S', target: 'EC2Instance' }],
    });
    const result = build(scenario);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const target of Object.values(result.value.targets)) {
      expect(target.resourceType).toMatch(/^aws:/);
      expect(target.resourceType).not.toContain('AWS::');
      expect(target.resourceType).toBe(target.resourceType.toLowerCase());
    }
  });

  it('EC2ターゲットのresourceTypeはaws:ec2:instance', () => {
    const scenario = makeScenario('ec2', {
      steps: [{ order: 1, action: 'S', target: 'EC2Instance' }],
    });
    const result = build(scenario);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const target = Object.values(result.value.targets)[0];
    expect(target.resourceType).toBe('aws:ec2:instance');
  });

  it('RDSターゲットのresourceTypeはaws:rds:dbinstance形式', () => {
    const scenario = makeScenario('rds', {
      steps: [{ order: 1, action: 'S', target: 'RDSDBInstance' }],
    });
    const result = build(scenario);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const target = Object.values(result.value.targets)[0];
    expect(target.resourceType).toMatch(/^aws:rds:/);
  });

  it('actionIdはaws:プレフィックスで始まる', () => {
    const scenario = makeScenario('ec2', {
      steps: [{ order: 1, action: 'S', target: 'EC2Instance' }],
    });
    const result = build(scenario);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const action of Object.values(result.value.actions)) {
      expect(action.actionId).toMatch(/^aws:[a-z0-9]+:/);
    }
  });

  it('roleArnはarn:aws:iam:で始まる', () => {
    const scenario = makeScenario('ec2', {
      steps: [{ order: 1, action: 'S', target: 'EC2Instance' }],
    });
    const result = build(scenario);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.roleArn).toMatch(/^arn:aws:iam:/);
  });

  it('stopConditionsが少なくとも1つ存在する', () => {
    const scenario = makeScenario('ec2', {
      steps: [{ order: 1, action: 'S', target: 'EC2Instance' }],
    });
    const result = build(scenario);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.stopConditions.length).toBeGreaterThanOrEqual(1);
    for (const sc of result.value.stopConditions) {
      expect(sc.source).toBeTruthy();
    }
  });

  it('アクションが参照するターゲットキーが実在する', () => {
    const scenario = makeScenario('ec2', {
      steps: [{ order: 1, action: 'S', target: 'EC2Instance' }],
    });
    const result = build(scenario);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const targetKeys = new Set(Object.keys(result.value.targets));
    for (const action of Object.values(result.value.actions)) {
      if (action.targets) {
        for (const ref of Object.values(action.targets)) {
          expect(targetKeys.has(ref)).toBe(true);
        }
      }
    }
  });

  it('selectionModeはALL/COUNT/PERCENTのいずれか', () => {
    const scenario = makeScenario('ec2', {
      steps: [{ order: 1, action: 'S', target: 'EC2Instance' }],
    });
    const result = build(scenario);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const target of Object.values(result.value.targets)) {
      expect(['ALL', 'COUNT', 'PERCENT']).toContain(target.selectionMode);
    }
  });
});

// ============================================================
// FIS未サポートリソース: S3, SNS, SQS, CloudFront
// ============================================================

describe('fis.build: FIS未サポートリソース', () => {
  it('S3シナリオはFISBuildErrorを返しalternativesを提供する', () => {
    const scenario = makeScenario('s3-deny', {
      steps: [{ order: 1, action: 'Deny', target: 'S3Bucket' }],
    });
    const result = build(scenario);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.scenarioId).toBe('s3-deny');
    expect(result.error.reason).toBeTruthy();
    expect(Array.isArray(result.error.alternatives)).toBe(true);
    expect(result.error.alternatives!.length).toBeGreaterThan(0);
  });

  it('SNSシナリオはFISBuildErrorを返しalternativesを提供する', () => {
    const scenario = makeScenario('sns-x', {
      steps: [{ order: 1, action: 'Block', target: 'SNSTopic' }],
    });
    const result = build(scenario);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.alternatives).toBeDefined();
    expect(result.error.alternatives!.length).toBeGreaterThan(0);
  });

  it('SQSシナリオはFISBuildErrorを返しalternativesを提供する', () => {
    const scenario = makeScenario('sqs-x', {
      steps: [{ order: 1, action: 'Block', target: 'SQSQueue' }],
    });
    const result = build(scenario);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.alternatives).toBeDefined();
    expect(result.error.alternatives!.length).toBeGreaterThan(0);
  });

  it('CloudFrontシナリオはFISBuildErrorを返しalternativesを提供する', () => {
    const scenario = makeScenario('cf-x', {
      steps: [{ order: 1, action: 'Block', target: 'CloudFrontDistribution' }],
    });
    const result = build(scenario);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.alternatives).toBeDefined();
    expect(result.error.alternatives!.length).toBeGreaterThan(0);
  });

  it('リソースタイプが特定できないシナリオはFISBuildErrorを返す', () => {
    const scenario = makeScenario('unknown', {
      steps: [{ order: 1, action: 'X', target: 'SomethingWeird' }],
      affectedResources: ['OpaqueResource'],
    });
    const result = build(scenario);
    expect(result.ok).toBe(false);
  });
});

// ============================================================
// JSON ラウンドトリップ
// ============================================================

describe('fis: JSON round-trip', () => {
  it('生成されたテンプレートがJSON.stringify → JSON.parseで等価', () => {
    const scenario = makeScenario('ec2', {
      steps: [{ order: 1, action: 'S', target: 'EC2Instance' }],
    });
    const result = build(scenario);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const original = result.value;
    const roundTripped = JSON.parse(JSON.stringify(original)) as FISExperimentTemplate;
    expect(roundTripped).toEqual(original);

    // round-trip後もスキーマに適合する
    const schemaResult = FISExperimentTemplateSchema.safeParse(roundTripped);
    expect(schemaResult.success).toBe(true);
  });
});

// ============================================================
// validate(): 異常系
// ============================================================

describe('fis.validate: 異常系', () => {
  it('targetsが空だとエラー', () => {
    const invalid: FISExperimentTemplate = {
      description: 'test',
      targets: {},
      actions: { a: { actionId: 'aws:ec2:stop-instances' } },
      stopConditions: [{ source: 'none' }],
      roleArn: 'arn:aws:iam::123456789012:role/FIS',
      tags: {},
    };
    const v = validate(invalid);
    expect(v.valid).toBe(false);
    expect(v.errors.some((e) => e.toLowerCase().includes('target'))).toBe(true);
  });

  it('actionsが空だとエラー', () => {
    const invalid: FISExperimentTemplate = {
      description: 'test',
      targets: { t: { resourceType: 'aws:ec2:instance', selectionMode: 'ALL' } },
      actions: {},
      stopConditions: [{ source: 'none' }],
      roleArn: 'arn:aws:iam::123456789012:role/FIS',
      tags: {},
    };
    const v = validate(invalid);
    expect(v.valid).toBe(false);
    expect(v.errors.some((e) => e.toLowerCase().includes('action'))).toBe(true);
  });

  it('stopConditionsが空だとエラー', () => {
    const invalid: FISExperimentTemplate = {
      description: 'test',
      targets: { t: { resourceType: 'aws:ec2:instance', selectionMode: 'ALL' } },
      actions: { a: { actionId: 'aws:ec2:stop-instances' } },
      stopConditions: [],
      roleArn: 'arn:aws:iam::123456789012:role/FIS',
      tags: {},
    };
    const v = validate(invalid);
    expect(v.valid).toBe(false);
    expect(v.errors.some((e) => e.toLowerCase().includes('stop'))).toBe(true);
  });

  it('アクションが存在しないターゲットを参照するとエラー', () => {
    const invalid: FISExperimentTemplate = {
      description: 'test',
      targets: { t1: { resourceType: 'aws:ec2:instance', selectionMode: 'ALL' } },
      actions: {
        a1: {
          actionId: 'aws:ec2:stop-instances',
          targets: { Instances: 'non-existent-target' },
        },
      },
      stopConditions: [{ source: 'none' }],
      roleArn: 'arn:aws:iam::123456789012:role/FIS',
      tags: {},
    };
    const v = validate(invalid);
    expect(v.valid).toBe(false);
    expect(v.errors.some((e) => e.includes('non-existent-target'))).toBe(true);
  });

  it('アクションのstartAfterが存在しないアクションを参照するとエラー', () => {
    const invalid: FISExperimentTemplate = {
      description: 'test',
      targets: { t1: { resourceType: 'aws:ec2:instance', selectionMode: 'ALL' } },
      actions: {
        a1: {
          actionId: 'aws:ec2:stop-instances',
          startAfter: ['missing-action'],
        },
      },
      stopConditions: [{ source: 'none' }],
      roleArn: 'arn:aws:iam::123456789012:role/FIS',
      tags: {},
    };
    const v = validate(invalid);
    expect(v.valid).toBe(false);
    expect(v.errors.some((e) => e.includes('missing-action'))).toBe(true);
  });

  it('roleArnがarn:aws:iam:で始まらないとエラー', () => {
    const invalid: FISExperimentTemplate = {
      description: 'test',
      targets: { t1: { resourceType: 'aws:ec2:instance', selectionMode: 'ALL' } },
      actions: { a1: { actionId: 'aws:ec2:stop-instances' } },
      stopConditions: [{ source: 'none' }],
      roleArn: 'invalid-arn',
      tags: {},
    };
    const v = validate(invalid);
    expect(v.valid).toBe(false);
    expect(v.errors.some((e) => e.toLowerCase().includes('rolearn'))).toBe(true);
  });

  it('validなテンプレートはvalid: trueを返す', () => {
    const valid: FISExperimentTemplate = {
      description: 'valid',
      targets: { t1: { resourceType: 'aws:ec2:instance', selectionMode: 'ALL' } },
      actions: {
        a1: {
          actionId: 'aws:ec2:stop-instances',
          targets: { Instances: 't1' },
        },
      },
      stopConditions: [{ source: 'none' }],
      roleArn: 'arn:aws:iam::123456789012:role/FIS',
      tags: { owner: 'test' },
    };
    const v = validate(valid);
    expect(v.valid).toBe(true);
    expect(v.errors).toEqual([]);
  });
});

// ============================================================
// プロパティベース: ジェネレータ由来の全テンプレートがスキーマ通過
// ============================================================

describe('fis: プロパティベース', () => {
  it('fisTemplateArbから生成される全テンプレートがスキーマに適合', () => {
    fc.assert(
      fc.property(fisTemplateArb, (template) => {
        const parsed = FISExperimentTemplateSchema.safeParse(template);
        expect(parsed.success).toBe(true);
      }),
      { numRuns: 50 },
    );
  });

  it('JSON.stringify → JSON.parseは等価性を保つ（property-based）', () => {
    fc.assert(
      fc.property(fisTemplateArb, (template) => {
        const roundTripped = JSON.parse(JSON.stringify(template));
        expect(roundTripped).toEqual(template);
      }),
      { numRuns: 50 },
    );
  });
});
