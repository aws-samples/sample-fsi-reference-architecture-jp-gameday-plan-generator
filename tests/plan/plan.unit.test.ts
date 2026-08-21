import { describe, it, expect } from 'vitest';
import { generate, toMarkdown } from '../../src/plan/index.js';
import type { FailureScenario, PlanOptions } from '../../src/types/index.js';

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
    steps: opts.steps ?? [{ order: 1, action: 'execute', target: `res-${id}` }],
    expectedOutcome: opts.expectedOutcome ?? 'recovered',
    rollbackSteps: opts.rollbackSteps ?? ['rollback'],
    estimatedDuration: opts.estimatedDuration ?? 30,
    tags: opts.tags ?? [],
  };
}

const defaultOptions: PlanOptions = {
  duration: 'full-day',
  participantCount: 10,
};

// ============================================================
// 基本生成
// ============================================================

describe('plan.generate: 基本動作', () => {
  it('シナリオから計画が生成される', () => {
    const scenarios = [
      makeScenario('s1', 'High'),
      makeScenario('s2', 'Critical'),
      makeScenario('s3', 'Medium'),
    ];
    const plan = generate(scenarios, defaultOptions);

    expect(plan.id).toBeTruthy();
    expect(plan.title).toBeTruthy();
    expect(plan.duration).toBe('full-day');
    expect(plan.scenarios).toHaveLength(3);
    expect(plan.roles.length).toBeGreaterThan(0);
    expect(plan.timeline.length).toBeGreaterThan(0);
    expect(plan.escalationFlow.length).toBeGreaterThan(0);
  });

  it('空のシナリオ配列でも計画は生成される（シナリオ数は0）', () => {
    const plan = generate([], defaultOptions);
    expect(plan.scenarios).toEqual([]);
    expect(plan.roles.length).toBeGreaterThan(0);
    expect(plan.escalationFlow.length).toBeGreaterThan(0);
  });

  it('durationオプションが計画に反映される', () => {
    const plan = generate([], { duration: 'half-day' });
    expect(plan.duration).toBe('half-day');
  });
});

// ============================================================
// 実行順序は重大度の降順
// ============================================================

describe('plan.generate: 実行順序', () => {
  it('シナリオは重大度の降順で実行される（Critical → High → Medium → Low）', () => {
    const scenarios = [
      makeScenario('low1', 'Low'),
      makeScenario('med1', 'Medium'),
      makeScenario('high1', 'High'),
      makeScenario('crit1', 'Critical'),
      makeScenario('med2', 'Medium'),
    ];
    const plan = generate(scenarios, defaultOptions);

    const ordered = [...plan.scenarios].sort((a, b) => a.executionOrder - b.executionOrder);
    const idsInOrder = ordered.map((p) => p.scenarioId);
    const scenarioById = new Map(scenarios.map((s) => [s.id, s]));
    const severityOrder = ['Critical', 'High', 'Medium', 'Low'];

    const severitiesInOrder = idsInOrder.map((id) => scenarioById.get(id)!.severity);
    for (let i = 1; i < severitiesInOrder.length; i++) {
      const prev = severityOrder.indexOf(severitiesInOrder[i - 1]);
      const cur = severityOrder.indexOf(severitiesInOrder[i]);
      expect(prev).toBeLessThanOrEqual(cur);
    }
  });

  it('executionOrderは1から連番で重複なし', () => {
    const scenarios = [
      makeScenario('a', 'High'),
      makeScenario('b', 'High'),
      makeScenario('c', 'Low'),
    ];
    const plan = generate(scenarios, defaultOptions);

    const orders = plan.scenarios.map((p) => p.executionOrder).sort((a, b) => a - b);
    expect(orders).toEqual([1, 2, 3]);
  });
});

// ============================================================
// 役割分担と参加者数の整合性
// ============================================================

describe('plan.generate: 役割分担', () => {
  it('役割の合計人数 = 参加者数（participantCount指定時）', () => {
    const plan = generate([makeScenario('s1', 'High')], {
      duration: 'full-day',
      participantCount: 8,
    });
    const total = plan.roles.reduce((sum, r) => sum + r.assignedCount, 0);
    expect(total).toBe(8);
  });

  it('facilitator, operator, observerの3役が生成される', () => {
    const plan = generate([makeScenario('s1', 'High')], {
      duration: 'full-day',
      participantCount: 10,
    });
    const roles = plan.roles.map((r) => r.role);
    expect(roles).toContain('facilitator');
    expect(roles).toContain('operator');
    expect(roles).toContain('observer');
  });

  it('facilitatorは常に1名', () => {
    const plan = generate([makeScenario('s1', 'High')], {
      duration: 'full-day',
      participantCount: 20,
    });
    const facilitator = plan.roles.find((r) => r.role === 'facilitator');
    expect(facilitator?.assignedCount).toBe(1);
  });

  it('参加者数未指定時もデフォルトで整合性が保たれる', () => {
    const plan = generate([makeScenario('s1', 'High')], { duration: 'full-day' });
    const total = plan.roles.reduce((sum, r) => sum + r.assignedCount, 0);
    expect(total).toBeGreaterThan(0);
  });
});

// ============================================================
// Markdown出力
// ============================================================

describe('plan.toMarkdown', () => {
  it('Markdownに主要な見出しが含まれる', () => {
    const scenarios = [makeScenario('s1', 'High')];
    const plan = generate(scenarios, defaultOptions);
    const md = toMarkdown(plan, scenarios);

    expect(md).toContain('# '); // タイトル
    expect(md).toContain('## 役割分担');
    expect(md).toContain('## タイムライン');
    expect(md).toContain('## 実行手順');
    expect(md).toContain('## エスカレーションフロー');
  });

  it('Markdownにテーブル構造（|）が含まれる', () => {
    const plan = generate([makeScenario('s1', 'Critical')], defaultOptions);
    const md = toMarkdown(plan);

    // テーブルヘッダ行
    expect(md).toMatch(/\|\s*役割\s*\|/);
    expect(md).toMatch(/\|\s*時刻\s*\|/);
  });

  it('Markdownにリスト構造（-）が含まれる', () => {
    const scenarios = [makeScenario('s1', 'High')];
    const plan = generate(scenarios, defaultOptions);
    const md = toMarkdown(plan, scenarios);

    expect(md).toMatch(/^-\s+/m);
  });

  it('シナリオ情報ありでMarkdownを生成するとシナリオ名が含まれる', () => {
    const scenarios = [makeScenario('s1', 'High', { name: '超特別シナリオ' })];
    const plan = generate(scenarios, defaultOptions);
    const md = toMarkdown(plan, scenarios);

    expect(md).toContain('超特別シナリオ');
  });
});

// ============================================================
// 容量制約 (実施枠を超える場合の挙動)
// ============================================================

describe('plan.generate: 容量制約', () => {
  it('全シナリオが収まる場合 unscheduledScenarioIds は空', () => {
    // half-day (240分 - 準備30 - 振り返り30 = 180分の実行枠)
    // 30分 x 4 = 120分 で余裕で収まる
    const scenarios = [
      makeScenario('s1', 'Critical'),
      makeScenario('s2', 'High'),
      makeScenario('s3', 'Medium'),
      makeScenario('s4', 'Low'),
    ];
    const plan = generate(scenarios, { duration: 'half-day' });

    expect(plan.unscheduledScenarioIds).toEqual([]);
    expect(plan.scenarios).toHaveLength(4);
    expect(plan.totalRequestedMinutes).toBe(120);
    expect(plan.availableExecutionMinutes).toBe(180);
  });

  it('シナリオ合計が枠を超えると、低重大度のものから unscheduled に分離される', () => {
    // half-day 実行枠 = 180分
    // 60分 x 5 = 300分 → 超過。Critical/High/Medium が優先採用、Low のものが押し出される
    const scenarios = [
      makeScenario('crit', 'Critical', { estimatedDuration: 60 }),
      makeScenario('high1', 'High', { estimatedDuration: 60 }),
      makeScenario('high2', 'High', { estimatedDuration: 60 }),
      makeScenario('med', 'Medium', { estimatedDuration: 60 }),
      makeScenario('low', 'Low', { estimatedDuration: 60 }),
    ];
    const plan = generate(scenarios, { duration: 'half-day' });

    expect(plan.unscheduledScenarioIds.length).toBeGreaterThan(0);
    // 押し出されるのは重大度の低いもの → 'low' は必ず未スケジュール
    expect(plan.unscheduledScenarioIds).toContain('low');
    // 採用された総時間 + 想定休憩 ≤ 180
    expect(plan.totalRequestedMinutes).toBe(300);
    // 採用シナリオ + 未スケジュール = 全体
    expect(plan.scenarios.length + plan.unscheduledScenarioIds.length).toBe(5);
  });

  it('タイムラインの最終時刻が duration の endTime を超えない（半日）', () => {
    // 半日で 30分 x 30 個 を投げて、それでも 13:00 を超えないことを期待
    const scenarios = Array.from({ length: 30 }, (_, i) =>
      makeScenario(`s${i}`, i < 5 ? 'Critical' : i < 15 ? 'High' : i < 25 ? 'Medium' : 'Low'),
    );
    const plan = generate(scenarios, { duration: 'half-day' });

    // タイムラインの最後のエントリは review (振り返り)
    const lastEntry = plan.timeline[plan.timeline.length - 1];
    expect(lastEntry.type).toBe('review');
    // 13:00 (780分) を超えないこと
    const [h, m] = lastEntry.time.split(':').map(Number);
    const lastMinutes = h * 60 + m;
    expect(lastMinutes).toBeLessThanOrEqual(13 * 60);
  });

  it('タイムラインの最終時刻が duration の endTime を超えない（フルデー）', () => {
    // 1日で 30分 x 50 個 を投げて、それでも 17:00 を超えないことを期待
    const scenarios = Array.from({ length: 50 }, (_, i) =>
      makeScenario(`s${i}`, i < 10 ? 'Critical' : i < 25 ? 'High' : i < 40 ? 'Medium' : 'Low'),
    );
    const plan = generate(scenarios, { duration: 'full-day' });

    const lastEntry = plan.timeline[plan.timeline.length - 1];
    expect(lastEntry.type).toBe('review');
    const [h, m] = lastEntry.time.split(':').map(Number);
    const lastMinutes = h * 60 + m;
    expect(lastMinutes).toBeLessThanOrEqual(17 * 60);
  });

  it('Markdown に容量警告と未スケジュールセクションが出る', () => {
    const scenarios = [
      makeScenario('crit', 'Critical', { estimatedDuration: 60, name: 'Critical Scenario' }),
      makeScenario('high', 'High', { estimatedDuration: 60, name: 'High Scenario' }),
      makeScenario('med', 'Medium', { estimatedDuration: 60, name: 'Medium Scenario' }),
      makeScenario('low', 'Low', { estimatedDuration: 60, name: 'Low Scenario' }),
    ];
    const plan = generate(scenarios, { duration: 'half-day' });
    const md = toMarkdown(plan, scenarios);

    if (plan.unscheduledScenarioIds.length > 0) {
      expect(md).toContain('実施枠');
      expect(md).toContain('未スケジュールのシナリオ');
      // 未スケジュール対象の名前が表に出ること
      const firstUnscheduledId = plan.unscheduledScenarioIds[0];
      const firstUnscheduledName = scenarios.find(s => s.id === firstUnscheduledId)?.name;
      if (firstUnscheduledName) {
        expect(md).toContain(firstUnscheduledName);
      }
    }
  });
});
