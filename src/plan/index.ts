import crypto from 'node:crypto';
import type {
  FailureScenario,
  GameDayPlan,
  PlanOptions,
  EscalationStep,
} from '../types/index.js';
import { assignRoles } from './roles.js';
import {
  sortBySeverity,
  buildPlannedScenarios,
  buildTimeline,
  partitionByCapacity,
  getAvailableExecutionMinutes,
} from './timeline.js';

// ============================================================
// 計画ジェネレータ
// ============================================================

const DURATION_LABELS: Record<PlanOptions['duration'], string> = {
  'half-day': '半日（09:00〜13:00）',
  'full-day': '1日（09:00〜17:00）',
  'two-day': '2日間（Day1 09:00〜17:00, Day2 09:00〜17:00）',
};

/**
 * デフォルトのエスカレーションフローを生成する。
 */
function buildEscalationFlow(): EscalationStep[] {
  return [
    {
      condition: '障害が30分以上復旧しない場合',
      action: 'チームリーダーへ報告し、追加リソースの投入を検討',
      contactRole: 'facilitator',
    },
    {
      condition: '本番環境への影響が検知された場合',
      action: '即座にロールバックを実行し、マネージャーへエスカレーション',
      contactRole: 'facilitator',
    },
    {
      condition: '参加者の安全に関わる問題が発生した場合',
      action: 'GameDayを即座に中止し、全参加者へ通知',
      contactRole: 'facilitator',
    },
    {
      condition: 'シナリオの前提条件が満たされていない場合',
      action: '該当シナリオをスキップし、次のシナリオへ進む',
      contactRole: 'operator',
    },
  ];
}

/**
 * シナリオ一覧とオプションからGameDay実施計画を生成する。
 *
 * 重要: シナリオ合計が duration の枠を超える場合、重大度順で枠に収まる分だけを
 * タイムラインに採用し、残りは `unscheduledScenarioIds` に分離する。
 */
export function generate(
  scenarios: FailureScenario[],
  options: PlanOptions,
): GameDayPlan {
  const sorted = sortBySeverity(scenarios);
  const { included, unscheduled } = partitionByCapacity(sorted, options.duration);
  const roles = assignRoles(options.participantCount);
  const timeline = buildTimeline(included, options);

  // 準備フェーズ終了後の時刻を取得（最初のexecutionエントリの時刻）
  const executionStart = timeline.find((e) => e.type === 'execution')?.time ?? '09:30';
  const plannedScenarios = buildPlannedScenarios(included, executionStart);

  const totalRequestedMinutes = sorted.reduce((sum, s) => sum + s.estimatedDuration, 0);

  return {
    id: crypto.randomUUID(),
    title: `GameDay実施計画 - ${DURATION_LABELS[options.duration]}`,
    duration: options.duration,
    scenarios: plannedScenarios,
    roles,
    timeline,
    escalationFlow: buildEscalationFlow(),
    unscheduledScenarioIds: unscheduled.map((s) => s.id),
    availableExecutionMinutes: getAvailableExecutionMinutes(options.duration),
    totalRequestedMinutes,
  };
}

// ============================================================
// Markdown変換
// ============================================================

/**
 * GameDay実施計画をMarkdown形式に変換する。
 */
export function toMarkdown(
  plan: GameDayPlan,
  scenarios?: FailureScenario[],
): string {
  const lines: string[] = [];

  // ヘッダー
  lines.push(`# ${plan.title}`);
  lines.push('');
  lines.push(`- **計画ID**: ${plan.id}`);
  lines.push(`- **実施形式**: ${DURATION_LABELS[plan.duration]}`);
  lines.push('');

  // 容量警告（実施枠を超えている場合）
  if (plan.unscheduledScenarioIds.length > 0) {
    const overflow = plan.totalRequestedMinutes - plan.availableExecutionMinutes;
    lines.push(`> ⚠️ **シナリオ全体の所要時間が実施枠を ${overflow} 分超過しています。**`);
    lines.push(`> 重大度の高いシナリオから順に ${plan.scenarios.length} 件をタイムラインに採用し、残り ${plan.unscheduledScenarioIds.length} 件は「未スケジュール」セクションにまとめています。`);
    lines.push('');
  }

  // 役割分担
  lines.push('## 役割分担');
  lines.push('');
  lines.push('| 役割 | 人数 | 説明 |');
  lines.push('|------|------|------|');
  for (const role of plan.roles) {
    const roleName = getRoleLabel(role.role);
    lines.push(`| ${roleName} | ${role.assignedCount}名 | ${role.description} |`);
  }
  lines.push('');

  // 役割ごとの責務
  for (const role of plan.roles) {
    lines.push(`### ${getRoleLabel(role.role)}の責務`);
    lines.push('');
    for (const resp of role.responsibilities) {
      lines.push(`- ${resp}`);
    }
    lines.push('');
  }

  // タイムライン
  lines.push('## タイムライン');
  lines.push('');
  lines.push('| 時刻 | 種別 | 内容 |');
  lines.push('|------|------|------|');
  for (const entry of plan.timeline) {
    const typeLabel = getTimelineTypeLabel(entry.type);
    lines.push(`| ${entry.time} | ${typeLabel} | ${entry.activity} |`);
  }
  lines.push('');

  // 実行手順
  lines.push('## 実行手順');
  lines.push('');
  for (const planned of plan.scenarios) {
    const scenario = scenarios?.find((s) => s.id === planned.scenarioId);
    lines.push(`### ${planned.executionOrder}. ${scenario?.name ?? planned.scenarioId}`);
    lines.push('');
    lines.push(`- **開始時刻**: ${planned.startTime}`);
    lines.push(`- **想定所要時間**: ${planned.estimatedDuration}分`);
    if (scenario) {
      lines.push(`- **重大度**: ${scenario.severity}`);
      lines.push(`- **カテゴリ**: ${scenario.category}`);
      lines.push(`- **影響範囲**: ${scenario.impactScope}`);
      lines.push('');
      lines.push('**前提条件:**');
      for (const prereq of scenario.prerequisites) {
        lines.push(`- ${prereq}`);
      }
      lines.push('');
      lines.push('**実行ステップ:**');
      for (const step of scenario.steps) {
        lines.push(`${step.order}. ${step.action}（対象: ${step.target}）`);
      }
      lines.push('');
      lines.push(`**期待される結果:** ${scenario.expectedOutcome}`);
      lines.push('');
      lines.push('**ロールバック手順:**');
      for (const rb of scenario.rollbackSteps) {
        lines.push(`- ${rb}`);
      }
    }
    lines.push('');
  }

  // エスカレーションフロー
  lines.push('## エスカレーションフロー');
  lines.push('');
  lines.push('| 条件 | アクション | 連絡先 |');
  lines.push('|------|-----------|--------|');
  for (const step of plan.escalationFlow) {
    lines.push(`| ${step.condition} | ${step.action} | ${getRoleLabel(step.contactRole)} |`);
  }
  lines.push('');

  // 未スケジュールのシナリオ
  if (plan.unscheduledScenarioIds.length > 0) {
    lines.push('## 未スケジュールのシナリオ');
    lines.push('');
    lines.push('実施枠の都合でタイムラインに組み込めなかったシナリオです。次回 GameDay の優先候補として検討してください。');
    lines.push('');
    lines.push('| # | シナリオ名 | 重大度 | カテゴリ | 想定時間 |');
    lines.push('|---|------------|--------|----------|----------|');
    plan.unscheduledScenarioIds.forEach((id, i) => {
      const sc = scenarios?.find((s) => s.id === id);
      if (!sc) {
        lines.push(`| ${i + 1} | ${id} | — | — | — |`);
        return;
      }
      lines.push(`| ${i + 1} | ${sc.name} | ${sc.severity} | ${sc.category} | ${sc.estimatedDuration}分 |`);
    });
    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================
// ヘルパー
// ============================================================

function getRoleLabel(role: string): string {
  switch (role) {
    case 'facilitator': return 'ファシリテーター';
    case 'operator': return 'オペレーター';
    case 'observer': return 'オブザーバー';
    default: return role;
  }
}

function getTimelineTypeLabel(type: string): string {
  switch (type) {
    case 'preparation': return '準備';
    case 'execution': return '実行';
    case 'review': return '振り返り';
    case 'break': return '休憩';
    default: return type;
  }
}
