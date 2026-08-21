import { describe, it, expect } from 'vitest';
import { generateEvaluationCriteria } from '../../src/evaluation/index.js';
import type { FailureScenario } from '../../src/types/index.js';

// ============================================================
// テストヘルパー
// ============================================================

function makeScenario(
  id: string,
  severity: FailureScenario['severity'],
  opts: Partial<FailureScenario> = {},
): FailureScenario {
  return {
    id,
    name: opts.name ?? `Scenario ${id}`,
    category: opts.category ?? 'infrastructure',
    severity,
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

// ============================================================
// 基本生成
// ============================================================

describe('generateEvaluationCriteria: 基本動作', () => {
  it('シナリオごとに4種類の評価基準が生成される', () => {
    const scenarios = [makeScenario('s1', 'High')];
    const criteria = generateEvaluationCriteria(scenarios);

    expect(criteria).toHaveLength(4);
    const types = criteria.map((c) => c.type);
    expect(types).toContain('detection-time');
    expect(types).toContain('recovery-time');
    expect(types).toContain('impact-accuracy');
    expect(types).toContain('communication');
  });

  it('全シナリオに対してそれぞれ4種類の基準が生成される', () => {
    const scenarios = [
      makeScenario('s1', 'Critical'),
      makeScenario('s2', 'High'),
      makeScenario('s3', 'Medium'),
      makeScenario('s4', 'Low'),
    ];
    const criteria = generateEvaluationCriteria(scenarios);
    expect(criteria).toHaveLength(4 * scenarios.length);
  });

  it('空のシナリオでは空配列が返る', () => {
    const criteria = generateEvaluationCriteria([]);
    expect(criteria).toEqual([]);
  });

  it('各基準に必須フィールドが揃っている', () => {
    const scenarios = [makeScenario('s1', 'High')];
    const criteria = generateEvaluationCriteria(scenarios);

    for (const c of criteria) {
      expect(c.id).toBeTruthy();
      expect(c.scenarioId).toBe('s1');
      expect(c.name).toBeTruthy();
      expect(c.type).toBeDefined();
      expect(typeof c.targetValue).toBe('number');
      expect(c.unit).toBeTruthy();
      expect(typeof c.passThreshold).toBe('number');
      expect(typeof c.failThreshold).toBe('number');
    }
  });

  it('基準IDは一意である', () => {
    const scenarios = [
      makeScenario('s1', 'Critical'),
      makeScenario('s2', 'High'),
    ];
    const criteria = generateEvaluationCriteria(scenarios);
    const ids = criteria.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ============================================================
// 閾値
// ============================================================

describe('generateEvaluationCriteria: 閾値', () => {
  it('passThreshold < failThreshold（時間系: 小さいほど良い）', () => {
    const scenarios = [makeScenario('s1', 'High')];
    const criteria = generateEvaluationCriteria(scenarios);

    // detection-time と recovery-time は「時間が短いほど良い」ので
    // passThreshold（これ以下で合格）< failThreshold（これ超えで不合格）
    const timeCriteria = criteria.filter(
      (c) => c.type === 'detection-time' || c.type === 'recovery-time',
    );
    expect(timeCriteria.length).toBeGreaterThan(0);
    for (const c of timeCriteria) {
      expect(c.passThreshold).toBeLessThan(c.failThreshold);
    }
  });

  it('passThreshold > failThreshold（精度系: 大きいほど良い）', () => {
    const scenarios = [makeScenario('s1', 'High')];
    const criteria = generateEvaluationCriteria(scenarios);

    // impact-accuracy と communication は「パーセントが高いほど良い」ので
    // passThreshold（これ以上で合格）> failThreshold（これ未満で不合格）
    const pctCriteria = criteria.filter(
      (c) => c.type === 'impact-accuracy' || c.type === 'communication',
    );
    expect(pctCriteria.length).toBeGreaterThan(0);
    for (const c of pctCriteria) {
      expect(c.passThreshold).toBeGreaterThan(c.failThreshold);
    }
  });

  it('重大度が高いほど検知時間の閾値は厳しい', () => {
    const critical = generateEvaluationCriteria([makeScenario('c', 'Critical')]);
    const high = generateEvaluationCriteria([makeScenario('h', 'High')]);
    const medium = generateEvaluationCriteria([makeScenario('m', 'Medium')]);
    const low = generateEvaluationCriteria([makeScenario('l', 'Low')]);

    const getDetection = (arr: typeof critical) =>
      arr.find((c) => c.type === 'detection-time')!.passThreshold;

    expect(getDetection(critical)).toBeLessThan(getDetection(high));
    expect(getDetection(high)).toBeLessThan(getDetection(medium));
    expect(getDetection(medium)).toBeLessThan(getDetection(low));
  });

  it('単位は time系=minutes, 精度系=percent', () => {
    const criteria = generateEvaluationCriteria([makeScenario('s1', 'High')]);

    const byType = Object.fromEntries(criteria.map((c) => [c.type, c.unit]));
    expect(byType['detection-time']).toBe('minutes');
    expect(byType['recovery-time']).toBe('minutes');
    expect(byType['impact-accuracy']).toBe('percent');
    expect(byType['communication']).toBe('percent');
  });

  it('targetValueとpassThresholdが時間系基準で一致する', () => {
    const criteria = generateEvaluationCriteria([makeScenario('s1', 'Critical')]);
    // コードでは時間系(detection-time/recovery-time)はtarget==pass
    // 精度系(impact-accuracy/communication)はtarget > pass（より厳しい目標）
    for (const c of criteria) {
      if (c.type === 'detection-time' || c.type === 'recovery-time') {
        expect(c.targetValue).toBe(c.passThreshold);
      } else {
        expect(c.targetValue).toBeGreaterThanOrEqual(c.passThreshold);
      }
    }
  });
});
