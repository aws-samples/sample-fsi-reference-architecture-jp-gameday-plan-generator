import { describe, it, expect } from 'vitest';
import { generate } from '../../src/dashboard/index.js';
import type {
  DashboardData,
  GameDayPlan,
  FailureScenario,
  ObservationPoint,
  EvaluationCriteria,
  GameDayResult,
} from '../../src/types/index.js';

// ============================================================
// テストヘルパー
// ============================================================

function makePlan(overrides: Partial<GameDayPlan> = {}): GameDayPlan {
  return {
    id: overrides.id ?? 'plan-1',
    title: overrides.title ?? 'My GameDay Plan',
    duration: overrides.duration ?? 'full-day',
    scenarios: overrides.scenarios ?? [
      { scenarioId: 's1', executionOrder: 1, startTime: '09:00', estimatedDuration: 30 },
    ],
    roles: overrides.roles ?? [
      {
        role: 'facilitator',
        description: 'lead',
        responsibilities: ['lead sessions'],
        assignedCount: 1,
      },
      {
        role: 'operator',
        description: 'operate',
        responsibilities: ['execute'],
        assignedCount: 2,
      },
    ],
    timeline: overrides.timeline ?? [
      { time: '09:00', activity: 'opening', type: 'preparation' },
      { time: '09:30', activity: 'scenario 1', type: 'execution', scenarioId: 's1' },
    ],
    escalationFlow: overrides.escalationFlow ?? [
      { condition: 'if bad', action: 'escalate', contactRole: 'facilitator' },
    ],
    unscheduledScenarioIds: overrides.unscheduledScenarioIds ?? [],
    availableExecutionMinutes: overrides.availableExecutionMinutes ?? 480,
    totalRequestedMinutes: overrides.totalRequestedMinutes ?? 30,
  };
}

function makeScenario(id: string, overrides: Partial<FailureScenario> = {}): FailureScenario {
  return {
    id,
    name: overrides.name ?? `Scenario ${id}`,
    category: overrides.category ?? 'infrastructure',
    severity: overrides.severity ?? 'High',
    description: overrides.description ?? 'description',
    affectedResources: overrides.affectedResources ?? [`res-${id}`],
    impactScope: overrides.impactScope ?? 'scope',
    prerequisites: overrides.prerequisites ?? ['p1'],
    steps: overrides.steps ?? [{ order: 1, action: 'do', target: 't' }],
    expectedOutcome: overrides.expectedOutcome ?? 'ok',
    rollbackSteps: overrides.rollbackSteps ?? ['rb'],
    estimatedDuration: overrides.estimatedDuration ?? 30,
    tags: overrides.tags ?? [],
    rationale: overrides.rationale,
    executability: overrides.executability,
    alternativeApproach: overrides.alternativeApproach,
    evaluations: overrides.evaluations,
  };
}

function makeObservation(id: string, scenarioId: string): ObservationPoint {
  return {
    id,
    scenarioId,
    type: 'metric',
    name: `Observation ${id}`,
    description: 'd',
    normalRange: { min: 0, max: 100 },
    threshold: 90,
    checkTiming: 'during',
    cloudwatchConfig: {
      namespace: 'AWS/EC2',
      metricName: 'CPUUtilization',
      statistic: 'Average',
      period: 60,
    },
  };
}

function makeEvaluation(id: string, scenarioId: string): EvaluationCriteria {
  return {
    id,
    scenarioId,
    name: `Eval ${id}`,
    type: 'detection-time',
    targetValue: 5,
    unit: 'minutes',
    passThreshold: 5,
    failThreshold: 15,
  };
}

function makeResult(id: string, executedAt: string, score: number): GameDayResult {
  return {
    planId: id,
    executedAt,
    scenarioResults: [],
    overallScore: score,
  };
}

// ============================================================
// 基本HTML出力
// ============================================================

describe('dashboard.generate: 基本HTML構造', () => {
  it('<!DOCTYPE html>を含むHTML文字列が生成される', () => {
    const data: DashboardData = {
      plan: makePlan(),
      scenarios: [makeScenario('s1')],
      observations: [makeObservation('o1', 's1')],
      evaluations: [makeEvaluation('e1', 's1')],
    };
    const html = generate(data);

    expect(typeof html).toBe('string');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
  });

  it('HTMLにメタ情報（charset, viewport）が含まれる', () => {
    const data: DashboardData = {
      plan: makePlan(),
      scenarios: [makeScenario('s1')],
      observations: [makeObservation('o1', 's1')],
      evaluations: [makeEvaluation('e1', 's1')],
    };
    const html = generate(data);
    expect(html).toContain('charset="UTF-8"');
    expect(html).toContain('viewport');
  });

  it('計画タイトルがHTMLに含まれる', () => {
    const data: DashboardData = {
      plan: makePlan({ title: 'ユニークなタイトル名' }),
      scenarios: [makeScenario('s1')],
      observations: [makeObservation('o1', 's1')],
      evaluations: [makeEvaluation('e1', 's1')],
    };
    const html = generate(data);
    expect(html).toContain('ユニークなタイトル名');
  });
});

// ============================================================
// シナリオ・観測・評価の出力
// ============================================================

describe('dashboard.generate: 集計情報', () => {
  it('シナリオ数がHTMLに含まれる', () => {
    const scenarios = [makeScenario('s1'), makeScenario('s2'), makeScenario('s3')];
    const data: DashboardData = {
      plan: makePlan(),
      scenarios,
      observations: [makeObservation('o1', 's1')],
      evaluations: [makeEvaluation('e1', 's1')],
    };
    const html = generate(data);
    // 3件のシナリオが存在することが表現される
    expect(html).toContain('3');
  });

  it('観測ポイント件数がシナリオ詳細ボタンに表示される', () => {
    const observations = [
      makeObservation('o1', 's1'),
      makeObservation('o2', 's1'),
      makeObservation('o3', 's1'),
      makeObservation('o4', 's1'),
      makeObservation('o5', 's1'),
    ];
    const data: DashboardData = {
      plan: makePlan(),
      scenarios: [makeScenario('s1')],
      observations,
      evaluations: [makeEvaluation('e1', 's1')],
    };
    const html = generate(data);
    // 観測5件がシナリオs1の詳細バッジに出る（📡5）
    expect(html).toContain('scenario-obs-count');
    expect(html).toContain('📡5');
  });

  it('シナリオ名がHTMLテーブルに含まれる', () => {
    const scenarios = [makeScenario('s1', { name: '特殊なシナリオXYZ' })];
    const data: DashboardData = {
      plan: makePlan(),
      scenarios,
      observations: [makeObservation('o1', 's1')],
      evaluations: [makeEvaluation('e1', 's1')],
    };
    const html = generate(data);
    expect(html).toContain('特殊なシナリオXYZ');
  });

  it('重大度ラベル（Critical/High/Medium/Low）が含まれる', () => {
    const scenarios = [
      makeScenario('c', { severity: 'Critical' }),
      makeScenario('h', { severity: 'High' }),
    ];
    const data: DashboardData = {
      plan: makePlan(),
      scenarios,
      observations: [makeObservation('o1', 'c')],
      evaluations: [makeEvaluation('e1', 'c')],
    };
    const html = generate(data);
    expect(html).toContain('Critical');
    expect(html).toContain('High');
  });
});

// ============================================================
// トレンド表示
// ============================================================

describe('dashboard.generate: トレンド', () => {
  it('過去結果が存在する場合にトレンドセクションが含まれる', () => {
    const data: DashboardData = {
      plan: makePlan(),
      scenarios: [makeScenario('s1')],
      observations: [makeObservation('o1', 's1')],
      evaluations: [makeEvaluation('e1', 's1')],
      pastResults: [
        makeResult('p1', '2024-01-01T00:00:00Z', 80),
        makeResult('p2', '2024-02-01T00:00:00Z', 85),
      ],
    };
    const html = generate(data);
    expect(html).toContain('トレンド');
    expect(html).toContain('80');
    expect(html).toContain('85');
  });

  it('過去結果が無い場合はトレンドバーが描画されない', () => {
    const data: DashboardData = {
      plan: makePlan(),
      scenarios: [makeScenario('s1')],
      observations: [makeObservation('o1', 's1')],
      evaluations: [makeEvaluation('e1', 's1')],
    };
    const html = generate(data);
    // 実際に描画されるトレンド要素(<div class="trend-chart">)が含まれない
    expect(html).not.toContain('<div class="trend-chart">');
    expect(html).toContain('<div id="trend"></div>');
  });

  it('過去結果が空配列の場合もトレンドバーは描画されない', () => {
    const data: DashboardData = {
      plan: makePlan(),
      scenarios: [makeScenario('s1')],
      observations: [makeObservation('o1', 's1')],
      evaluations: [makeEvaluation('e1', 's1')],
      pastResults: [],
    };
    const html = generate(data);
    expect(html).not.toContain('<div class="trend-chart">');
  });

  it('過去結果があるときだけ<div class="trend-chart">が描画される', () => {
    const data: DashboardData = {
      plan: makePlan(),
      scenarios: [makeScenario('s1')],
      observations: [makeObservation('o1', 's1')],
      evaluations: [makeEvaluation('e1', 's1')],
      pastResults: [makeResult('p1', '2024-01-01T00:00:00Z', 75)],
    };
    const html = generate(data);
    expect(html).toContain('<div class="trend-chart">');
  });
});

// ============================================================
// HTMLエスケープ
// ============================================================

describe('dashboard.generate: HTMLエスケープ', () => {
  it('シナリオ名中の<や&がエスケープされる', () => {
    const scenarios = [makeScenario('s1', { name: '<script>alert(1)</script> & evil' })];
    const data: DashboardData = {
      plan: makePlan(),
      scenarios,
      observations: [makeObservation('o1', 's1')],
      evaluations: [makeEvaluation('e1', 's1')],
    };
    const html = generate(data);

    // 生の <script> は含まれない
    expect(html).not.toContain('<script>alert(1)</script>');
    // エスケープ済みの形式で存在する
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });
});


// ============================================================
// 計画レポート + Rationale + ガイド + ソート
// ============================================================

describe('dashboard.generate: 計画レポート', () => {
  it('config と advice が渡されると 📊 計画レポート セクションが出力される', () => {
    const data: DashboardData = {
      plan: makePlan(),
      scenarios: [makeScenario('s1', { tags: ['llm-generated'] }), makeScenario('s2')],
      observations: [makeObservation('o1', 's1')],
      evaluations: [makeEvaluation('e1', 's1')],
      advice: '## システム構成の特徴\nテスト用構成',
      config: {
        id: 'cfg',
        name: 'test',
        sourceFormat: 'cfn-json',
        regions: ['us-east-1'],
        resources: [{ logicalId: 'WebServer', type: 'AWS::EC2::Instance', properties: {}, region: 'us-east-1' }],
        dependencies: [],
        metadata: {
          parsedAt: new Date().toISOString(),
          sourceFile: 'sample.json',
          resourceCount: 1,
          isMultiRegion: false,
          hasEncryption: false,
          hasXRayTracing: false,
        },
      },
    };
    const html = generate(data);
    expect(html).toContain('📊 計画レポート');
    expect(html).toContain('構成サマリー');
    expect(html).toContain('AI分析レポート');
    // タブにも反映される
    expect(html).toMatch(/href="#report"/);
  });

  it('config / advice が無いとレポートコンテナは空', () => {
    const data: DashboardData = {
      plan: makePlan(),
      scenarios: [makeScenario('s1')],
      observations: [],
      evaluations: [],
    };
    const html = generate(data);
    // タブ自体は常にあるが、レポート用のコンテナ (h2) は無い
    expect(html).not.toContain('構成サマリー');
    expect(html).not.toContain('AI分析レポート');
  });
});

describe('dashboard.generate: シナリオrationale & ソート', () => {
  it('rationale を持つシナリオは 📖 詳細 ボタンが出る', () => {
    const data: DashboardData = {
      plan: makePlan(),
      scenarios: [makeScenario('s1', { rationale: 'これは重要だから' })],
      observations: [],
      evaluations: [],
    };
    const html = generate(data);
    expect(html).toContain('📖 詳細');
    expect(html).toContain('これは重要だから');
    expect(html).toContain('なぜこのシナリオが必要か');
    // ソート可能なヘッダ
    expect(html).toContain('class="sortable');
    expect(html).toMatch(/data-sort="sev"/);
  });

  it('rationale も観測ポイントも無いシナリオは — 表示', () => {
    const data: DashboardData = {
      plan: makePlan(),
      scenarios: [makeScenario('s1')],
      observations: [],
      evaluations: [],
    };
    const html = generate(data);
    expect(html).toContain('scenario-no-rationale');
  });
});

describe('dashboard.generate: タイムライン rationale', () => {
  it('timelineRationales が渡されると「なぜ？」ラベルが出る', () => {
    const data: DashboardData = {
      plan: makePlan(),
      scenarios: [makeScenario('s1')],
      observations: [],
      evaluations: [],
      timelineRationales: { 0: 'まず目的を共有するため' },
    };
    const html = generate(data);
    expect(html).toContain('まず目的を共有するため');
    expect(html).toContain('tl-reason-label');
  });
});

describe('dashboard.generate: 観測ポイント（シナリオ統合）', () => {
  it('観測ポイントはシナリオ詳細に統合され、独立タブは存在しない', () => {
    const data: DashboardData = {
      plan: makePlan(),
      scenarios: [makeScenario('s1')],
      observations: [makeObservation('o1', 's1')],
      evaluations: [],
    };
    const html = generate(data);
    // シナリオ詳細に観測ポイントが出る
    expect(html).toContain('📡 観測ポイント');
    expect(html).toContain('CPUUtilization');
    expect(html).toContain('scenario-obs-table');
    // 独立した観測ポイントタブは廃止
    expect(html).not.toMatch(/href="#observations"/);
  });

  it('重大度分布タブは廃止されている', () => {
    const data: DashboardData = {
      plan: makePlan(),
      scenarios: [makeScenario('s1')],
      observations: [],
      evaluations: [],
    };
    const html = generate(data);
    expect(html).not.toMatch(/href="#severity"/);
  });

  it('評価基準はシナリオ詳細展開エリアに統合され、独立タブは存在しない', () => {
    const data: DashboardData = {
      plan: makePlan(),
      scenarios: [makeScenario('s1')],
      observations: [],
      evaluations: [
        makeEvaluation('e1', 's1'),
        { ...makeEvaluation('e2', 's1'), type: 'recovery-time' },
      ],
    };
    const html = generate(data);
    // 独立タブは廃止
    expect(html).not.toMatch(/href="#evaluations"/);
    // シナリオ詳細展開エリアに「評価基準（4軸）」が含まれる
    expect(html).toContain('✅ 評価基準（4軸）');
    // 4軸ラベル
    expect(html).toContain('検知時間');
    expect(html).toContain('復旧時間');
    expect(html).toContain('影響範囲把握度');
    expect(html).toContain('コミュニケーション');
  });
});

// ============================================================
// 容量超過 (未スケジュール) の表示
// ============================================================

describe('dashboard.generate: 容量超過の表示', () => {
  it('unscheduledScenarioIds が空のときは枠超過チップ・警告は出ない', () => {
    const data: DashboardData = {
      plan: makePlan({
        unscheduledScenarioIds: [],
        availableExecutionMinutes: 180,
        totalRequestedMinutes: 60,
      }),
      scenarios: [makeScenario('s1')],
      observations: [],
      evaluations: [],
    };
    const html = generate(data);
    expect(html).not.toContain('⚠️ 枠超過');
    expect(html).not.toContain('実施枠を超過');
    expect(html).not.toContain('⏰ 時間枠外');
  });

  it('unscheduledScenarioIds があるとヘッダ警告チップが表示される', () => {
    const data: DashboardData = {
      plan: makePlan({
        scenarios: [
          { scenarioId: 's1', executionOrder: 1, startTime: '09:00', estimatedDuration: 60 },
        ],
        unscheduledScenarioIds: ['s2'],
        availableExecutionMinutes: 60,
        totalRequestedMinutes: 120,
      }),
      scenarios: [makeScenario('s1'), makeScenario('s2', { name: 'Pushed Out Scenario' })],
      observations: [],
      evaluations: [],
    };
    const html = generate(data);
    expect(html).toContain('⚠️ 枠超過');
    expect(html).toContain('未スケジュール 1件');
  });

  it('未スケジュールシナリオは行に「⏰ 時間枠外」バッジが付く', () => {
    const data: DashboardData = {
      plan: makePlan({
        scenarios: [
          { scenarioId: 's1', executionOrder: 1, startTime: '09:00', estimatedDuration: 60 },
        ],
        unscheduledScenarioIds: ['s2'],
        availableExecutionMinutes: 60,
        totalRequestedMinutes: 120,
      }),
      scenarios: [makeScenario('s1'), makeScenario('s2', { name: 'Pushed Out' })],
      observations: [],
      evaluations: [],
    };
    const html = generate(data);
    expect(html).toContain('⏰ 時間枠外');
    expect(html).toContain('scenario-row-unscheduled');
  });

  it('容量超過時は計画レポートタブに警告ボックスが出る', () => {
    const data: DashboardData = {
      plan: makePlan({
        scenarios: [
          { scenarioId: 's1', executionOrder: 1, startTime: '09:00', estimatedDuration: 60 },
        ],
        unscheduledScenarioIds: ['s2', 's3'],
        availableExecutionMinutes: 60,
        totalRequestedMinutes: 180,
      }),
      scenarios: [
        makeScenario('s1'),
        makeScenario('s2'),
        makeScenario('s3'),
      ],
      observations: [],
      evaluations: [],
    };
    const html = generate(data);
    expect(html).toContain('実施枠を超過');
    expect(html).toContain('120分'); // overflow = 180 - 60
  });

  it('タイムラインタブの末尾に未スケジュール一覧が出る', () => {
    const data: DashboardData = {
      plan: makePlan({
        scenarios: [
          { scenarioId: 's1', executionOrder: 1, startTime: '09:00', estimatedDuration: 60 },
        ],
        unscheduledScenarioIds: ['s2'],
        availableExecutionMinutes: 60,
        totalRequestedMinutes: 120,
      }),
      scenarios: [makeScenario('s1'), makeScenario('s2', { name: 'Skipped Scenario' })],
      observations: [],
      evaluations: [],
    };
    const html = generate(data);
    expect(html).toContain('tl-unscheduled');
    expect(html).toContain('Skipped Scenario');
  });
});

// ============================================================
// シナリオ詳細展開: 説明・影響範囲・前提条件・実行ステップ・期待結果・ロールバック
// ============================================================

describe('dashboard.generate: シナリオ詳細の展開コンテンツ', () => {
  it('詳細展開エリアに 影響範囲・前提条件・実行ステップ・期待結果・ロールバック が含まれる', () => {
    const data: DashboardData = {
      plan: makePlan(),
      scenarios: [
        makeScenario('s1', {
          name: 'Detail Test',
          impactScope: '影響: 全ユーザーアクセス不能',
          prerequisites: ['前提A', '前提B'],
          steps: [
            { order: 1, action: '手順1: ログ確認', target: 'CW-Logs' },
            { order: 2, action: '手順2: フェイルオーバー', target: 'RDS' },
          ],
          expectedOutcome: '期待結果: 5分以内に自動復旧',
          rollbackSteps: ['ロールバックX', 'ロールバックY'],
          rationale: 'これは重要な検証です',
        }),
      ],
      observations: [],
      evaluations: [],
    };
    const html = generate(data);

    // 各セクションのラベルが出る
    expect(html).toContain('🎯 影響範囲');
    expect(html).toContain('✅ 前提条件');
    expect(html).toContain('🛠 実行ステップ');
    expect(html).toContain('🏁 期待される結果');
    expect(html).toContain('⏪ ロールバック手順');
    // 中身も入る
    expect(html).toContain('影響: 全ユーザーアクセス不能');
    expect(html).toContain('前提A');
    expect(html).toContain('前提B');
    expect(html).toContain('手順1: ログ確認');
    expect(html).toContain('手順2: フェイルオーバー');
    expect(html).toContain('期待結果: 5分以内に自動復旧');
    expect(html).toContain('ロールバックX');
    expect(html).toContain('これは重要な検証です');
  });

  it('説明列はnowrapではなくline-clampで折り返し対応', () => {
    const data: DashboardData = {
      plan: makePlan(),
      scenarios: [makeScenario('s1')],
      observations: [],
      evaluations: [],
    };
    const html = generate(data);
    // 旧 nowrap スタイルが消えていること
    expect(html).not.toMatch(/\.td-desc\{[^}]*white-space:nowrap[^}]*\}/);
    // 新 line-clamp スタイル
    expect(html).toMatch(/\.td-desc\{[^}]*-webkit-line-clamp/);
  });
});


// ============================================================
// シナリオ一覧の見直し（説明列削除・実施可能性バッジ・評価基準統合）
// ============================================================

describe('dashboard.generate: シナリオ一覧 v2', () => {
  it('シナリオ一覧の表ヘッダから「説明」列が削除されている', () => {
    const data: DashboardData = {
      plan: makePlan(),
      scenarios: [makeScenario('s1', { description: 'これは長い説明文' })],
      observations: [],
      evaluations: [],
    };
    const html = generate(data);
    // 表ヘッダ <th>説明</th> は無い
    expect(html).not.toMatch(/<th>説明<\/th>/);
    // 詳細展開には「📝 説明」セクションがある
    expect(html).toContain('📝 説明');
    expect(html).toContain('これは長い説明文');
  });

  it('FIS未対応 + 代替手段あり → 🛠 代替手段 バッジが付き、詳細に代替手段が表示される', () => {
    const data: DashboardData = {
      plan: makePlan(),
      scenarios: [
        makeScenario('s1', {
          name: 'S3アクセス拒否',
          executability: 'fis-alternative',
          alternativeApproach: 'バケットポリシーに Deny を追加し SSM で 5 分後に戻す',
        }),
      ],
      observations: [],
      evaluations: [],
    };
    const html = generate(data);
    expect(html).toContain('🛠 代替手段');
    expect(html).toContain('🛠 FIS未対応 — 代替手段');
    expect(html).toContain('バケットポリシーに Deny を追加し SSM で 5 分後に戻す');
  });

  it('reference-only シナリオ → 📚 参考 バッジが付き、参考シナリオブロックが出る', () => {
    const data: DashboardData = {
      plan: makePlan(),
      scenarios: [
        makeScenario('s1', {
          name: 'ランサムウェア感染シミュレーション',
          executability: 'reference-only',
          alternativeApproach: '机上演習として復旧手順を議論する',
        }),
      ],
      observations: [],
      evaluations: [],
    };
    const html = generate(data);
    expect(html).toContain('📚 参考');
    expect(html).toContain('参考シナリオ — 実環境での再現は困難');
    expect(html).toContain('机上演習として復旧手順を議論する');
  });

  it('時間枠外バッジ付きの行は scenario-row-unscheduled クラスを持ち、デフォルトで最下部', () => {
    const data: DashboardData = {
      plan: makePlan({
        scenarios: [
          { scenarioId: 's1', executionOrder: 1, startTime: '09:00', estimatedDuration: 30 },
          { scenarioId: 's2', executionOrder: 2, startTime: '09:30', estimatedDuration: 30 },
        ],
        unscheduledScenarioIds: ['s3'],
        availableExecutionMinutes: 60,
        totalRequestedMinutes: 90,
      }),
      // s3 を最初に置いても、表に現れる順は s1, s2 (採用) → s3 (時間枠外) であるべき
      scenarios: [
        makeScenario('s3', { name: 'Skipped', severity: 'High' }),
        makeScenario('s1', { name: 'First', severity: 'Critical' }),
        makeScenario('s2', { name: 'Second', severity: 'High' }),
      ],
      observations: [],
      evaluations: [],
    };
    const html = generate(data);
    // 時間枠外行のクラス名が存在
    expect(html).toContain('scenario-row-unscheduled');
    // 表中で First の位置 < Skipped の位置 (Skipped は最下部)
    const firstIdx = html.indexOf('First</strong>');
    const skippedIdx = html.indexOf('Skipped</strong>');
    expect(firstIdx).toBeGreaterThan(0);
    expect(skippedIdx).toBeGreaterThan(0);
    expect(firstIdx).toBeLessThan(skippedIdx);
  });

  it('シナリオ詳細展開に評価基準が統合される (✅ N バッジ + 4軸セル)', () => {
    const data: DashboardData = {
      plan: makePlan(),
      scenarios: [makeScenario('s1', { name: 'Eval Test' })],
      observations: [],
      evaluations: [
        makeEvaluation('e1', 's1'),
        { ...makeEvaluation('e2', 's1'), type: 'recovery-time' },
      ],
    };
    const html = generate(data);
    // 詳細展開ボタンに ✅2 バッジ
    expect(html).toMatch(/scenario-detail-mini-badge[^>]*>✅2/);
    // 4軸ラベル
    expect(html).toContain('✅ 評価基準（4軸）');
    expect(html).toContain('検知時間');
    expect(html).toContain('復旧時間');
  });
});

// ============================================================
// FIS カードトグル CSS バグ修正
// ============================================================

describe('dashboard.generate: FIS カードトグル', () => {
  it('fis-card-body[hidden] スタイルがあり、display:flex に勝てる', () => {
    const data: DashboardData = {
      plan: makePlan(),
      scenarios: [makeScenario('s1')],
      observations: [],
      evaluations: [],
    };
    const html = generate(data);
    expect(html).toContain('.fis-card-body[hidden]{display:none !important}');
  });
});

// ============================================================
// タイムライン未スケジュールの折りたたみ
// ============================================================

describe('dashboard.generate: タイムライン未スケジュールの折りたたみ', () => {
  it('未スケジュールが多い (4件以上) ときは details closed で出力される', () => {
    const unscheduledIds = ['s2', 's3', 's4', 's5'];
    const data: DashboardData = {
      plan: makePlan({
        scenarios: [
          { scenarioId: 's1', executionOrder: 1, startTime: '09:00', estimatedDuration: 30 },
        ],
        unscheduledScenarioIds: unscheduledIds,
        availableExecutionMinutes: 30,
        totalRequestedMinutes: 150,
      }),
      scenarios: [
        makeScenario('s1'),
        ...unscheduledIds.map(id => makeScenario(id, { name: `Skipped ${id}` })),
      ],
      observations: [],
      evaluations: [],
    };
    const html = generate(data);
    // <details class="tl-unscheduled" > (open なし)
    expect(html).toMatch(/<details class="tl-unscheduled"\s*>/);
    expect(html).toContain('⏰ 未スケジュール（4件）');
  });

  it('未スケジュールが少ない (1〜3件) ときは details open で出力される', () => {
    const data: DashboardData = {
      plan: makePlan({
        scenarios: [
          { scenarioId: 's1', executionOrder: 1, startTime: '09:00', estimatedDuration: 30 },
        ],
        unscheduledScenarioIds: ['s2'],
        availableExecutionMinutes: 30,
        totalRequestedMinutes: 60,
      }),
      scenarios: [makeScenario('s1'), makeScenario('s2', { name: 'Just one' })],
      observations: [],
      evaluations: [],
    };
    const html = generate(data);
    expect(html).toMatch(/<details class="tl-unscheduled" open>/);
  });
});
