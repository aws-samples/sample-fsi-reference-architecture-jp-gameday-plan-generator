import type {
  FailureScenario,
  PlannedScenario,
  TimelineEntry,
  PlanOptions,
} from '../types/index.js';

// ============================================================
// 重大度ソート
// ============================================================

const SEVERITY_ORDER: Record<string, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

/**
 * シナリオを重大度の降順（Critical → High → Medium → Low）でソートする。
 * 同一重大度の場合は元の順序を維持する（安定ソート）。
 */
export function sortBySeverity(scenarios: FailureScenario[]): FailureScenario[] {
  return [...scenarios].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99),
  );
}

// ============================================================
// Duration テンプレート定義
// ============================================================

interface DurationTemplate {
  /** 利用可能な合計時間（分） */
  totalMinutes: number;
  /** 開始時刻 */
  startTime: string;
  /** 終了時刻 */
  endTime: string;
  /** 準備時間（分） */
  preparationMinutes: number;
  /** 振り返り時間（分） */
  reviewMinutes: number;
  /** 2日間の場合の2日目開始時刻 */
  day2StartTime?: string;
}

const DURATION_TEMPLATES: Record<PlanOptions['duration'], DurationTemplate> = {
  'half-day': {
    totalMinutes: 240,   // 4時間
    startTime: '09:00',
    endTime: '13:00',
    preparationMinutes: 30,
    reviewMinutes: 30,
  },
  'full-day': {
    totalMinutes: 480,   // 8時間
    startTime: '09:00',
    endTime: '17:00',
    preparationMinutes: 45,
    reviewMinutes: 45,
  },
  'two-day': {
    totalMinutes: 960,   // 16時間
    startTime: '09:00',
    endTime: '17:00',
    preparationMinutes: 45,
    reviewMinutes: 60,
    day2StartTime: '09:00',
  },
};

/**
 * シナリオ実行に使える純粋な分数（duration 全体から準備・振り返りを除いたもの）。
 * 休憩は実行枠と並行して扱うのではなく、ここに含めず buildTimeline 側で 2h ごとに 15 分挿入する。
 * このため、実際にスケジュール可能なシナリオ合計 ≤ availableExecutionMinutes - (休憩回数 * 15)。
 */
export function getAvailableExecutionMinutes(duration: PlanOptions['duration']): number {
  const t = DURATION_TEMPLATES[duration];
  return t.totalMinutes - t.preparationMinutes - t.reviewMinutes;
}

/**
 * 重大度順にソート済みのシナリオから、利用可能枠に収まる分だけを採用する。
 * - included: タイムラインに組み込まれるシナリオ
 * - unscheduled: 枠を超えて押し出されたシナリオ（重大度の低いものから外れる）
 *
 * 休憩は 2 時間ごとに 15 分を挟む前提で、シナリオ実行時間 + 想定休憩時間が
 * availableExecutionMinutes 以下に収まるようにする。
 */
export function partitionByCapacity(
  sortedScenarios: FailureScenario[],
  duration: PlanOptions['duration'],
): { included: FailureScenario[]; unscheduled: FailureScenario[] } {
  const capacity = getAvailableExecutionMinutes(duration);
  const included: FailureScenario[] = [];
  let usedMinutes = 0;
  let minutesSinceBreak = 0;

  for (let i = 0; i < sortedScenarios.length; i++) {
    const scenario = sortedScenarios[i];
    // 単体で枠を超える巨大シナリオは無視せず、最低 1 件は入れたい。
    // ただし「もう何かが入っていて、追加で入れると枠を超える」場合はそこで打ち切り。
    const breakNeeded = minutesSinceBreak >= 120 ? 15 : 0;
    const wouldUse = usedMinutes + breakNeeded + scenario.estimatedDuration;
    if (included.length > 0 && wouldUse > capacity) {
      return {
        included,
        unscheduled: sortedScenarios.slice(i),
      };
    }
    included.push(scenario);
    usedMinutes += breakNeeded + scenario.estimatedDuration;
    minutesSinceBreak = breakNeeded > 0 ? scenario.estimatedDuration : minutesSinceBreak + scenario.estimatedDuration;
  }
  return { included, unscheduled: [] };
}

// ============================================================
// ヘルパー関数
// ============================================================

/** "HH:mm" 形式の時刻に分を加算する */
function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const totalMin = h * 60 + m + minutes;
  const newH = Math.floor(totalMin / 60) % 24;
  const newM = totalMin % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

// ============================================================
// PlannedScenario 生成
// ============================================================

/**
 * ソート済みシナリオから PlannedScenario 配列を生成する。
 * 各シナリオの startTime はタイムライン上の実行開始時刻。
 */
export function buildPlannedScenarios(
  sortedScenarios: FailureScenario[],
  executionStartTime: string,
): PlannedScenario[] {
  let currentTime = executionStartTime;
  return sortedScenarios.map((scenario, index) => {
    const planned: PlannedScenario = {
      scenarioId: scenario.id,
      executionOrder: index + 1,
      startTime: currentTime,
      estimatedDuration: scenario.estimatedDuration,
    };
    currentTime = addMinutes(currentTime, scenario.estimatedDuration);
    return planned;
  });
}

// ============================================================
// タイムライン生成
// ============================================================

/**
 * シナリオ一覧とオプションからタイムラインを生成する。
 * - 準備 → シナリオ実行（休憩挟む） → 振り返り
 * - 2時間ごとに15分の休憩を挿入
 */
export function buildTimeline(
  sortedScenarios: FailureScenario[],
  options: PlanOptions,
): TimelineEntry[] {
  const template = DURATION_TEMPLATES[options.duration];
  const entries: TimelineEntry[] = [];
  let currentTime = template.startTime;

  // 準備フェーズ
  entries.push({
    time: currentTime,
    activity: 'オープニング・目的説明・環境確認',
    type: 'preparation',
  });
  currentTime = addMinutes(currentTime, template.preparationMinutes);

  // シナリオ実行フェーズ
  let minutesSinceBreak = 0;

  for (const scenario of sortedScenarios) {
    // 2時間（120分）経過ごとに休憩を挿入
    if (minutesSinceBreak >= 120) {
      entries.push({
        time: currentTime,
        activity: '休憩',
        type: 'break',
      });
      currentTime = addMinutes(currentTime, 15);
      minutesSinceBreak = 0;
    }

    entries.push({
      time: currentTime,
      activity: `シナリオ実行: ${scenario.name}`,
      scenarioId: scenario.id,
      type: 'execution',
    });
    currentTime = addMinutes(currentTime, scenario.estimatedDuration);
    minutesSinceBreak += scenario.estimatedDuration;
  }

  // 振り返りの前に休憩（シナリオ実行後）
  if (sortedScenarios.length > 0 && minutesSinceBreak > 0) {
    entries.push({
      time: currentTime,
      activity: '休憩',
      type: 'break',
    });
    currentTime = addMinutes(currentTime, 15);
  }

  // 振り返りフェーズ
  entries.push({
    time: currentTime,
    activity: '振り返り・評価・改善点の議論',
    type: 'review',
  });

  return entries;
}

/**
 * タイムラインの合計実行時間（分）を算出する。
 * execution タイプのエントリの所要時間合計。
 */
export function getTimelineTotalExecutionMinutes(
  sortedScenarios: FailureScenario[],
): number {
  return sortedScenarios.reduce((sum, s) => sum + s.estimatedDuration, 0);
}

// ============================================================
// タイムライン理由 (rationale) 生成
// ============================================================

const SEVERITY_LABELS_JP: Record<string, string> = {
  Critical: '最優先 (Critical)',
  High: '高 (High)',
  Medium: '中 (Medium)',
  Low: '低 (Low)',
};

/**
 * タイムラインエントリ毎に、なぜその時間/順序なのかの説明を生成する。
 *
 * - preparation: オープニング
 * - execution: 「重大度 X だから N 番目」+ 想定影響
 * - break: 集中力維持のための休憩
 * - review: 全体振り返り
 *
 * 戻り値は entry のインデックスをキーとした Map (Object)。
 */
export function buildTimelineRationales(
  entries: TimelineEntry[],
  scenarios: FailureScenario[],
): Record<number, string> {
  const scenarioMap = new Map(scenarios.map(s => [s.id, s]));
  const rationales: Record<number, string> = {};

  // execution タイプの中で何番目かカウント
  let executionIdx = 0;
  const totalExecutions = entries.filter(e => e.type === 'execution').length;

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    switch (e.type) {
      case 'preparation':
        rationales[i] =
          'GameDayの目的・ルール・環境（観測ダッシュボード、エスカレーション窓口）を全員で共有する。' +
          '訓練の効果を最大化するために、最初に認識を揃えておくことが重要。';
        break;

      case 'execution': {
        executionIdx++;
        const scenario = e.scenarioId ? scenarioMap.get(e.scenarioId) : undefined;
        if (!scenario) {
          rationales[i] = `シナリオ ${executionIdx}/${totalExecutions} を実行。`;
          break;
        }
        const sevLabel = SEVERITY_LABELS_JP[scenario.severity] ?? scenario.severity;
        const reason =
          executionIdx === 1
            ? `重大度 ${sevLabel} の最も影響が大きいシナリオから着手。意思決定経路や検知体制が機能するかを最初に確認するのが鉄則。`
            : executionIdx === totalExecutions
              ? `重大度の高い順から進めてきた最後のシナリオ。疲労や慣れがあっても基本動作が保てるかを検証する位置付け。`
              : `重大度 ${sevLabel}。前のシナリオの学びを反映しつつ、影響範囲・所要時間 ${scenario.estimatedDuration} 分を見込んで配置。`;
        rationales[i] = `${reason} 影響範囲: ${scenario.impactScope || '—'}`;
        break;
      }

      case 'break':
        rationales[i] =
          '集中力と判断力を保つための休憩。連続2時間以上の実行を避けることで、観測の見落としや誤操作を減らす。';
        break;

      case 'review':
        rationales[i] =
          '記憶が新鮮なうちに、検知時間・復旧時間・コミュニケーションを定量的に振り返る。' +
          '改善点を Runbook やアラーム設計にフィードバックすることが GameDay の本質的な価値。';
        break;
    }
  }

  return rationales;
}
