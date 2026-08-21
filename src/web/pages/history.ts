/**
 * 過去計画一覧ページ（分析レポート展開対応）
 */

import type { SessionSummary } from '../session-store.js';
import { mdToHtml as markdownToHtml } from '../../dashboard/markdown.js';
import { renderTopNav, renderSideNav, navChromeCss } from './layout.js';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDuration(d: string): string {
  return d === 'half-day' ? '半日' : d === 'full-day' ? '1日' : d === 'two-day' ? '2日' : d;
}

function renderSeverityBars(b: SessionSummary['severityBreakdown']): string {
  const total = b.Critical + b.High + b.Medium + b.Low || 1;
  const colors = { Critical: '#d91515', High: '#ff9900', Medium: '#0972d3', Low: '#037f0c' };
  const labels: Array<keyof typeof colors> = ['Critical', 'High', 'Medium', 'Low'];
  return labels.map(k => {
    const pct = Math.round((b[k] / total) * 100);
    return b[k] > 0 ? `<span class="sev-pill" style="background:${colors[k]}1a;color:${colors[k]};border:1px solid ${colors[k]}66"><span style="font-weight:700">${b[k]}</span> ${k}</span>` : '';
  }).join('');
}

function renderRow(s: SessionSummary): string {
  const advice = s.advice
    ? `<div class="advice-md">${markdownToHtml(s.advice)}</div>`
    : `<div class="advice-empty">この計画にはAI分析レポートがありません（AI強化モードがOFFだった可能性）</div>`;

  return `
  <tr class="main-row" data-target="detail-${escapeHtml(s.id)}">
    <td><strong>${escapeHtml(s.title)}</strong></td>
    <td>${s.scenarioCount}件</td>
    <td>${renderSeverityBars(s.severityBreakdown)}</td>
    <td>${formatDuration(s.duration)}</td>
    <td>${formatDate(s.createdAt)}</td>
    <td>
      <a href="/dashboard/${escapeHtml(s.id)}" class="awsui-link">開く</a>
      · <a href="/download/${escapeHtml(s.id)}" class="awsui-link">DL</a>
      · <button class="toggle-btn" data-target="detail-${escapeHtml(s.id)}" aria-expanded="false">📖 レポート</button>
    </td>
  </tr>
  <tr class="detail-row" id="detail-${escapeHtml(s.id)}" hidden>
    <td colspan="6">
      <div class="detail-content">
        <div class="detail-section">
          <h3>📊 構成サマリー</h3>
          <div class="kv-grid">
            <div class="kv"><span class="kv-key">リソース</span><span class="kv-val">${s.resourceCount}個</span></div>
            <div class="kv"><span class="kv-key">観測ポイント</span><span class="kv-val">${s.observationCount}件</span></div>
            <div class="kv"><span class="kv-key">評価基準</span><span class="kv-val">${s.evaluationCount}件</span></div>
            <div class="kv"><span class="kv-key">リージョン</span><span class="kv-val">${escapeHtml(s.regions.join(', ')) || '—'}</span></div>
            <div class="kv"><span class="kv-key">マルチリージョン</span><span class="kv-val ${s.isMultiRegion ? 'tag-yes' : 'tag-no'}">${s.isMultiRegion ? 'はい' : 'いいえ'}</span></div>
            <div class="kv"><span class="kv-key">暗号化</span><span class="kv-val ${s.hasEncryption ? 'tag-yes' : 'tag-no'}">${s.hasEncryption ? 'あり' : 'なし'}</span></div>
          </div>
        </div>
        <div class="detail-section">
          <h3>🤖 AI分析レポート</h3>
          ${advice}
        </div>
      </div>
    </td>
  </tr>`;
}

export function renderHistoryPage(sessions: SessionSummary[]): string {
  const rows = sessions.length === 0
    ? `<tr><td colspan="6" class="empty">過去の計画はまだありません</td></tr>`
    : sessions.map(renderRow).join('');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>過去の計画 - GameDay Plan Generator</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:#f2f3f3;color:#000716;font-family:'Amazon Ember','Helvetica Neue','Segoe UI','Hiragino Sans',sans-serif;font-size:14px;line-height:1.5}
${navChromeCss()}
.content{flex:1;max-width:1280px;padding:24px 28px}
.breadcrumb{font-size:13px;color:#5f6b7a;margin-bottom:8px}
.breadcrumb a{color:#0972d3;text-decoration:none}
h1{font-size:24px;font-weight:700;margin-bottom:4px}
.subtitle{font-size:14px;color:#5f6b7a;margin-bottom:24px}
.container{background:#fff;border:1px solid #e9ebed;border-radius:12px;overflow:hidden}
.container-header{padding:20px 24px 12px;border-bottom:1px solid #e9ebed}
.container-header h2{font-size:18px;font-weight:700;margin-bottom:2px}
.container-header p{font-size:14px;color:#5f6b7a}
table{width:100%;border-collapse:collapse}
th{text-align:left;padding:12px 16px;font-size:13px;font-weight:600;color:#5f6b7a;background:#fafbfc;border-bottom:1px solid #e9ebed;white-space:nowrap}
td{padding:12px 16px;font-size:14px;border-bottom:1px solid #e9ebed;vertical-align:middle}
.main-row td{cursor:default}
tr.main-row:hover{background:#f7f8fa}
.detail-row td{padding:0;background:#fafbfc;border-bottom:1px solid #e9ebed}
tr:last-child td{border-bottom:none}
.empty{text-align:center;color:#5f6b7a;padding:40px}
.awsui-link{color:#0972d3;text-decoration:none;font-weight:500}
.awsui-link:hover{text-decoration:underline}
.toggle-btn{background:#fff;border:1px solid #0972d3;color:#0972d3;padding:4px 10px;border-radius:4px;font-size:12px;cursor:pointer;font-family:inherit;font-weight:600;margin-left:4px}
.toggle-btn:hover{background:#f2f8fd}
.toggle-btn[aria-expanded="true"]{background:#0972d3;color:#fff}
.sev-pill{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;margin-right:4px;font-weight:500}

.detail-content{padding:20px 24px}
.detail-section{margin-bottom:20px}
.detail-section:last-child{margin-bottom:0}
.detail-section h3{font-size:14px;font-weight:700;color:#000716;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #e9ebed}
.kv-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px 16px}
.kv{display:flex;justify-content:space-between;padding:6px 10px;background:#fff;border-radius:4px;border:1px solid #e9ebed;font-size:13px}
.kv-key{color:#5f6b7a}
.kv-val{font-weight:600;color:#000716}
.tag-yes{color:#037f0c}
.tag-no{color:#5f6b7a}
.advice-md{font-size:14px;line-height:1.7;color:#000716;background:#fff;padding:16px 20px;border-radius:6px;border:1px solid #e9ebed}
.advice-md > *:first-child{margin-top:0}
.advice-md > *:last-child{margin-bottom:0}
.advice-md p{margin:0 0 10px 0}
.advice-md h3{color:#0972d3;font-size:16px;margin:16px 0 6px 0;border:none;padding:0;font-weight:700}
.advice-md h3:first-child{margin-top:0}
.advice-md h4{color:#0972d3;font-size:14px;margin:12px 0 4px 0;font-weight:700}
.advice-md strong{color:#0972d3;font-weight:700}
.advice-md code{background:#f2f3f3;border:1px solid #e9ebed;padding:1px 6px;border-radius:4px;font-size:12px;font-family:'SF Mono','Monaco','Consolas',monospace;color:#000716}
.advice-md ul,.advice-md ol{margin:6px 0 12px 24px;padding:0}
.advice-md li{margin:3px 0;line-height:1.6}
.advice-md li::marker{color:#0972d3}
.md-table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:10px 0 12px 0;border:1px solid #e9ebed;border-radius:6px;background:#fff}
.md-table{width:100%;border-collapse:collapse;font-size:13px}
.md-table th{text-align:left;padding:8px 12px;background:#f2f8fd;color:#000716;font-weight:700;border-bottom:1px solid #e9ebed;white-space:nowrap}
.md-table td{padding:8px 12px;color:#000716;border-bottom:1px solid #f2f3f3;vertical-align:top;line-height:1.55}
.md-table tr:last-child td{border-bottom:none}
.md-table tr:nth-child(even) td{background:#fafbfc}
.advice-empty{padding:14px 18px;color:#5f6b7a;background:#fafbfc;border-radius:6px;border:1px dashed #d5d8dd;font-size:14px}

.actions{margin-top:20px;display:flex;gap:12px}
.btn{padding:8px 20px;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;border:2px solid transparent;display:inline-block}
.btn-primary{background:#0972d3;color:#fff;border-color:#0972d3}
.btn-primary:hover{background:#033160}
</style>
</head>
<body>
${renderTopNav()}
<div class="awsui-app-layout">
  ${renderSideNav('history')}
  <main class="content">
    <div class="breadcrumb">
      <a href="/">GameDay Plan Generator</a> / 過去の計画
    </div>
    <h1>📚 過去の計画</h1>
    <p class="subtitle">これまでに生成した計画とAI分析レポート。「📖 レポート」で詳細展開。</p>

    <div class="container">
      <div class="container-header">
        <h2>計画一覧</h2>
        <p>${sessions.length}件</p>
      </div>
      <table>
        <thead>
          <tr><th>計画名</th><th>シナリオ</th><th>重大度分布</th><th>実施形式</th><th>生成日時</th><th>アクション</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <div class="actions">
      <a href="/" class="btn btn-primary">新しい計画を生成</a>
    </div>
  </main>
</div>

<script>
document.querySelectorAll('.toggle-btn').forEach(function(btn){
  btn.addEventListener('click', function(){
    var targetId = btn.getAttribute('data-target');
    var row = document.getElementById(targetId);
    if (!row) return;
    var hidden = row.hasAttribute('hidden');
    if (hidden) {
      row.removeAttribute('hidden');
      btn.setAttribute('aria-expanded', 'true');
      btn.textContent = '📖 閉じる';
    } else {
      row.setAttribute('hidden', '');
      btn.setAttribute('aria-expanded', 'false');
      btn.textContent = '📖 レポート';
    }
  });
});
</script>
</body>
</html>`;
}
