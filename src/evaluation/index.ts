import type { FailureScenario, EvaluationCriteria } from '../types/index.js';

// ============================================================
// ID生成用カウンター
// ============================================================

let evaluationCounter = 0;

export function resetEvaluationCounter(): void {
  evaluationCounter = 0;
}

function nextId(): string {
  evaluationCounter++;
  return `eval-${String(evaluationCounter).padStart(3, '0')}`;
}

// ============================================================
// 重大度別の閾値定義
// ============================================================

interface ThresholdSet {
  detectionTime: { target: number; pass: number; fail: number };
  recoveryTime: { target: number; pass: number; fail: number };
  impactAccuracy: { target: number; pass: number; fail: number };
  communication: { target: number; pass: number; fail: number };
}

const SEVERITY_THRESHOLDS: Record<FailureScenario['severity'], ThresholdSet> = {
  Critical: {
    detectionTime: { target: 3, pass: 3, fail: 10 },
    recoveryTime: { target: 15, pass: 15, fail: 30 },
    impactAccuracy: { target: 95, pass: 90, fail: 60 },
    communication: { target: 95, pass: 90, fail: 60 },
  },
  High: {
    detectionTime: { target: 5, pass: 5, fail: 15 },
    recoveryTime: { target: 30, pass: 30, fail: 60 },
    impactAccuracy: { target: 90, pass: 80, fail: 50 },
    communication: { target: 90, pass: 80, fail: 50 },
  },
  Medium: {
    detectionTime: { target: 10, pass: 10, fail: 20 },
    recoveryTime: { target: 45, pass: 45, fail: 90 },
    impactAccuracy: { target: 80, pass: 70, fail: 40 },
    communication: { target: 80, pass: 70, fail: 40 },
  },
  Low: {
    detectionTime: { target: 15, pass: 15, fail: 30 },
    recoveryTime: { target: 60, pass: 60, fail: 120 },
    impactAccuracy: { target: 70, pass: 60, fail: 30 },
    communication: { target: 70, pass: 60, fail: 30 },
  },
};

// ============================================================
// 評価基準の定義テンプレート
// ============================================================

interface CriteriaTemplate {
  type: EvaluationCriteria['type'];
  name: string;
  unit: string;
  thresholdKey: keyof ThresholdSet;
}

const CRITERIA_TEMPLATES: CriteriaTemplate[] = [
  {
    type: 'detection-time',
    name: '障害検知時間',
    unit: 'minutes',
    thresholdKey: 'detectionTime',
  },
  {
    type: 'recovery-time',
    name: '障害復旧時間',
    unit: 'minutes',
    thresholdKey: 'recoveryTime',
  },
  {
    type: 'impact-accuracy',
    name: '影響範囲把握度',
    unit: 'percent',
    thresholdKey: 'impactAccuracy',
  },
  {
    type: 'communication',
    name: 'コミュニケーション適切性',
    unit: 'percent',
    thresholdKey: 'communication',
  },
];

// ============================================================
// 評価基準生成
// ============================================================

/**
 * 障害シナリオから評価基準を生成する
 *
 * 各シナリオに対して4種類の評価基準を生成:
 * 1. detection-time: 障害発生から検知までの目標時間
 * 2. recovery-time: 検知から復旧までの目標時間
 * 3. impact-accuracy: 影響範囲の正確な把握度
 * 4. communication: コミュニケーションの適切性
 *
 * 閾値はシナリオの重大度に応じて調整される
 */
export function generateEvaluationCriteria(
  scenarios: FailureScenario[],
): EvaluationCriteria[] {
  resetEvaluationCounter();

  const criteria: EvaluationCriteria[] = [];

  for (const scenario of scenarios) {
    const thresholds = SEVERITY_THRESHOLDS[scenario.severity];

    for (const template of CRITERIA_TEMPLATES) {
      const thresholdSet = thresholds[template.thresholdKey];

      criteria.push({
        id: nextId(),
        scenarioId: scenario.id,
        name: template.name,
        type: template.type,
        targetValue: thresholdSet.target,
        unit: template.unit,
        passThreshold: thresholdSet.pass,
        failThreshold: thresholdSet.fail,
      });
    }
  }

  return criteria;
}
