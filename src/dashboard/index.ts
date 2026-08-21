import type {
  DashboardData,
  GameDayPlan,
  FailureScenario,
  ObservationPoint,
  EvaluationCriteria,
  GameDayResult,
  FISDeploymentInfo,
  InfraConfig,
} from '../types/index.js';
import { mdToHtml } from './markdown.js';
import { renderTopNav, renderSideNav, navChromeCss } from '../web/pages/layout.js';

// ============================================================
// Severity helpers
// ============================================================

const SEVERITY_COLORS: Record<string, string> = {
  Critical: '#d91515',
  High: '#ff9900',
  Medium: '#0972d3',
  Low: '#037f0c',
};

// ============================================================
// HTML escape
// ============================================================

function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============================================================
// Section renderers
// ============================================================

function renderHeader(plan: GameDayPlan): string {
  const dl = plan.duration === 'half-day' ? '半日' : plan.duration === 'full-day' ? '1日' : '2日';
  const unscheduledIds = plan.unscheduledScenarioIds ?? [];
  const totalRequested = plan.totalRequestedMinutes ?? 0;
  const available = plan.availableExecutionMinutes ?? 0;
  const overflowMin = totalRequested - available;
  const hasOverflow = unscheduledIds.length > 0;
  const overflowChip = hasOverflow
    ? `<div class="awsui-kv-chip awsui-kv-chip-warning" title="シナリオ合計が実施枠を超過。重大度の高いものから採用し、残りは『未スケジュール』に分離"><span class="awsui-kv-chip-label">⚠️ 枠超過</span><span class="awsui-kv-chip-value">+${overflowMin}分 / 未スケジュール ${unscheduledIds.length}件</span></div>`
    : '';
  return `
  <div class="awsui-content-header">
    <h1 class="awsui-heading-l">${esc(plan.title)}</h1>
    <p class="awsui-text-secondary">計画ID: ${esc(plan.id)}</p>
  </div>
  <div class="awsui-kv-bar">
    <div class="awsui-kv-chip"><span class="awsui-kv-chip-label">実施形式</span><span class="awsui-kv-chip-value">${dl}</span></div>
    <div class="awsui-kv-chip"><span class="awsui-kv-chip-label">予定シナリオ</span><span class="awsui-kv-chip-value">${plan.scenarios.length}件</span></div>
    <div class="awsui-kv-chip"><span class="awsui-kv-chip-label">参加者</span><span class="awsui-kv-chip-value">${plan.roles.reduce((s, r) => s + r.assignedCount, 0)}名</span></div>
    ${overflowChip}
  </div>`;
}

// ============================================================
// 観測ポイント整形ヘルパー（シナリオ展開部・観測タブ共通）
// ============================================================

const OBS_TYPE_LABELS: Record<string, string> = {
  metric: 'メトリクス',
  alarm: 'アラーム',
  'log-filter': 'ログフィルタ',
  'xray-trace': 'X-Rayトレース',
};

const OBS_TIMING_LABELS: Record<string, string> = {
  before: '実施前',
  during: '実施中',
  after: '実施後',
};

function obsTypeBadge(t: string): string {
  const m: Record<string, string> = {
    metric: 'awsui-badge-blue',
    alarm: 'awsui-badge-red',
    'log-filter': 'awsui-badge-grey',
    'xray-trace': 'awsui-badge-green',
  };
  return `<span class="awsui-badge ${m[t] ?? 'awsui-badge-grey'}">${OBS_TYPE_LABELS[t] ?? t}</span>`;
}

function obsFormatRange(o: ObservationPoint): string {
  const { min, max } = o.normalRange;
  if (min !== undefined && max !== undefined) return `${min} 〜 ${max}`;
  if (max !== undefined) return `≤ ${max}`;
  if (min !== undefined) return `≥ ${min}`;
  return '—';
}

function obsFormatTarget(o: ObservationPoint): string {
  const cfg = o.cloudwatchConfig;
  if (cfg.namespace && cfg.metricName) {
    return `<code class="awsui-code">${esc(cfg.namespace)} / ${esc(cfg.metricName)}</code>`;
  }
  if (cfg.logGroupName) {
    return `<code class="awsui-code">LogGroup: ${esc(cfg.logGroupName)}</code>`;
  }
  return '<span class="awsui-text-secondary">—</span>';
}

/** 1シナリオに紐づく観測ポイントを小さなテーブルで表示する */
function renderScenarioObservations(obs: ObservationPoint[]): string {
  if (!obs.length) {
    return '<div class="scenario-obs-empty">このシナリオに紐づく観測ポイントはありません</div>';
  }
  const rows = obs
    .map(o => {
      const timing = OBS_TIMING_LABELS[o.checkTiming] ?? o.checkTiming;
      return `<tr>
        <td>${esc(o.name)} ${obsTypeBadge(o.type)}</td>
        <td>${obsFormatTarget(o)}</td>
        <td class="obs-cell-ok">${obsFormatRange(o)}</td>
        <td class="obs-cell-ng">&gt; ${o.threshold}</td>
        <td><span class="awsui-badge awsui-badge-grey">${timing}</span></td>
      </tr>`;
    })
    .join('');
  return `<div class="scenario-detail-section scenario-obs">
    <div class="scenario-detail-section-label">📡 観測ポイント（${obs.length}件）</div>
    <div class="awsui-table-wrap"><table class="scenario-obs-table">
      <thead><tr><th>観測項目</th><th>観測対象</th><th>正常範囲</th><th>異常閾値</th><th>タイミング</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}

/** 1シナリオに紐づく評価基準を 4 軸ミニカードで表示する */
function renderScenarioEvaluations(evals: EvaluationCriteria[]): string {
  if (!evals.length) return '';
  const typeLabels: Record<string, string> = {
    'detection-time': '検知時間',
    'recovery-time': '復旧時間',
    'impact-accuracy': '影響範囲把握度',
    communication: 'コミュニケーション',
  };
  const typeIcons: Record<string, string> = {
    'detection-time': '⏱',
    'recovery-time': '🔧',
    'impact-accuracy': '🎯',
    communication: '💬',
  };
  const typeOrder = ['detection-time', 'recovery-time', 'impact-accuracy', 'communication'] as const;
  const byType = new Map(evals.map(c => [c.type, c]));
  const formatPass = (c: EvaluationCriteria): string => {
    const unit = c.unit === 'minutes' ? '分' : c.unit === 'percent' ? '%' : c.unit;
    if (c.type === 'detection-time' || c.type === 'recovery-time') return `≤ ${c.passThreshold}${unit}`;
    return `≥ ${c.passThreshold}${unit}`;
  };
  const formatFail = (c: EvaluationCriteria): string => {
    const unit = c.unit === 'minutes' ? '分' : c.unit === 'percent' ? '%' : c.unit;
    if (c.type === 'detection-time' || c.type === 'recovery-time') return `> ${c.failThreshold}${unit}`;
    return `< ${c.failThreshold}${unit}`;
  };
  const cells = typeOrder.map(type => {
    const c = byType.get(type);
    const label = typeLabels[type];
    const icon = typeIcons[type];
    if (!c) {
      return `<div class="eval-cell eval-cell-empty"><div class="eval-cell-label">${icon} ${label}</div><div class="eval-cell-empty-text">—</div></div>`;
    }
    return `<div class="eval-cell">
      <div class="eval-cell-label">${icon} ${label}</div>
      <div class="eval-cell-thresholds">
        <span class="eval-pass">合格 ${formatPass(c)}</span>
        <span class="eval-fail">不合格 ${formatFail(c)}</span>
      </div>
    </div>`;
  }).join('');
  return `<div class="scenario-detail-section">
    <div class="scenario-detail-section-label">✅ 評価基準（4軸）</div>
    <div class="eval-cells">${cells}</div>
    <div class="scenario-eval-hint">合格/不合格は GameDay 実施後に手動で記入し、Runbook 改善に活用してください。</div>
  </div>`;
}

function renderScenarios(
  scenarios: FailureScenario[],
  fisDeployments?: FISDeploymentInfo[],
  observations: ObservationPoint[] = [],
  unscheduledIds: Set<string> = new Set(),
): string {
  if (!scenarios.length) return '';
  const categoryLabels: Record<string, string> = {
    infrastructure: 'インフラ',
    network: 'ネットワーク',
    data: 'データ',
    security: 'セキュリティ',
    operation: '運用',
  };
  const fisSet = new Set((fisDeployments ?? []).map(d => d.scenarioId));
  const showFisCol = fisDeployments && fisDeployments.length > 0;
  const sevRank: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };

  // シナリオID → 観測ポイント
  const obsByScenario = new Map<string, ObservationPoint[]>();
  for (const o of observations) {
    const arr = obsByScenario.get(o.scenarioId) ?? [];
    arr.push(o);
    obsByScenario.set(o.scenarioId, arr);
  }

  // ── シナリオを「タイムライン採用」と「時間枠外」に分けて、デフォルトは重大度順 ──
  const sortedByDefault = [...scenarios].sort((a, b) => {
    const aOut = unscheduledIds.has(a.id) ? 1 : 0;
    const bOut = unscheduledIds.has(b.id) ? 1 : 0;
    if (aOut !== bOut) return aOut - bOut; // 時間枠内が先
    return (sevRank[a.severity] ?? 99) - (sevRank[b.severity] ?? 99);
  });

  const renderRow = (s: FailureScenario, idx: number): string => {
    const col = SEVERITY_COLORS[s.severity] ?? '#5f6b7a';
    const cat = categoryLabels[s.category] ?? s.category;
    const sortKey = sevRank[s.severity] ?? 99;
    const scenarioObs = obsByScenario.get(s.id) ?? [];
    const obsCount = scenarioObs.length;
    const isUnscheduled = unscheduledIds.has(s.id);
    const statusKey = isUnscheduled ? 1 : 0; // 時間枠内=0 / 外=1
    const unscheduledBadge = isUnscheduled
      ? `<span class="awsui-badge awsui-badge-grey scenario-unscheduled-badge" title="実施枠の都合で未スケジュール。重大度の高い他シナリオを優先">⏰ 時間枠外</span>`
      : '';

    // 実施可能性バッジ
    const executability: FailureScenario['executability'] =
      s.executability ?? (fisSet.has(s.id) ? 'fis-supported' : undefined);
    let execBadge = '';
    if (executability === 'fis-alternative') {
      execBadge = `<span class="awsui-badge awsui-badge-blue scenario-exec-badge" title="FIS未対応。代替手段で実施可">🛠 代替手段</span>`;
    } else if (executability === 'reference-only') {
      execBadge = `<span class="awsui-badge awsui-badge-grey scenario-exec-badge" title="実環境での再現が難しい。参考シナリオとして検討用">📚 参考</span>`;
    }

    const fisCell = !showFisCol
      ? ''
      : fisSet.has(s.id)
        ? `<td><a href="#fis" class="fis-jump-btn" data-fis-target="${esc(s.id)}" title="FIS実験テンプレートへジャンプ">🚀 FIS</a></td>`
        : `<td><span class="fis-jump-na" title="${executability === 'reference-only' ? '実環境での再現が難しいため、参考シナリオ扱い' : 'FIS未対応。詳細を開いて代替手段を確認'}">—</span></td>`;

    // 詳細トグル
    const hasExtra =
      s.impactScope.length > 0 ||
      s.prerequisites.length > 0 ||
      s.steps.length > 0 ||
      s.expectedOutcome.length > 0 ||
      s.rollbackSteps.length > 0;
    const evalsForScenario = s.evaluations ?? [];
    const altBlock = !!s.alternativeApproach;
    const hasDetail =
      !!s.rationale || obsCount > 0 || hasExtra || evalsForScenario.length > 0 || altBlock;
    const detailBadges: string[] = [];
    if (obsCount > 0) detailBadges.push(`<span class="scenario-detail-mini-badge">📡${obsCount}</span>`);
    if (evalsForScenario.length > 0) detailBadges.push(`<span class="scenario-detail-mini-badge">✅${evalsForScenario.length}</span>`);
    const detailCell = hasDetail
      ? `<td><button class="scenario-toggle" data-target="detail-${idx}" aria-expanded="false" title="シナリオ詳細・観測ポイント・評価基準を表示"><span class="scenario-toggle-label">📖 詳細</span>${detailBadges.join('')}</button></td>`
      : `<td><span class="scenario-no-rationale">—</span></td>`;
    const fisColspanExtra = showFisCol ? 1 : 0;

    const rowClass = isUnscheduled ? 'scenario-row scenario-row-unscheduled' : 'scenario-row';
    const mainRow = `<tr class="${rowClass}" data-sev="${s.severity}" data-cat="${esc(s.category)}" data-sort-sev="${sortKey}" data-sort-name="${esc(s.name.toLowerCase())}" data-sort-dur="${s.estimatedDuration}" data-sort-status="${statusKey}">
      <td><strong>${esc(s.name)}</strong>${unscheduledBadge}${execBadge}</td>
      <td>${cat}</td>
      <td><span class="awsui-status-dot" style="background:${col}"></span>${s.severity}</td>
      <td>${s.estimatedDuration}分</td>
      ${detailCell}
      ${fisCell}
    </tr>`;

    const rationaleBlock = s.rationale
      ? `<div class="scenario-detail-section scenario-rationale-box">
          <div class="scenario-rationale-label">なぜこのシナリオが必要か</div>
          <div class="scenario-rationale-text">${esc(s.rationale)}</div>
        </div>`
      : '';

    const descriptionBlock =
      `<div class="scenario-detail-section">
        <div class="scenario-detail-section-label">📝 説明</div>
        <div class="scenario-detail-section-body">${esc(s.description)}</div>
      </div>`;

    const impactBlock = s.impactScope
      ? `<div class="scenario-detail-section">
          <div class="scenario-detail-section-label">🎯 影響範囲</div>
          <div class="scenario-detail-section-body">${esc(s.impactScope)}</div>
        </div>`
      : '';

    // 代替手段ブロック (FIS未対応シナリオの実施手段)
    let executabilityBlock = '';
    if (executability === 'fis-alternative' && s.alternativeApproach) {
      executabilityBlock = `<div class="scenario-detail-section scenario-detail-alt">
        <div class="scenario-detail-section-label">🛠 FIS未対応 — 代替手段</div>
        <div class="scenario-detail-section-body">${esc(s.alternativeApproach)}</div>
      </div>`;
    } else if (executability === 'reference-only') {
      executabilityBlock = `<div class="scenario-detail-section scenario-detail-ref">
        <div class="scenario-detail-section-label">📚 参考シナリオ — 実環境での再現は困難</div>
        <div class="scenario-detail-section-body">${esc(s.alternativeApproach || '本シナリオは実環境での完全再現が難しいため、机上演習やドキュメントレビューを通じて備えとして検討してください。')}</div>
      </div>`;
    }

    const prereqBlock = s.prerequisites.length
      ? `<div class="scenario-detail-section">
          <div class="scenario-detail-section-label">✅ 前提条件</div>
          <ul class="scenario-detail-list">${s.prerequisites.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
        </div>`
      : '';

    const stepsBlock = s.steps.length
      ? `<div class="scenario-detail-section">
          <div class="scenario-detail-section-label">🛠 実行ステップ</div>
          <ol class="scenario-detail-list scenario-detail-list-ol">${s.steps.map(st => `<li><strong>${esc(st.action)}</strong>${st.target ? `<span class="scenario-step-target">対象: <code class="awsui-code">${esc(st.target)}</code></span>` : ''}</li>`).join('')}</ol>
        </div>`
      : '';

    const outcomeBlock = s.expectedOutcome
      ? `<div class="scenario-detail-section">
          <div class="scenario-detail-section-label">🏁 期待される結果</div>
          <div class="scenario-detail-section-body">${esc(s.expectedOutcome)}</div>
        </div>`
      : '';

    const rollbackBlock = s.rollbackSteps.length
      ? `<div class="scenario-detail-section">
          <div class="scenario-detail-section-label">⏪ ロールバック手順</div>
          <ul class="scenario-detail-list">${s.rollbackSteps.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
        </div>`
      : '';

    // 評価基準 (シナリオ詳細に統合)
    const evaluationBlock = renderScenarioEvaluations(evalsForScenario);

    const detailRow = hasDetail
      ? `<tr class="scenario-detail-row" id="detail-${idx}" hidden>
          <td colspan="${5 + fisColspanExtra}">
            <div class="scenario-detail-box">
              ${rationaleBlock}
              ${descriptionBlock}
              ${impactBlock}
              ${executabilityBlock}
              ${prereqBlock}
              ${stepsBlock}
              ${outcomeBlock}
              ${rollbackBlock}
              ${renderScenarioObservations(scenarioObs)}
              ${evaluationBlock}
            </div>
          </td>
        </tr>`
      : '';

    return mainRow + detailRow;
  };

  const rows = sortedByDefault.map((s, idx) => renderRow(s, idx)).join('');

  const fisTh = showFisCol ? '<th>FIS</th>' : '';
  const scheduledCount = scenarios.length - unscheduledIds.size;
  const subtitleParts = [`${scenarios.length}件`];
  if (unscheduledIds.size > 0) {
    subtitleParts.push(`タイムライン採用 ${scheduledCount}件 / 時間枠外 ${unscheduledIds.size}件（最下部に集約）`);
  }
  subtitleParts.push('「📖 詳細」で説明・観測（📡）・評価（✅）を展開');
  subtitleParts.push('ヘッダクリックで並べ替え');
  const subtitle = subtitleParts.join(' — ');
  return `
  <div class="awsui-container">
    <div class="awsui-container-header">
      <h2 class="awsui-heading-m">シナリオ一覧</h2>
      <p class="awsui-text-secondary">${subtitle}</p>
    </div>
    <div class="awsui-container-body"><div class="awsui-table-wrap"><table class="awsui-table scenario-table">
      <thead><tr>
        <th class="sortable" data-sort="name">シナリオ名 <span class="sort-ind"></span></th>
        <th class="sortable" data-sort="cat">カテゴリ <span class="sort-ind"></span></th>
        <th class="sortable active asc" data-sort="sev">重大度 <span class="sort-ind">▼</span></th>
        <th class="sortable" data-sort="dur">所要時間 <span class="sort-ind"></span></th>
        <th>詳細</th>
        ${fisTh}
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div></div>
  </div>`;
}

function renderTimeline(
  plan: GameDayPlan,
  rationales?: Record<number, string>,
  unscheduledScenarios: FailureScenario[] = [],
): string {
  if (!plan.timeline.length) return '';
  const icons: Record<string, string> = { preparation: '🔧', execution: '⚡', review: '📋', break: '☕' };
  const colors: Record<string, string> = { preparation: '#0972d3', execution: '#d91515', review: '#ff9900', break: '#037f0c' };
  const items = plan.timeline.map((e, i) => {
    const icon = icons[e.type] ?? '📌';
    const col = colors[e.type] ?? '#5f6b7a';
    const reason = rationales?.[i];
    const reasonHtml = reason
      ? `<div class="tl-reason"><span class="tl-reason-label">なぜ？</span> ${esc(reason)}</div>`
      : '';
    return `<div class="tl-item">
      <div class="tl-time">${esc(e.time)}</div>
      <div class="tl-dot" style="background:${col};box-shadow:0 0 0 3px ${col}33"></div>
      <div class="tl-body">
        <div class="tl-activity"><span class="tl-icon">${icon}</span><span>${esc(e.activity)}</span></div>
        ${reasonHtml}
      </div>
    </div>`;
  }).join('');

  const unscheduledBlock = unscheduledScenarios.length
    ? `<details class="tl-unscheduled" ${unscheduledScenarios.length <= 3 ? 'open' : ''}>
        <summary class="tl-unscheduled-summary">
          <span class="tl-unscheduled-head">⏰ 未スケジュール（${unscheduledScenarios.length}件）</span>
          <span class="tl-unscheduled-toggle">▼</span>
        </summary>
        <div class="tl-unscheduled-body">
          <div class="tl-unscheduled-desc">実施枠の都合でタイムラインに組み込めなかったシナリオ。次回 GameDay の優先候補。</div>
          <ul class="tl-unscheduled-list">
            ${unscheduledScenarios.map(s => `<li><strong>${esc(s.name)}</strong> <span class="tl-unscheduled-meta">${s.severity} / ${esc(s.category)} / ${s.estimatedDuration}分</span></li>`).join('')}
          </ul>
        </div>
      </details>`
    : '';

  return `
  <div class="awsui-container">
    <div class="awsui-container-header">
      <h2 class="awsui-heading-m">タイムライン</h2>
      <p class="awsui-text-secondary">各エントリの「なぜ？」で順序や配置の根拠を確認できます</p>
    </div>
    <div class="awsui-container-body"><div class="tl">${items}</div>${unscheduledBlock}</div>
  </div>`;
}

function renderReport(
  scenarios: FailureScenario[],
  config?: InfraConfig,
  advice?: string,
  plan?: GameDayPlan,
): string {
  const planUnscheduled = plan?.unscheduledScenarioIds ?? [];
  // 表示価値が無いなら何も出さない（既存ダッシュボードテスト互換）
  if (!config && !advice && planUnscheduled.length === 0) return '';

  // 容量警告（プランが枠を超過している場合）
  const planTotalRequested = plan?.totalRequestedMinutes ?? 0;
  const planAvailable = plan?.availableExecutionMinutes ?? 0;
  const overflowWarning = plan && planUnscheduled.length > 0
    ? `<section class="report-section">
        <div class="report-warning">
          <div class="report-warning-head">⚠️ シナリオ全体の所要時間が実施枠を超過しています</div>
          <div class="report-warning-body">
            想定合計 <strong>${planTotalRequested}分</strong> / 実施枠 <strong>${planAvailable}分</strong>
            （超過 <strong>${planTotalRequested - planAvailable}分</strong>）。
            重大度の高い順にタイムライン採用 <strong>${plan.scenarios.length}件</strong>、
            残り <strong>${planUnscheduled.length}件</strong> は「未スケジュール」として分離しました。
          </div>
          <div class="report-warning-hint">
            💡 すべて実施したい場合は「1日」「2日」へ実施形式を変更するか、チャットで「ネットワーク系を外して」のように対象を絞ってください。
          </div>
        </div>
      </section>`
    : '';

  // 構成サマリー
  const configSummary = config
    ? `<div class="report-summary-grid">
        <div class="report-kv"><span class="report-key">リソース数</span><span class="report-val">${config.resources.length}</span></div>
        <div class="report-kv"><span class="report-key">シナリオ数</span><span class="report-val">${scenarios.length}</span></div>
        <div class="report-kv"><span class="report-key">リージョン</span><span class="report-val">${esc(config.regions.join(', ')) || '—'}</span></div>
        <div class="report-kv"><span class="report-key">マルチリージョン</span><span class="report-val ${config.metadata.isMultiRegion ? 'report-yes' : 'report-no'}">${config.metadata.isMultiRegion ? 'はい' : 'いいえ'}</span></div>
        <div class="report-kv"><span class="report-key">暗号化</span><span class="report-val ${config.metadata.hasEncryption ? 'report-yes' : 'report-no'}">${config.metadata.hasEncryption ? 'あり' : 'なし'}</span></div>
        <div class="report-kv"><span class="report-key">X-Ray トレーシング</span><span class="report-val ${config.metadata.hasXRayTracing ? 'report-yes' : 'report-no'}">${config.metadata.hasXRayTracing ? '有効' : '無効'}</span></div>
      </div>`
    : '';

  const configSection = config
    ? `<section class="report-section">
        <h3 class="report-h3">🏗 構成サマリー</h3>
        ${configSummary}
      </section>`
    : '';

  const adviceSection = advice
    ? `<section class="report-section">
        <h3 class="report-h3">🤖 AI分析レポート</h3>
        <div class="report-advice"><div class="report-advice-md">${mdToHtml(advice)}</div></div>
      </section>`
    : '';

  return `
  <div class="awsui-container">
    <div class="awsui-container-header">
      <h2 class="awsui-heading-m">📊 計画レポート</h2>
      <p class="awsui-text-secondary">この計画が「なぜこの構成・なぜこれらのシナリオ」になっているのかをまずご覧ください</p>
    </div>
    <div class="awsui-container-body">
      ${overflowWarning}
      ${configSection}
      ${adviceSection}
    </div>
  </div>`;
}

function renderTrend(past?: GameDayResult[]): string {
  if (!past || !past.length) return '';
  const sorted = [...past].sort((a, b) => new Date(a.executedAt).getTime() - new Date(b.executedAt).getTime());
  const bars = sorted.map(r => {
    const pct = Math.round(r.overallScore);
    const date = r.executedAt.slice(0, 10);
    return `<div class="trend-col"><div class="trend-val">${r.overallScore}</div><div class="trend-track"><div class="trend-fill" style="height:${pct}%"></div></div><div class="trend-date">${esc(date)}</div></div>`;
  }).join('');
  return `
  <div class="awsui-container">
    <div class="awsui-container-header"><h2 class="awsui-heading-m">過去結果トレンド</h2></div>
    <div class="awsui-container-body"><div class="trend-chart">${bars}</div></div>
  </div>`;
}

function renderFisDeployments(deployments?: FISDeploymentInfo[]): string {
  if (!deployments || !deployments.length) return '';  const cards = deployments.map((d, idx) => {
    const cfnJson = JSON.stringify(d.cfnTemplate, null, 2);
    const downloadBtn = d.downloadUrl
      ? `<a href="${esc(d.downloadUrl)}" class="fis-btn fis-btn-secondary" download>📥 CFnダウンロード</a>`
      : '';
    return `
    <div class="fis-card" data-fis-id="${esc(d.scenarioId)}">
      <div class="fis-card-head">
        <div class="fis-card-title-wrap">
          <div class="fis-card-title">${esc(d.scenarioName)}</div>
          <div class="fis-card-subtitle">scenarioId: <code class="awsui-code">${esc(d.scenarioId)}</code></div>
        </div>
        <button class="fis-card-toggle" aria-expanded="false" aria-controls="fis-body-${idx}">▼</button>
      </div>
      <div class="fis-card-actions">
        <a href="${esc(d.consoleDeepLink)}" target="_blank" rel="noopener noreferrer" class="fis-btn fis-btn-primary">
          🚀 CFnコンソールで起動
        </a>
        ${downloadBtn}
        <button class="fis-btn fis-btn-secondary fis-copy-cmd" data-cmd-target="fis-cmd-${idx}">📋 CLIコマンドコピー</button>
        <button class="fis-btn fis-btn-secondary fis-copy-json" data-json-target="fis-json-${idx}">📋 CFn JSONコピー</button>
      </div>
      <div class="fis-card-body" id="fis-body-${idx}" hidden>
        <div class="fis-section">
          <div class="fis-section-label">AWS CLI deploy コマンド <span class="fis-hint">(横スクロール可)</span></div>
          <pre class="fis-code-block" id="fis-cmd-${idx}"><code>${esc(d.deployCommand)}</code></pre>
        </div>
        <div class="fis-section">
          <div class="fis-section-label">CFn テンプレート (JSON) <span class="fis-hint">(縦/横スクロール可)</span></div>
          <pre class="fis-code-block fis-code-block-tall" id="fis-json-${idx}"><code>${esc(cfnJson)}</code></pre>
        </div>
      </div>
    </div>`;
  }).join('');

  return `
  <div class="awsui-container">
    <div class="awsui-container-header">
      <h2 class="awsui-heading-m">FIS実験テンプレート (CloudFormation)</h2>
      <p class="awsui-text-secondary">
        ${deployments.length}件のシナリオが FIS でデプロイ可能です。
        「CFnコンソールで起動」ボタンから Quick Create フローへ直接遷移できます。
      </p>
      <p class="awsui-text-secondary fis-help">
        💡 各テンプレートには <strong>IAMロール / CloudWatchアラーム / FIS::ExperimentTemplate</strong> が含まれています。
        既存ロール/アラームがある場合は Parameters で差し替え可能。
      </p>
    </div>
    <div class="awsui-container-body"><div class="fis-list">${cards}</div></div>
  </div>`;
}

// ============================================================
// CSS
// ============================================================

function css(): string {
  return `
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{background:#f2f3f3;color:#000716;font-family:'Amazon Ember','Helvetica Neue','Segoe UI','Hiragino Sans',sans-serif;font-size:14px;line-height:1.5}

  .awsui-top-nav{background:#232f3e;color:#fff;height:48px;display:flex;align-items:center;padding:0 20px;position:sticky;top:0;z-index:100}
  .awsui-top-nav-inner{display:flex;align-items:center;justify-content:space-between;width:100%}
  .awsui-top-nav-left{display:flex;align-items:center;gap:10px}
  .awsui-service-icon{font-size:20px}
  .awsui-service-name{font-size:16px;font-weight:700;letter-spacing:.3px}
  .awsui-top-nav-right{display:flex;align-items:center;gap:16px;font-size:13px;color:#d5dbdb}
  .awsui-nav-item{cursor:pointer;padding:4px 8px;border-radius:4px;text-decoration:none;color:#d5dbdb}
  .awsui-nav-item:hover{background:#37475a}
  .awsui-nav-divider{width:1px;height:20px;background:#5f6b7a}

  .awsui-app-layout{display:flex;min-height:calc(100vh - 48px)}
  .awsui-side-nav{width:240px;background:#fff;border-right:1px solid #e9ebed;padding:16px 0;flex-shrink:0}
  .awsui-side-nav-header{padding:8px 20px 16px;font-size:16px;font-weight:700;color:#000716}
  .awsui-side-nav-item{display:flex;align-items:center;gap:8px;padding:8px 20px;color:#5f6b7a;text-decoration:none;font-size:14px;border-left:3px solid transparent;transition:all .15s}
  .awsui-side-nav-item:hover{background:#f2f3f3;color:#000716}
  .awsui-side-nav-item.active{border-left-color:#0972d3;color:#0972d3;background:#f2f8fd;font-weight:600}
  .awsui-side-nav-icon{font-size:16px;width:20px;text-align:center}
  .awsui-side-nav-divider{height:1px;background:#e9ebed;margin:12px 20px}
  .awsui-side-nav-section{padding:4px 20px;font-size:12px;font-weight:700;color:#5f6b7a;text-transform:uppercase;letter-spacing:.5px}

  .awsui-content{flex:1;padding:20px 28px 40px;max-width:1200px}
  .awsui-breadcrumb{font-size:13px;color:#5f6b7a;margin-bottom:8px}
  .awsui-breadcrumb a{color:#0972d3;text-decoration:none}
  .awsui-breadcrumb a:hover{text-decoration:underline}
  .awsui-breadcrumb-sep{margin:0 6px;color:#9ba7b6}
  .awsui-breadcrumb-current{color:#0972d3}
  .awsui-content-header{margin-bottom:8px}
  .awsui-heading-l{font-size:24px;font-weight:700;color:#000716;margin-bottom:4px}
  .awsui-heading-m{font-size:18px;font-weight:700;color:#000716;margin-bottom:2px}
  .awsui-text-secondary{font-size:14px;color:#5f6b7a}

  .awsui-container{background:#fff;border:1px solid #e9ebed;border-radius:12px;overflow:hidden;margin-bottom:20px}
  .awsui-container-header{padding:20px 24px 12px;border-bottom:1px solid #e9ebed}
  .awsui-container-body{padding:20px 24px 24px}

  /* KV bar */
  .awsui-kv-bar{display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap}
  .awsui-kv-chip{background:#fff;border:1px solid #e9ebed;border-radius:8px;padding:8px 16px;display:flex;gap:8px;align-items:center}
  .awsui-kv-chip-label{font-size:12px;color:#5f6b7a}
  .awsui-kv-chip-value{font-size:14px;font-weight:700;color:#000716}
  .awsui-kv-chip-warning{background:#fff7ef;border-color:#ef7a0c}
  .awsui-kv-chip-warning .awsui-kv-chip-label{color:#c2570a}
  .awsui-kv-chip-warning .awsui-kv-chip-value{color:#c2570a}

  /* Table */
  .awsui-table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
  .awsui-table{width:100%;border-collapse:collapse;min-width:600px}
  .awsui-table th{text-align:left;padding:10px 12px;font-size:13px;font-weight:600;color:#5f6b7a;border-bottom:1px solid #e9ebed;white-space:nowrap}
  .awsui-table td{padding:10px 12px;font-size:14px;color:#000716;border-bottom:1px solid #e9ebed}
  .awsui-table tr:last-child td{border-bottom:none}
  .td-desc{max-width:280px;font-size:13px;line-height:1.55;color:#414d5c;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-overflow:ellipsis;word-break:break-word}
  .td-pass{color:#037f0c;font-weight:600}
  .td-fail{color:#d91515;font-weight:600}
  .awsui-status-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}

  /* Badge */
  .awsui-badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600}
  .awsui-badge-blue{background:#f2f8fd;color:#0972d3}
  .awsui-badge-green{background:#f2fcf3;color:#037f0c}
  .awsui-badge-red{background:#fff7f7;color:#d91515}
  .awsui-badge-grey{background:#f2f3f3;color:#5f6b7a}

  /* Timeline */
  .tl{position:relative;padding-left:28px}
  .tl::before{content:'';position:absolute;left:11px;top:0;bottom:0;width:2px;background:#e9ebed;border-radius:1px}
  .tl-item{display:flex;align-items:flex-start;margin-bottom:14px;position:relative}
  .tl-time{width:52px;text-align:right;font-size:13px;color:#0972d3;font-weight:600;padding-right:10px;flex-shrink:0}
  .tl-dot{width:10px;height:10px;border-radius:50%;position:absolute;left:-22px;top:4px;z-index:1}
  .tl-body{font-size:14px;color:#000716}
  .tl-icon{margin-right:6px}

  /* Trend chart */
  .trend-chart{display:flex;align-items:flex-end;gap:16px;height:200px;padding:12px 0}
  .trend-col{flex:1;display:flex;flex-direction:column;align-items:center;height:100%;min-width:44px}
  .trend-val{font-size:13px;color:#0972d3;font-weight:700;margin-bottom:4px}
  .trend-track{flex:1;width:100%;max-width:40px;background:#f2f3f3;border-radius:4px;overflow:hidden;position:relative}
  .trend-fill{position:absolute;bottom:0;width:100%;background:linear-gradient(0deg,#0972d3,#539fe5);border-radius:4px;transition:height .6s ease}
  .trend-date{font-size:11px;color:#5f6b7a;margin-top:4px;white-space:nowrap}

  /* Tabs nav */
  .awsui-tabs{display:flex;gap:0;border-bottom:2px solid #e9ebed;margin-bottom:20px}
  .awsui-tab{padding:10px 20px;font-size:14px;font-weight:600;color:#5f6b7a;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all .15s;text-decoration:none}
  .awsui-tab:hover{color:#000716}
  .awsui-tab.active{color:#0972d3;border-bottom-color:#0972d3}

  .awsui-footer{text-align:center;padding:20px;color:#5f6b7a;font-size:12px}

  .awsui-code{font-family:'SF Mono','Monaco','Consolas',monospace;font-size:12px;background:#f2f3f3;padding:1px 6px;border-radius:4px;color:#000716}

  /* Evaluation blocks */
  .eval-blocks{display:flex;flex-direction:column;gap:16px}
  .eval-block{background:#fff;border:1px solid #e9ebed;border-radius:8px;padding:14px 16px}
  .eval-block-title{font-size:14px;font-weight:700;color:#000716;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #f2f3f3}
  .eval-cells{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
  .eval-cell{background:#f8f9fa;border-radius:6px;padding:10px 12px}
  .eval-cell-empty{opacity:.5}
  .eval-cell-label{font-size:12px;color:#5f6b7a;font-weight:600;margin-bottom:6px}
  .eval-cell-thresholds{display:flex;flex-direction:column;gap:3px;font-size:12px}
  .eval-pass{color:#037f0c;font-weight:600}
  .eval-fail{color:#d91515;font-weight:600}
  .eval-cell-empty-text{color:#9ba7b6;font-size:13px}

  :focus-visible{outline:2px solid #0972d3;outline-offset:2px}

  /* Chat panel */
  .awsui-app-layout.has-chat .awsui-content{max-width:calc(100vw - 240px - 380px - 40px)}
  .chat-panel{width:380px;background:#fff;border-left:1px solid #e9ebed;display:flex;flex-direction:column;height:calc(100vh - 48px);position:sticky;top:48px;flex-shrink:0}
  .chat-header{padding:14px 16px;border-bottom:1px solid #e9ebed;display:flex;align-items:center;justify-content:space-between}
  .chat-title{font-size:14px;font-weight:700;color:#000716}
  .chat-subtitle{font-size:11px;color:#0972d3;background:#f2f8fd;padding:2px 6px;border-radius:4px}
  .chat-messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px}
  .chat-welcome{text-align:center;color:#5f6b7a;padding:20px 12px}
  .chat-welcome-icon{font-size:32px;margin-bottom:8px}
  .chat-welcome-text{font-size:14px;font-weight:600;color:#000716;margin-bottom:6px}
  .chat-welcome-hint{font-size:12px;color:#5f6b7a;line-height:1.6}
  .chat-msg{display:flex;gap:8px;align-items:flex-start}
  .chat-msg-icon{width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;background:#f2f3f3}
  .chat-msg-bubble{font-size:13px;line-height:1.5;padding:8px 12px;border-radius:8px;max-width:calc(100% - 40px);word-wrap:break-word}
  .chat-msg-user .chat-msg-icon{background:#f2f8fd;color:#0972d3}
  .chat-msg-user .chat-msg-bubble{background:#f2f8fd;color:#000716}
  .chat-msg-ai .chat-msg-icon{background:#fff3e0;color:#ff9900}
  .chat-msg-ai .chat-msg-bubble{background:#f8f9fa;color:#000716}
  .chat-input-area{padding:12px;border-top:1px solid #e9ebed;display:flex;gap:8px;align-items:flex-end}
  .chat-input{flex:1;padding:8px 12px;border:2px solid #7d8998;border-radius:8px;font-size:13px;font-family:inherit;resize:none;min-height:36px;max-height:120px;line-height:1.4;color:#000716}
  .chat-input:focus{outline:none;border-color:#0972d3}
  .chat-send-btn{width:36px;height:36px;background:#0972d3;color:#fff;border:none;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .chat-send-btn:hover:not(:disabled){background:#033160}
  .chat-send-btn:disabled{background:#9ba7b6;cursor:not-allowed}
  .chat-status{padding:0 12px 10px;font-size:12px;color:#5f6b7a;min-height:18px}
  .chat-status-updated{color:#037f0c;font-weight:600}
  .chat-reload-btn{margin-left:8px;padding:3px 10px;background:#0972d3;color:#fff;border:none;border-radius:4px;font-size:11px;cursor:pointer;font-weight:600}
  .chat-reload-btn:hover{background:#033160}

  /* FIS deployment cards */
  .fis-list{display:flex;flex-direction:column;gap:14px}
  .fis-card{background:#fff;border:1px solid #e9ebed;border-radius:8px;padding:14px 16px}
  .fis-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px}
  .fis-card-title-wrap{flex:1;min-width:0}
  .fis-card-title{font-size:15px;font-weight:700;color:#000716;margin-bottom:2px}
  .fis-card-subtitle{font-size:12px;color:#5f6b7a}
  .fis-card-toggle{background:#f2f3f3;border:1px solid #e9ebed;border-radius:4px;width:32px;height:32px;cursor:pointer;font-size:12px;color:#5f6b7a;flex-shrink:0;transition:transform .2s}
  .fis-card-toggle[aria-expanded="true"]{transform:rotate(180deg)}
  .fis-card-toggle:hover{background:#e9ebed}
  .fis-card-actions{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:0}
  .fis-btn{display:inline-flex;align-items:center;gap:4px;padding:7px 14px;font-size:13px;font-weight:600;border-radius:6px;border:1px solid transparent;cursor:pointer;text-decoration:none;font-family:inherit}
  .fis-btn-primary{background:#ef7a0c;color:#fff}
  .fis-btn-primary:hover{background:#c66209}
  .fis-btn-secondary{background:#fff;color:#0972d3;border-color:#0972d3}
  .fis-btn-secondary:hover{background:#f2f8fd}
  .fis-btn-copied{background:#037f0c !important;color:#fff !important;border-color:#037f0c !important}
  .fis-card-body{margin-top:14px;padding-top:14px;border-top:1px solid #f2f3f3;display:flex;flex-direction:column;gap:14px}
  .fis-card-body[hidden]{display:none !important}
  .fis-section{display:flex;flex-direction:column;gap:6px}
  .fis-section-label{font-size:12px;font-weight:600;color:#5f6b7a;display:flex;align-items:center;gap:6px}
  .fis-hint{font-weight:400;color:#9ba7b6;font-size:11px}
  .fis-code-block{background:#0f1419;color:#e9ebed;border-radius:6px;padding:12px 14px;font-family:'SF Mono','Monaco','Consolas',monospace;font-size:12px;line-height:1.5;overflow-x:auto;-webkit-overflow-scrolling:touch;max-height:none}
  .fis-code-block code{white-space:pre;display:block}
  .fis-code-block-tall{max-height:360px;overflow-y:auto}
  .fis-help{margin-top:6px;font-size:13px}

  /* FIS jump buttons in scenario list */
  .fis-jump-btn{display:inline-flex;align-items:center;gap:3px;padding:3px 9px;font-size:12px;font-weight:600;background:#fff3e0;color:#ef7a0c;border:1px solid #ef7a0c;border-radius:4px;text-decoration:none;white-space:nowrap}
  .fis-jump-btn:hover{background:#ef7a0c;color:#fff}
  .fis-jump-na{color:#9ba7b6;font-size:13px}

  /* Scenario row detail (rationale + observations) */
  .scenario-toggle{background:#fff;border:1px solid #ef7a0c;color:#c2570a;padding:4px 10px;border-radius:4px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;font-family:inherit;display:inline-flex;align-items:center;gap:6px}
  .scenario-toggle:hover{background:#fff3e0}
  .scenario-toggle[aria-expanded="true"]{background:#ef7a0c;color:#fff;border-color:#ef7a0c}
  .scenario-obs-count{background:#f2f3f3;color:#5f6b7a;border-radius:10px;padding:0 7px;font-size:11px;font-weight:700}
  .scenario-toggle[aria-expanded="true"] .scenario-obs-count{background:#ffffff33;color:#fff}
  .scenario-no-rationale{color:#9ba7b6;font-size:13px}
  .scenario-detail-row td{background:#fafbfc;padding:0;border-bottom:1px solid #e9ebed}
  .scenario-detail-box{padding:16px 18px;display:flex;flex-direction:column;gap:14px}
  .scenario-detail-section{background:#fff;border:1px solid #e9ebed;border-radius:6px;padding:12px 16px}
  .scenario-detail-section-label{font-size:12px;font-weight:700;color:#5f6b7a;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px}
  .scenario-detail-section-body{font-size:13.5px;line-height:1.7;color:#000716;white-space:pre-wrap;word-break:break-word}
  .scenario-detail-list{margin:4px 0 0 22px;padding:0;font-size:13.5px;line-height:1.7;color:#000716}
  .scenario-detail-list li{margin:3px 0}
  .scenario-detail-list-ol li::marker{color:#ef7a0c;font-weight:700}
  .scenario-step-target{display:block;font-size:12px;color:#5f6b7a;margin-top:2px}
  .scenario-rationale-box{background:#fff;border:1px solid #e9ebed;border-left:3px solid #ef7a0c;border-radius:6px;padding:12px 16px}
  .scenario-rationale-label{font-size:11px;font-weight:700;color:#c2570a;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px}
  .scenario-rationale-text{font-size:14px;line-height:1.7;color:#000716}
  .scenario-row-unscheduled td{background:#fafafa;color:#5f6b7a}
  .scenario-row-unscheduled td:first-child strong{color:#414d5c}
  .scenario-unscheduled-badge{margin-left:8px;font-size:11px;background:#fff7ef;color:#c2570a;border:1px solid #ef7a0c66}
  .scenario-exec-badge{margin-left:6px;font-size:11px}
  .scenario-detail-mini-badge{display:inline-block;background:#f2f3f3;color:#5f6b7a;border-radius:10px;padding:0 7px;font-size:11px;font-weight:700;margin-left:4px}
  .scenario-toggle[aria-expanded="true"] .scenario-detail-mini-badge{background:#ffffff33;color:#fff}
  .scenario-detail-alt{border-left:3px solid #0972d3 !important;background:#f2f8fd}
  .scenario-detail-ref{border-left:3px solid #9ba7b6 !important;background:#fafbfc}
  .scenario-eval-hint{font-size:12px;color:#5f6b7a;margin-top:8px;line-height:1.6;padding-top:6px;border-top:1px dashed #e9ebed}

  /* Scenario observations (mini table) */
  .scenario-obs-title{font-size:13px;font-weight:700;color:#000716;margin-bottom:8px}
  .scenario-obs-table{width:100%;border-collapse:collapse;font-size:13px;background:#fff;border:1px solid #e9ebed;border-radius:6px;overflow:hidden}
  .scenario-obs-table th{text-align:left;padding:8px 12px;background:#f2f3f3;color:#5f6b7a;font-weight:600;border-bottom:1px solid #e9ebed;white-space:nowrap}
  .scenario-obs-table td{padding:8px 12px;color:#000716;border-bottom:1px solid #f2f3f3;vertical-align:middle}
  .scenario-obs-table tr:last-child td{border-bottom:none}
  .obs-cell-ok{color:#037f0c;font-weight:600;white-space:nowrap}
  .obs-cell-ng{color:#d91515;font-weight:600;white-space:nowrap}
  .scenario-obs-empty{font-size:13px;color:#9ba7b6;padding:4px 0}

  /* Sortable headers */
  .awsui-table th.sortable{cursor:pointer;user-select:none}
  .awsui-table th.sortable:hover{color:#0972d3}
  .awsui-table th.sortable.active{color:#0972d3}
  .sort-ind{font-size:10px;color:#9ba7b6;margin-left:2px}
  .awsui-table th.sortable.active .sort-ind{color:#0972d3}

  /* Timeline rationale */
  .tl-activity{font-size:14px;color:#000716}
  .tl-reason{margin-top:4px;font-size:12px;color:#5f6b7a;background:#f7f8fa;padding:6px 10px;border-radius:4px;border-left:3px solid #0972d3}
  .tl-reason-label{color:#0972d3;font-weight:700;margin-right:4px}

  /* Timeline unscheduled section */
  .tl-unscheduled{margin-top:20px;padding:0;background:#fafbfc;border:1px solid #e9ebed;border-left:3px solid #ef7a0c;border-radius:6px;overflow:hidden}
  .tl-unscheduled-summary{cursor:pointer;list-style:none;padding:14px 16px;display:flex;align-items:center;justify-content:space-between;user-select:none}
  .tl-unscheduled-summary::-webkit-details-marker{display:none}
  .tl-unscheduled-summary:hover{background:#f7f3ec}
  .tl-unscheduled-toggle{font-size:11px;color:#5f6b7a;transition:transform .2s}
  .tl-unscheduled[open] .tl-unscheduled-toggle{transform:rotate(180deg)}
  .tl-unscheduled-body{padding:0 16px 14px}
  .tl-unscheduled-head{font-size:14px;font-weight:700;color:#c2570a}
  .tl-unscheduled-desc{font-size:13px;color:#5f6b7a;margin-bottom:10px;line-height:1.6}
  .tl-unscheduled-list{margin:0;padding-left:22px;list-style:disc}
  .tl-unscheduled-list li{font-size:13.5px;line-height:1.7;color:#000716}
  .tl-unscheduled-meta{color:#5f6b7a;font-size:12px;margin-left:6px}

  /* Guide box (観測ポイント / 評価基準のヘルプ) */
  .guide-box{background:#f2f8fd;border:1px solid #0972d333;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:13px}
  .guide-box summary{cursor:pointer;color:#0972d3;font-size:13px;padding:2px 0;list-style:none}
  .guide-box summary::-webkit-details-marker{display:none}
  .guide-box[open] summary{margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #0972d322}
  .guide-icon{margin-right:6px}
  .guide-list{margin-left:20px;line-height:1.7;color:#000716}
  .guide-list li{margin-bottom:2px}

  /* Report section */
  .report-section{margin-bottom:24px}
  .report-section:last-child{margin-bottom:0}
  .report-warning{background:#fff7ef;border:1px solid #ef7a0c;border-left:4px solid #ef7a0c;border-radius:8px;padding:14px 18px}
  .report-warning-head{font-size:15px;font-weight:700;color:#c2570a;margin-bottom:6px}
  .report-warning-body{font-size:14px;line-height:1.7;color:#000716}
  .report-warning-hint{font-size:13px;line-height:1.6;color:#5f6b7a;margin-top:8px;padding-top:8px;border-top:1px solid #ef7a0c33}
  .report-h3{font-size:15px;font-weight:700;color:#000716;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #e9ebed}
  .report-paragraph{font-size:13px;color:#000716;margin-bottom:10px;line-height:1.7}
  .report-summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
  .report-kv{display:flex;justify-content:space-between;padding:8px 12px;background:#fafbfc;border:1px solid #e9ebed;border-radius:6px;font-size:13px}
  .report-key{color:#5f6b7a}
  .report-val{font-weight:700;color:#000716}
  .report-yes{color:#037f0c}
  .report-no{color:#5f6b7a}
  .report-breakdown-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px}
  .report-breakdown-block{background:#fafbfc;border:1px solid #e9ebed;border-radius:8px;padding:12px 14px}
  .report-breakdown-title{font-size:12px;font-weight:700;color:#5f6b7a;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px}
  .report-mini-table{width:100%;border-collapse:collapse}
  .report-mini-table td{padding:5px 0;font-size:13px;color:#000716;border-bottom:1px solid #f2f3f3}
  .report-mini-table td:last-child{text-align:right}
  .report-mini-table tr:last-child td{border-bottom:none}
  .report-advice{background:#fbfcfd;border:1px solid #e9ebed;border-left:4px solid #ef7a0c;padding:18px 22px;border-radius:6px}
  .report-advice-md{font-size:15px;line-height:1.8;color:#000716}
  .report-advice-md > *:first-child{margin-top:0}
  .report-advice-md > *:last-child{margin-bottom:0}
  .report-advice-md p{margin:0 0 12px 0}
  .report-advice-md h3{color:#ef7a0c;font-size:17px;margin:22px 0 10px 0;border:none;padding-bottom:6px;border-bottom:1px solid #f0e2d3;font-weight:700}
  .report-advice-md h3:first-child{margin-top:0}
  .report-advice-md h4{color:#000716;font-size:15px;margin:14px 0 6px 0;font-weight:700}
  .report-advice-md strong{color:#000716;font-weight:700}
  .report-advice-md code{background:#f2f3f3;border:1px solid #e9ebed;padding:1px 6px;border-radius:4px;font-size:13px;font-family:'SF Mono','Monaco','Consolas',monospace;color:#c2570a}
  .report-advice-md ul,.report-advice-md ol{margin:6px 0 14px 22px;padding:0}
  .report-advice-md li{margin:5px 0;line-height:1.7}
  .report-advice-md li::marker{color:#ef7a0c}
  /* MD table inside advice (neutral palette) */
  .md-table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:10px 0 12px 0;border:1px solid #e9ebed;border-radius:6px;background:#fff}
  .md-table{width:100%;border-collapse:collapse;font-size:14px}
  .md-table th{text-align:left;padding:8px 12px;background:#f2f3f3;color:#000716;font-weight:700;border-bottom:1px solid #e9ebed;white-space:nowrap}
  .md-table td{padding:8px 12px;color:#000716;border-bottom:1px solid #f2f3f3;vertical-align:top;line-height:1.55}
  .md-table tr:last-child td{border-bottom:none}
  .md-table tr:nth-child(even) td{background:#fafbfc}
  .report-advice-empty{padding:14px 18px;color:#5f6b7a;background:#fafbfc;border-radius:6px;border:1px dashed #d5d8dd;font-size:14px}

  /* Highlight animation when jumping to a FIS card */
  .fis-card.fis-card-highlight{animation:fis-highlight 1.6s ease-out}
  @keyframes fis-highlight{
    0%{box-shadow:0 0 0 0 rgba(239,122,12,.6);background:#fff3e0}
    100%{box-shadow:0 0 0 8px rgba(239,122,12,0);background:#fff}
  }

  @media(max-width:768px){.awsui-side-nav{display:none}.awsui-kv-bar{flex-direction:column}.chat-panel{display:none}.fis-card-actions{flex-direction:column;align-items:stretch}.fis-btn{justify-content:center}.report-summary-grid{grid-template-columns:1fr}}
  `;
}

// ============================================================
// Keyboard navigation
// ============================================================

function keyboardScript(): string {
  return `<script>
  // ── セクション間移動 (j/k, ↑/↓) ──
  document.addEventListener('keydown',function(e){
    if(e.target&&['INPUT','TEXTAREA'].indexOf(e.target.tagName)>=0)return;
    var secs=document.querySelectorAll('.awsui-container');
    if(!secs.length)return;
    var cur=-1;
    secs.forEach(function(s,i){var r=s.getBoundingClientRect();if(r.top>=0&&r.top<window.innerHeight/2&&cur===-1)cur=i});
    if(cur===-1)cur=0;
    if(e.key==='ArrowDown'||e.key==='j'){e.preventDefault();var n=Math.min(cur+1,secs.length-1);secs[n].scrollIntoView({behavior:'smooth',block:'start'})}
    else if(e.key==='ArrowUp'||e.key==='k'){e.preventDefault();var p=Math.max(cur-1,0);secs[p].scrollIntoView({behavior:'smooth',block:'start'})}
  });

  // ── FIS カードトグル / シナリオ一覧→FISジャンプ ──
  document.addEventListener('click',function(e){
    var t=e.target;
    if(!t||!t.classList)return;

    // シナリオ一覧の「🚀 FIS」ボタン → 該当カードへスクロール+展開+ハイライト
    var jumpId=t.getAttribute('data-fis-target');
    if(jumpId){
      e.preventDefault();
      var card=document.querySelector('.fis-card[data-fis-id="'+CSS.escape(jumpId)+'"]');
      if(card){
        card.scrollIntoView({behavior:'smooth',block:'start'});
        var toggle=card.querySelector('.fis-card-toggle');
        var body=card.querySelector('.fis-card-body');
        if(toggle&&body&&body.hidden){
          toggle.setAttribute('aria-expanded','true');
          body.hidden=false;
        }
        card.classList.remove('fis-card-highlight');
        // re-trigger animation
        void card.offsetWidth;
        card.classList.add('fis-card-highlight');
        setTimeout(function(){card.classList.remove('fis-card-highlight');},1700);
      }
      return;
    }

    if(t.classList.contains('fis-card-toggle')){
      var bodyId=t.getAttribute('aria-controls');
      var body=bodyId?document.getElementById(bodyId):null;
      if(body){
        var expanded=t.getAttribute('aria-expanded')==='true';
        t.setAttribute('aria-expanded',String(!expanded));
        body.hidden=expanded;
      }
      return;
    }

    var cmdTarget=t.getAttribute('data-cmd-target');
    var jsonTarget=t.getAttribute('data-json-target');
    var targetId=cmdTarget||jsonTarget;
    if(targetId){
      var el=document.getElementById(targetId);
      if(el){
        var text=el.textContent||'';
        var origLabel=t.textContent;
        var copyDone=function(){
          t.textContent='✅ コピー完了';
          t.classList.add('fis-btn-copied');
          setTimeout(function(){
            t.textContent=origLabel;
            t.classList.remove('fis-btn-copied');
          },1500);
        };
        if(navigator.clipboard&&navigator.clipboard.writeText){
          navigator.clipboard.writeText(text).then(copyDone).catch(function(){
            // フォールバック
            fallbackCopy(text);copyDone();
          });
        }else{
          fallbackCopy(text);copyDone();
        }
      }
    }
  });

  function fallbackCopy(text){
    var ta=document.createElement('textarea');
    ta.value=text;ta.style.position='fixed';ta.style.opacity='0';
    document.body.appendChild(ta);ta.select();
    try{document.execCommand('copy');}catch(e){}
    document.body.removeChild(ta);
  }

  // ── シナリオ行の「📖 詳細」トグル ──
  document.addEventListener('click', function(e){
    var t=e.target;
    // 子要素（バッジ）がクリックされた場合は親ボタンに遡る
    while(t&&t.tagName!=='BUTTON'&&!(t.classList&&t.classList.contains('scenario-toggle'))&&t.parentNode){t=t.parentNode;}
    if(!t||!t.classList||!t.classList.contains('scenario-toggle'))return;
    var targetId=t.getAttribute('data-target');
    var row=targetId?document.getElementById(targetId):null;
    if(!row)return;
    var hidden=row.hasAttribute('hidden');
    // バッジ要素 (📡N / ✅N など複数あり得る) は保持したいので、ボタンの label だけ更新する
    var labelSpan=t.querySelector('.scenario-toggle-label');
    if(hidden){
      row.removeAttribute('hidden');
      t.setAttribute('aria-expanded','true');
      if(labelSpan)labelSpan.textContent='📖 閉じる';
    }else{
      row.setAttribute('hidden','');
      t.setAttribute('aria-expanded','false');
      if(labelSpan)labelSpan.textContent='📖 詳細';
    }
  });

  // ── シナリオ表のソート (ヘッダクリック) ──
  document.addEventListener('click', function(e){
    var th=e.target;
    while(th&&th.tagName!=='TH'&&th.tagName!=='BODY'){th=th.parentNode;}
    if(!th||!th.classList||!th.classList.contains('sortable'))return;
    var table=th;while(table&&table.tagName!=='TABLE'){table=table.parentNode;}
    if(!table)return;
    var sortKey=th.getAttribute('data-sort');
    var asc=th.classList.contains('active')?!th.classList.contains('asc'):true;
    var headers=table.querySelectorAll('th.sortable');
    headers.forEach(function(h){h.classList.remove('active','asc','desc');var ind=h.querySelector('.sort-ind');if(ind)ind.textContent='';});
    th.classList.add('active');
    th.classList.add(asc?'asc':'desc');
    var ind=th.querySelector('.sort-ind');if(ind)ind.textContent=asc?'▼':'▲';

    var tbody=table.querySelector('tbody');
    if(!tbody)return;
    // メイン行のみ収集（detail-rowは付随）
    var allRows=Array.prototype.slice.call(tbody.children);
    var mainRows=allRows.filter(function(r){return r.classList&&r.classList.contains('scenario-row');});
    var pairs=mainRows.map(function(mr){
      var next=mr.nextElementSibling;
      var detail=(next&&next.classList&&next.classList.contains('scenario-detail-row'))?next:null;
      return {main:mr, detail:detail};
    });
    pairs.sort(function(a,b){
      // 時間枠外は常に最下部に集約（昇順/降順でも下固定）
      var aSt=Number(a.main.getAttribute('data-sort-status')||'0');
      var bSt=Number(b.main.getAttribute('data-sort-status')||'0');
      if(aSt!==bSt) return aSt-bSt;
      var av=a.main.getAttribute('data-sort-'+sortKey)||'';
      var bv=b.main.getAttribute('data-sort-'+sortKey)||'';
      var an=Number(av), bn=Number(bv);
      var cmp=(!isNaN(an)&&!isNaN(bn))?(an-bn):av.localeCompare(bv);
      return asc?cmp:-cmp;
    });
    pairs.forEach(function(p){
      tbody.appendChild(p.main);
      if(p.detail)tbody.appendChild(p.detail);
    });
  });
  </script>`;
}

// ============================================================
// Main generate function
// ============================================================

export function generate(data: DashboardData): string {
  const { plan, scenarios, observations, evaluations, pastResults, sessionId, chatHistory, fisDeployments, advice, config, timelineRationales } = data;
  const unscheduledIds = new Set(plan.unscheduledScenarioIds ?? []);

  // 評価基準をシナリオに紐付け（独立タブを廃止し、シナリオ詳細展開に統合）
  const evalsByScenario = new Map<string, EvaluationCriteria[]>();
  for (const e of evaluations) {
    const arr = evalsByScenario.get(e.scenarioId) ?? [];
    arr.push(e);
    evalsByScenario.set(e.scenarioId, arr);
  }
  const enrichedScenarios: FailureScenario[] = scenarios.map(s => ({
    ...s,
    evaluations: s.evaluations ?? evalsByScenario.get(s.id) ?? [],
  }));

  const tabs = [
    { id: 'report', label: '📊 計画レポート' },
    { id: 'scenarios', label: 'シナリオ一覧' },
    { id: 'timeline', label: 'タイムライン' },
    ...(fisDeployments && fisDeployments.length > 0 ? [{ id: 'fis', label: '🧪 FIS実験' }] : []),
    ...(pastResults && pastResults.length > 0 ? [{ id: 'trend', label: 'トレンド' }] : []),
  ];
  const tabsHtml = tabs.map(t => `<a href="#${t.id}" class="awsui-tab">${t.label}</a>`).join('');

  const hasChat = !!sessionId;
  const chatPanel = hasChat ? renderChatPanel(sessionId!, chatHistory ?? []) : '';
  const chatScript = hasChat ? renderChatScript(sessionId!) : '';
  const layoutClass = hasChat ? 'awsui-app-layout has-chat' : 'awsui-app-layout';

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(plan.title)} - Dashboard</title>
<style>${css()}${navChromeCss()}</style>
</head>
<body>
${renderTopNav()}
<div class="${layoutClass}">
  ${renderSideNav('dashboard', `<a href="#" class="awsui-side-nav-item active"><span class="awsui-side-nav-icon">📊</span>ダッシュボード</a>
    <div class="awsui-side-nav-divider"></div>
    <div class="awsui-side-nav-section">セクション</div>
    ${tabs.map(t => `<a href="#${t.id}" class="awsui-side-nav-item"><span class="awsui-side-nav-icon">›</span>${t.label}</a>`).join('')}`)}
  <main class="awsui-content">
    <div class="awsui-breadcrumb">
      <a href="/">GameDay Plan Generator</a>
      <span class="awsui-breadcrumb-sep">/</span>
      <span class="awsui-breadcrumb-current">ダッシュボード</span>
    </div>
    ${renderHeader(plan)}
    <div class="awsui-tabs">${tabsHtml}</div>
    <div id="report">${renderReport(enrichedScenarios, config, advice, plan)}</div>
    <div id="scenarios">${renderScenarios(enrichedScenarios, fisDeployments, observations, unscheduledIds)}</div>
    <div id="timeline">${renderTimeline(plan, timelineRationales, enrichedScenarios.filter(s => unscheduledIds.has(s.id)))}</div>
    <div id="fis">${renderFisDeployments(fisDeployments)}</div>
    <div id="trend">${renderTrend(pastResults)}</div>
    <div class="awsui-footer">GameDay Plan Generator Dashboard</div>
  </main>
  ${chatPanel}
</div>
${keyboardScript()}
${chatScript}
</body>
</html>`;
}

// ============================================================
// Chat panel
// ============================================================

function renderChatPanel(
  sessionId: string,
  history: Array<{ role: 'user' | 'assistant'; content: string; timestamp: number }>,
): string {
  const messages = history.map(m => {
    const cls = m.role === 'user' ? 'chat-msg chat-msg-user' : 'chat-msg chat-msg-ai';
    const icon = m.role === 'user' ? '👤' : '🤖';
    return `<div class="${cls}"><div class="chat-msg-icon">${icon}</div><div class="chat-msg-bubble">${esc(m.content).replace(/\n/g, '<br>')}</div></div>`;
  }).join('');

  const welcome = history.length === 0 ? `
    <div class="chat-welcome">
      <div class="chat-welcome-icon">🤖</div>
      <div class="chat-welcome-text">計画について何でも質問してください</div>
      <div class="chat-welcome-hint">例:「半日にして」「ネットワーク系のシナリオを外して」「参加者を8人に」「Critical優先順で」</div>
    </div>` : '';

  return `
  <aside class="chat-panel" data-session-id="${esc(sessionId)}">
    <div class="chat-header">
      <span class="chat-title">💬 計画編集チャット</span>
      <span class="chat-subtitle">AI編集</span>
    </div>
    <div class="chat-messages" id="chatMessages">${welcome}${messages}</div>
    <div class="chat-input-area">
      <textarea id="chatInput" class="chat-input" placeholder="メッセージを入力（⌘+Enter / Ctrl+Enter で送信）" rows="2"></textarea>
      <button id="chatSend" class="chat-send-btn" aria-label="送信">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      </button>
    </div>
    <div class="chat-status" id="chatStatus"></div>
  </aside>`;
}

function renderChatScript(sessionId: string): string {
  return `<script>
(function(){
  var input = document.getElementById('chatInput');
  var sendBtn = document.getElementById('chatSend');
  var messages = document.getElementById('chatMessages');
  var status = document.getElementById('chatStatus');
  var sessionId = ${JSON.stringify(sessionId)};
  if (!input || !sendBtn || !messages) return;

  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function addMsg(role, text){
    var welcome = messages.querySelector('.chat-welcome');
    if (welcome) welcome.remove();
    var icon = role === 'user' ? '👤' : '🤖';
    var cls = role === 'user' ? 'chat-msg chat-msg-user' : 'chat-msg chat-msg-ai';
    var div = document.createElement('div');
    div.className = cls;
    div.innerHTML = '<div class="chat-msg-icon">'+icon+'</div><div class="chat-msg-bubble">'+esc(text).replace(/\\n/g,'<br>')+'</div>';
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  async function send(){
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';
    addMsg('user', text);
    status.textContent = '考え中...';
    sendBtn.disabled = true;
    try {
      var r = await fetch('/chat/'+sessionId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      var data = await r.json();
      if (data.message) addMsg('assistant', data.message);
      if (data.actions && data.actions.some(function(a){ return a.type !== 'none'; })) {
        status.innerHTML = '<span class="chat-status-updated">✓ 計画を更新しました。ページを再読み込みして確認</span> <button class="chat-reload-btn" onclick="location.reload()">再読み込み</button>';
      } else {
        status.textContent = '';
      }
    } catch(err){
      addMsg('assistant', 'エラー: ' + (err && err.message ? err.message : err));
      status.textContent = '';
    }
    sendBtn.disabled = false;
  }

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', function(e){
    // 送信トリガーは Cmd+Enter (mac) / Ctrl+Enter (win,linux) のみ。
    // IME 変換中の Enter はそのまま確定として扱い、絶対に送信しない。
    var composing = e.isComposing || e.keyCode === 229;
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !composing){
      e.preventDefault();
      send();
    }
  });
  input.addEventListener('input', function(){
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });
})();
</script>`;
}
