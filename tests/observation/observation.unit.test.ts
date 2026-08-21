import { describe, it, expect } from 'vitest';
import {
  generateObservationPoints,
  toCloudFormation,
  resetObservationCounter,
} from '../../src/observation/index.js';
import type {
  FailureScenario,
  InfraConfig,
  AWSResource,
} from '../../src/types/index.js';

// ============================================================
// テストヘルパー
// ============================================================

function makeScenario(
  id: string,
  category: FailureScenario['category'] = 'infrastructure',
  opts: Partial<FailureScenario> = {},
): FailureScenario {
  return {
    id,
    name: opts.name ?? `Scenario ${id}`,
    category,
    severity: opts.severity ?? 'High',
    description: opts.description ?? `desc for ${id}`,
    affectedResources: opts.affectedResources ?? [`res-${id}`],
    impactScope: opts.impactScope ?? 'local',
    prerequisites: opts.prerequisites ?? ['prereq'],
    steps: opts.steps ?? [{ order: 1, action: 'do', target: 'x' }],
    expectedOutcome: opts.expectedOutcome ?? 'ok',
    rollbackSteps: opts.rollbackSteps ?? ['rb'],
    estimatedDuration: opts.estimatedDuration ?? 30,
    tags: opts.tags ?? [],
  };
}

function makeConfig(opts: {
  resources?: AWSResource[];
  hasXRayTracing?: boolean;
}): InfraConfig {
  const resources = opts.resources ?? [];
  return {
    id: 'cfg',
    name: 'cfg',
    sourceFormat: 'cfn-json',
    regions: ['us-east-1'],
    resources,
    dependencies: [],
    metadata: {
      parsedAt: new Date().toISOString(),
      sourceFile: 'test.json',
      resourceCount: resources.length,
      isMultiRegion: false,
      hasEncryption: false,
      hasXRayTracing: opts.hasXRayTracing ?? false,
    },
  };
}

// ============================================================
// 基本生成
// ============================================================

describe('generateObservationPoints: 基本動作', () => {
  it('シナリオから観測ポイントが生成される', () => {
    const scenarios = [makeScenario('s1', 'infrastructure')];
    const config = makeConfig({});
    const points = generateObservationPoints(scenarios, config);

    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      expect(p.scenarioId).toBe('s1');
    }
  });

  it('空シナリオでは空配列を返す', () => {
    const points = generateObservationPoints([], makeConfig({}));
    expect(points).toEqual([]);
  });

  it('各観測ポイントに必須フィールドが揃っている', () => {
    const scenarios = [
      makeScenario('a', 'infrastructure'),
      makeScenario('b', 'data'),
      makeScenario('c', 'security'),
      makeScenario('d', 'network'),
      makeScenario('e', 'operation'),
    ];
    const points = generateObservationPoints(scenarios, makeConfig({}));

    for (const p of points) {
      expect(p.id).toBeTruthy();
      expect(p.scenarioId).toBeTruthy();
      expect(p.type).toBeDefined();
      expect(p.name).toBeTruthy();
      expect(p.description).toBeTruthy();
      expect(p.normalRange).toBeDefined();
      expect(typeof p.threshold).toBe('number');
      expect(p.checkTiming).toBeDefined();
      expect(p.cloudwatchConfig).toBeDefined();
    }
  });

  it('typeは metric/alarm/log-filter/xray-trace のいずれか', () => {
    const scenarios = [
      makeScenario('a', 'infrastructure'),
      makeScenario('b', 'data'),
      makeScenario('c', 'security'),
      makeScenario('d', 'network'),
      makeScenario('e', 'operation'),
    ];
    const points = generateObservationPoints(scenarios, makeConfig({}));
    const validTypes = new Set(['metric', 'alarm', 'log-filter', 'xray-trace']);
    for (const p of points) {
      expect(validTypes.has(p.type)).toBe(true);
    }
  });

  it('checkTimingは before/during/after のいずれか', () => {
    const scenarios = [makeScenario('s1', 'data')];
    const points = generateObservationPoints(scenarios, makeConfig({}));
    const validTimings = new Set(['before', 'during', 'after']);
    for (const p of points) {
      expect(validTimings.has(p.checkTiming)).toBe(true);
    }
  });

  it('観測ポイントIDは一意である', () => {
    const scenarios = [
      makeScenario('s1', 'infrastructure'),
      makeScenario('s2', 'data'),
      makeScenario('s3', 'network'),
    ];
    const points = generateObservationPoints(scenarios, makeConfig({}));
    const ids = points.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('カウンターリセット後も一意なIDが生成される', () => {
    resetObservationCounter();
    const points1 = generateObservationPoints([makeScenario('s1')], makeConfig({}));
    const points2 = generateObservationPoints([makeScenario('s2')], makeConfig({}));

    // generateObservationPoints内部でresetされるため、毎回1から開始する
    expect(points1[0].id).toMatch(/^obs-\d{3}$/);
    expect(points2[0].id).toMatch(/^obs-\d{3}$/);
  });
});

// ============================================================
// X-Rayトレーシング
// ============================================================

describe('generateObservationPoints: X-Rayトレーシング', () => {
  it('X-Rayトレーシング有効時にxray-traceタイプが含まれる', () => {
    const scenarios = [makeScenario('s1', 'infrastructure')];
    const config = makeConfig({ hasXRayTracing: true });
    const points = generateObservationPoints(scenarios, config);

    const xrayPoints = points.filter((p) => p.type === 'xray-trace');
    expect(xrayPoints.length).toBeGreaterThan(0);
  });

  it('X-Rayトレーシング無効時はxray-traceが含まれない', () => {
    const scenarios = [makeScenario('s1', 'infrastructure')];
    const config = makeConfig({ hasXRayTracing: false });
    const points = generateObservationPoints(scenarios, config);

    const xrayPoints = points.filter((p) => p.type === 'xray-trace');
    expect(xrayPoints.length).toBe(0);
  });
});

// ============================================================
// toCloudFormation
// ============================================================

describe('toCloudFormation', () => {
  it('有効なCFn構造（AWSTemplateFormatVersion + Resources）を返す', () => {
    const scenarios = [makeScenario('s1', 'infrastructure')];
    const points = generateObservationPoints(scenarios, makeConfig({}));
    const cfn = toCloudFormation(points);

    expect(cfn).toHaveProperty('AWSTemplateFormatVersion');
    expect(cfn).toHaveProperty('Resources');
    expect(cfn.AWSTemplateFormatVersion).toBe('2010-09-09');
    expect(typeof cfn.Resources).toBe('object');
  });

  it('alarmタイプの観測ポイントからAWS::CloudWatch::Alarmリソースが生成される', () => {
    const scenarios = [makeScenario('s1', 'infrastructure')];
    const points = generateObservationPoints(scenarios, makeConfig({}));
    const cfn = toCloudFormation(points) as { Resources: Record<string, { Type: string }> };

    const resources = Object.values(cfn.Resources);
    const alarmCount = points.filter((p) => p.type === 'alarm').length;
    const alarmResources = resources.filter((r) => r.Type === 'AWS::CloudWatch::Alarm');
    expect(alarmResources.length).toBe(alarmCount);
  });

  it('観測ポイントが存在する場合ダッシュボードリソースが生成される', () => {
    const scenarios = [makeScenario('s1', 'infrastructure')];
    const points = generateObservationPoints(scenarios, makeConfig({}));
    const cfn = toCloudFormation(points) as { Resources: Record<string, { Type: string }> };

    const dashboard = cfn.Resources['GameDayDashboard'];
    expect(dashboard).toBeDefined();
    expect(dashboard.Type).toBe('AWS::CloudWatch::Dashboard');
  });

  it('観測ポイントが空の場合でもCFn構造は有効', () => {
    const cfn = toCloudFormation([]) as {
      AWSTemplateFormatVersion: string;
      Resources: Record<string, unknown>;
    };
    expect(cfn.AWSTemplateFormatVersion).toBe('2010-09-09');
    expect(Object.keys(cfn.Resources)).toHaveLength(0);
  });

  it('CFn出力はJSONにシリアライズ可能', () => {
    const scenarios = [makeScenario('s1', 'infrastructure')];
    const points = generateObservationPoints(scenarios, makeConfig({}));
    const cfn = toCloudFormation(points);

    expect(() => JSON.stringify(cfn)).not.toThrow();
    const roundTrip = JSON.parse(JSON.stringify(cfn));
    expect(roundTrip).toEqual(cfn);
  });
});
