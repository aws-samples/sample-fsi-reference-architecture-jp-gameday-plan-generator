import { describe, it, expect } from 'vitest';
import { generateScenarios } from '../../src/scenario/index.js';
import type { InfraConfig, AWSResource, FailureScenario } from '../../src/types/index.js';

// ============================================================
// テストヘルパー
// ============================================================

function makeResource(
  logicalId: string,
  type: string,
  opts: Partial<AWSResource> = {},
): AWSResource {
  return {
    logicalId,
    type,
    properties: opts.properties ?? {},
    region: opts.region ?? 'us-east-1',
    tags: opts.tags,
    encryption: opts.encryption,
  };
}

function makeConfig(opts: {
  resources: AWSResource[];
  regions?: string[];
  hasEncryption?: boolean;
  hasXRayTracing?: boolean;
}): InfraConfig {
  const regions = opts.regions ?? ['us-east-1'];
  return {
    id: 'config-1',
    name: 'test-config',
    sourceFormat: 'cfn-json',
    regions,
    resources: opts.resources,
    dependencies: [],
    metadata: {
      parsedAt: new Date().toISOString(),
      sourceFile: 'test.json',
      resourceCount: opts.resources.length,
      isMultiRegion: regions.length > 1,
      hasEncryption:
        opts.hasEncryption ?? opts.resources.some((r) => r.encryption?.enabled === true),
      hasXRayTracing: opts.hasXRayTracing ?? false,
    },
  };
}

function assertRequiredFields(scenario: FailureScenario): void {
  expect(scenario.id).toBeTruthy();
  expect(scenario.name).toBeTruthy();
  expect(scenario.category).toBeDefined();
  expect(scenario.severity).toBeDefined();
  expect(scenario.description).toBeTruthy();
  expect(Array.isArray(scenario.affectedResources)).toBe(true);
  expect(scenario.affectedResources.length).toBeGreaterThan(0);
  expect(Array.isArray(scenario.steps)).toBe(true);
  expect(scenario.steps.length).toBeGreaterThan(0);
  expect(scenario.expectedOutcome).toBeTruthy();
  expect(Array.isArray(scenario.rollbackSteps)).toBe(true);
  expect(scenario.rollbackSteps.length).toBeGreaterThan(0);
}

// ============================================================
// 基本生成ロジック
// ============================================================

describe('generateScenarios: 基本動作', () => {
  it('空リソースでは空配列を返す', () => {
    const config = makeConfig({ resources: [] });
    const scenarios = generateScenarios(config);
    expect(scenarios).toEqual([]);
  });

  it('EC2インスタンスのみの構成でinfrastructureシナリオが生成される', () => {
    const config = makeConfig({
      resources: [makeResource('WebServer', 'AWS::EC2::Instance')],
    });
    const scenarios = generateScenarios(config);
    expect(scenarios.length).toBeGreaterThan(0);
    expect(scenarios.every((s) => s.category === 'infrastructure' || s.category === 'operation')).toBe(true);

    // EC2停止シナリオが存在する
    const ec2Stop = scenarios.find((s) => s.name.includes('EC2'));
    expect(ec2Stop).toBeDefined();
    if (ec2Stop) {
      expect(ec2Stop.affectedResources).toContain('WebServer');
    }
  });

  it('RDSインスタンスのみの構成でdataシナリオが生成される', () => {
    const config = makeConfig({
      resources: [makeResource('MainDB', 'AWS::RDS::DBInstance')],
    });
    const scenarios = generateScenarios(config);
    expect(scenarios.length).toBeGreaterThan(0);

    // フェイルオーバーシナリオが存在する
    const failover = scenarios.find((s) => s.category === 'data' && s.name.includes('フェイルオーバー'));
    expect(failover).toBeDefined();
  });

  it('各シナリオに必須フィールドが揃っている', () => {
    const config = makeConfig({
      resources: [
        makeResource('Web', 'AWS::EC2::Instance'),
        makeResource('DB', 'AWS::RDS::DBInstance'),
        makeResource('Func', 'AWS::Lambda::Function'),
        makeResource('Bucket', 'AWS::S3::Bucket'),
      ],
    });
    const scenarios = generateScenarios(config);
    expect(scenarios.length).toBeGreaterThan(0);
    for (const scenario of scenarios) {
      assertRequiredFields(scenario);
    }
  });

  it('シナリオIDは一意である', () => {
    const config = makeConfig({
      resources: [
        makeResource('Web1', 'AWS::EC2::Instance'),
        makeResource('Web2', 'AWS::EC2::Instance'),
        makeResource('DB1', 'AWS::RDS::DBInstance'),
      ],
    });
    const scenarios = generateScenarios(config);
    const ids = scenarios.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('重大度が4種類のいずれかになる', () => {
    const config = makeConfig({
      resources: [
        makeResource('Web', 'AWS::EC2::Instance'),
        makeResource('DB', 'AWS::RDS::DBInstance'),
        makeResource('Func', 'AWS::Lambda::Function'),
      ],
    });
    const scenarios = generateScenarios(config);
    const validSeverities = new Set(['Critical', 'High', 'Medium', 'Low']);
    for (const s of scenarios) {
      expect(validSeverities.has(s.severity)).toBe(true);
    }
  });
});

// ============================================================
// エンリッチャー
// ============================================================

describe('generateScenarios: エンリッチャー', () => {
  it('マルチリージョン構成でフェイルオーバーシナリオが追加される', () => {
    const config = makeConfig({
      resources: [
        makeResource('Web', 'AWS::EC2::Instance', { region: 'us-east-1' }),
        makeResource('WebDR', 'AWS::EC2::Instance', { region: 'eu-west-1' }),
      ],
      regions: ['us-east-1', 'eu-west-1'],
    });

    const scenarios = generateScenarios(config);
    const multiRegion = scenarios.filter((s) =>
      s.tags.includes('multi-region') || s.name.includes('リージョン'),
    );
    expect(multiRegion.length).toBeGreaterThan(0);
  });

  it('単一リージョン構成ではmulti-regionタグは付かない', () => {
    const config = makeConfig({
      resources: [makeResource('Web', 'AWS::EC2::Instance')],
      regions: ['us-east-1'],
    });

    const scenarios = generateScenarios(config);
    const multiRegion = scenarios.filter((s) => s.tags.includes('multi-region'));
    expect(multiRegion.length).toBe(0);
  });

  it('暗号化構成でPQCシナリオが追加される', () => {
    const config = makeConfig({
      resources: [
        makeResource('SecretDB', 'AWS::RDS::DBInstance', {
          encryption: { enabled: true, algorithm: 'aws:kms', kmsKeyId: 'key-123' },
        }),
      ],
      hasEncryption: true,
    });

    const scenarios = generateScenarios(config);
    const pqc = scenarios.filter((s) => s.tags.includes('pqc'));
    expect(pqc.length).toBeGreaterThan(0);

    // PQC移行準備検証シナリオが含まれる
    const pqcMigration = scenarios.find((s) => s.name.includes('PQC'));
    expect(pqcMigration).toBeDefined();
  });

  it('暗号化無し構成ではPQCシナリオは追加されない', () => {
    const config = makeConfig({
      resources: [makeResource('DB', 'AWS::RDS::DBInstance')],
      hasEncryption: false,
    });

    const scenarios = generateScenarios(config);
    const pqc = scenarios.filter((s) => s.tags.includes('pqc'));
    expect(pqc.length).toBe(0);
  });

  it('マルチリージョン+暗号化の両方でPQCとフェイルオーバー両方が追加される', () => {
    const config = makeConfig({
      resources: [
        makeResource('DB1', 'AWS::RDS::DBInstance', {
          region: 'us-east-1',
          encryption: { enabled: true, algorithm: 'aws:kms' },
        }),
        makeResource('DB2', 'AWS::RDS::DBInstance', { region: 'eu-west-1' }),
      ],
      regions: ['us-east-1', 'eu-west-1'],
      hasEncryption: true,
    });

    const scenarios = generateScenarios(config);
    expect(scenarios.some((s) => s.tags.includes('multi-region'))).toBe(true);
    expect(scenarios.some((s) => s.tags.includes('pqc'))).toBe(true);
  });
});

// ============================================================
// ステップの構造
// ============================================================

describe('generateScenarios: ステップ構造', () => {
  it('各ステップは順序付き（order, action, target）', () => {
    const config = makeConfig({
      resources: [makeResource('Web', 'AWS::EC2::Instance')],
    });
    const scenarios = generateScenarios(config);

    for (const s of scenarios) {
      for (const step of s.steps) {
        expect(typeof step.order).toBe('number');
        expect(step.order).toBeGreaterThan(0);
        expect(typeof step.action).toBe('string');
        expect(step.action.length).toBeGreaterThan(0);
        expect(typeof step.target).toBe('string');
      }
    }
  });

  it('ステップのorderは昇順', () => {
    const config = makeConfig({
      resources: [makeResource('Web', 'AWS::EC2::Instance')],
    });
    const scenarios = generateScenarios(config);

    for (const s of scenarios) {
      const orders = s.steps.map((st) => st.order);
      const sorted = [...orders].sort((a, b) => a - b);
      expect(orders).toEqual(sorted);
    }
  });
});
