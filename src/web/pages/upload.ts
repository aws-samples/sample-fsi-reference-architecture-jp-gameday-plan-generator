/**
 * アップロードページ HTML - Cloudscape Design風
 */
import type { SessionSummary } from '../session-store.js';
import { mdToHtml } from '../../dashboard/markdown.js';
import { renderTopNav, renderSideNav, navChromeCss } from './layout.js';

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtDate(t: number): string {
  const d = new Date(t);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function sevPills(b: SessionSummary['severityBreakdown']): string {
  const colors = { Critical: '#d91515', High: '#ff9900', Medium: '#0972d3', Low: '#037f0c' };
  const labels: Array<keyof typeof colors> = ['Critical', 'High', 'Medium', 'Low'];
  return labels.map(k => b[k] > 0
    ? `<span class="sev-pill" style="background:${colors[k]}1a;color:${colors[k]};border:1px solid ${colors[k]}66"><span style="font-weight:700">${b[k]}</span> ${k}</span>`
    : '').join('');
}

export function renderUploadPage(recentSessions: SessionSummary[] = []): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GameDay Plan Generator</title>
<style>
${cloudscapeCSS()}
${navChromeCss()}
</style>
</head>
<body>
<!-- Top Navigation -->
${renderTopNav()}

<div class="awsui-app-layout">
  <!-- Side Navigation -->
  ${renderSideNav('generate')}

  <!-- Main Content -->
  <main class="awsui-content">
    <!-- Breadcrumb -->
    <div class="awsui-breadcrumb">
      <span>GameDay Plan Generator</span>
      <span class="awsui-breadcrumb-sep">/</span>
      <span class="awsui-breadcrumb-current">計画生成</span>
    </div>

    <!-- Page Header -->
    <div class="awsui-content-header">
      <h1 class="awsui-heading-l">GameDay計画を生成</h1>
      <p class="awsui-text-secondary">CloudFormationテンプレートまたは構成図をアップロードして、障害対応訓練計画を自動生成します。</p>
    </div>

    <!-- Tutorial / How to use -->
    <details class="tutorial" open>
      <summary class="tutorial-summary">
        <span class="tutorial-summary-icon">📖</span>
        <span class="tutorial-summary-title">このツールについて / 使い方</span>
        <span class="tutorial-summary-hint">クリックで開閉</span>
      </summary>
      <div class="tutorial-body">
        <div class="tutorial-lead">
          <strong>GameDay Plan Generator</strong> は、AWS構成情報から
          <strong>障害対応訓練（GameDay）の実施計画を自動生成</strong>するツールです。
          構成をアップロードするだけで、障害シナリオ・実施タイムライン・観測ポイント・評価基準・
          AWS FIS実験テンプレートまで一式が数分で揃います。
        </div>

        <div class="tutorial-steps">
          <div class="tutorial-step">
            <div class="tutorial-step-num">1</div>
            <div class="tutorial-step-body">
              <div class="tutorial-step-title">構成をアップロード</div>
              <div class="tutorial-step-desc">CloudFormation（JSON / YAML）または構成図（PNG / JPG）をドラッグ＆ドロップ。構成図はAIが自動でCFn相当に解析します。</div>
            </div>
          </div>
          <div class="tutorial-step">
            <div class="tutorial-step-num">2</div>
            <div class="tutorial-step-body">
              <div class="tutorial-step-title">設定を選ぶ</div>
              <div class="tutorial-step-desc">実施形式（半日〜2日）・参加者数・AIモデルを選択して「計画を生成」。生成には数十秒〜数分かかります。</div>
            </div>
          </div>
          <div class="tutorial-step">
            <div class="tutorial-step-num">3</div>
            <div class="tutorial-step-body">
              <div class="tutorial-step-title">ダッシュボードで確認</div>
              <div class="tutorial-step-desc">📊計画レポートで「なぜこの計画か」を把握。シナリオ一覧・タイムライン・観測ポイント・評価基準をタブで確認できます。</div>
            </div>
          </div>
          <div class="tutorial-step">
            <div class="tutorial-step-num">4</div>
            <div class="tutorial-step-body">
              <div class="tutorial-step-title">FIS実験を実行</div>
              <div class="tutorial-step-desc">🧪FIS実験タブから、デプロイ可能なCloudFormationテンプレートを取得。「CFnコンソールで起動」ですぐにデプロイできます。</div>
            </div>
          </div>
        </div>

        <div class="tutorial-outputs">
          <div class="tutorial-outputs-title">生成される成果物</div>
          <div class="tutorial-output-chips">
            <span class="tutorial-chip">📋 障害シナリオ（理由つき）</span>
            <span class="tutorial-chip">🗓 実施タイムライン</span>
            <span class="tutorial-chip">👁 観測ポイント（CloudWatch）</span>
            <span class="tutorial-chip">✅ 評価基準</span>
            <span class="tutorial-chip">🧪 FIS実験テンプレート（CFn）</span>
            <span class="tutorial-chip">🤖 AI分析レポート</span>
          </div>
        </div>

        <div class="tutorial-tip">
          💡 <strong>はじめての方へ</strong>：手元に構成ファイルがなくても、
          一般的な構成図の画像をアップロードすれば試せます。生成後はダッシュボード右側の
          チャットで「半日にして」「ネットワーク系を外して」のように対話編集もできます。
        </div>
      </div>
    </details>

    <form id="uploadForm" action="/generate" method="POST" enctype="multipart/form-data">
      <!-- Upload Container -->
      <div class="awsui-container">
        <div class="awsui-container-header">
          <h2 class="awsui-heading-m">構成情報のアップロード</h2>
          <p class="awsui-text-secondary">CloudFormation JSON/YAML または構成図（PNG/JPG）をアップロードしてください。</p>
        </div>
        <div class="awsui-container-body">
          <div class="awsui-form-field">
            <label class="awsui-label">ファイル選択 <span class="awsui-label-required">*</span></label>
            <div class="awsui-drop-zone" id="dropZone">
              <input type="file" name="file" id="fileInput" accept=".json,.yaml,.yml,.template,.png,.jpg,.jpeg,.gif,.webp">
              <div class="awsui-drop-zone-content">
                <div class="awsui-drop-zone-icon">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#0972d3" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                </div>
                <div class="awsui-drop-zone-text">ファイルをドラッグ＆ドロップ</div>
                <div class="awsui-drop-zone-hint">またはクリックして選択</div>
              </div>
            </div>
            <div class="awsui-file-info" id="fileInfo">
              <span class="awsui-file-icon" id="fileIcon">📄</span>
              <span class="awsui-file-name" id="fileName"></span>
              <button type="button" class="awsui-btn-icon" id="removeFile" aria-label="ファイルを削除">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div class="awsui-form-hint">
              対応形式:
              <span class="awsui-badge awsui-badge-blue">CloudFormation JSON</span>
              <span class="awsui-badge awsui-badge-blue">CloudFormation YAML</span>
              <span class="awsui-badge awsui-badge-green">構成図 PNG/JPG</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Options Container -->
      <div class="awsui-container" style="margin-top:20px">
        <div class="awsui-container-header">
          <h2 class="awsui-heading-m">GameDay設定</h2>
        </div>
        <div class="awsui-container-body">
          <div class="awsui-column-layout">
            <div class="awsui-form-field">
              <label class="awsui-label" for="duration">実施形式</label>
              <div class="awsui-select-wrap">
                <select name="duration" id="duration" class="awsui-select">
                  <option value="half-day">半日（4時間）</option>
                  <option value="full-day" selected>1日（8時間）</option>
                  <option value="two-day">2日間（16時間）</option>
                </select>
              </div>
              <div class="awsui-form-description">GameDayの実施時間を選択します。</div>
            </div>
            <div class="awsui-form-field">
              <label class="awsui-label" for="participants">参加者数</label>
              <input type="number" name="participants" id="participants" value="6" min="1" max="100" class="awsui-input">
              <div class="awsui-form-description">参加者数に応じて役割分担を自動調整します。</div>
            </div>
          </div>
          <div class="awsui-form-field" style="margin-top:16px">
            <label class="awsui-label" for="model">🤖 AIモデル <span class="awsui-label-required">*</span></label>
            <div class="awsui-select-wrap">
              <select name="model" id="model" class="awsui-select">
                <option value="claude-opus-4-6" selected>Claude Opus 4.6 — バランス型・1Mコンテキスト</option>
                <option value="claude-opus-4-7">Claude Opus 4.7 — 推論性能向上</option>
                <option value="claude-opus-4-8">Claude Opus 4.8 — 最新・1Mコンテキスト</option>
              </select>
            </div>
            <div class="awsui-form-description">
              シナリオ生成・rationale・アドバイスは Amazon Bedrock 経由で実行されます。生成には数十秒〜数分かかります。
            </div>
          </div>
        </div>
      </div>

      <!-- Actions -->
      <div class="awsui-actions" style="margin-top:20px">
        <button type="submit" class="awsui-btn awsui-btn-primary" id="submitBtn" disabled>計画を生成</button>
      </div>

      <!-- Loading -->
      <div class="awsui-loading" id="loading">
        <div class="awsui-spinner"></div>
        <div class="awsui-loading-text">GameDay計画を生成中...</div>
        <div class="awsui-loading-hint">シナリオ分析・計画策定・ダッシュボード生成を実行しています</div>
      </div>
    </form>

    ${recentSessions.length > 0 ? `
    <!-- Recent Sessions -->
    <div class="awsui-container" style="margin-top:24px">
      <div class="awsui-container-header">
        <h2 class="awsui-heading-m">📚 最近の計画</h2>
        <p class="awsui-text-secondary">直近の${recentSessions.length}件 — 「📖 レポート」で詳細展開</p>
      </div>
      <div class="awsui-container-body" style="padding:0">
        <table class="awsui-recent-table">
          <thead>
            <tr><th>計画名</th><th>シナリオ</th><th>重大度分布</th><th>生成日時</th><th>アクション</th></tr>
          </thead>
          <tbody>
            ${recentSessions.map(s => `
            <tr class="recent-main">
              <td><a href="/dashboard/${escHtml(s.id)}" class="awsui-recent-link"><strong>${escHtml(s.title)}</strong></a></td>
              <td>${s.scenarioCount}件</td>
              <td>${sevPills(s.severityBreakdown)}</td>
              <td>${fmtDate(s.createdAt)}</td>
              <td>
                <a href="/dashboard/${escHtml(s.id)}" class="awsui-recent-link">開く</a>
                · <a href="/download/${escHtml(s.id)}" class="awsui-recent-dl">DL</a>
                · <button class="recent-toggle" data-target="rec-${escHtml(s.id)}" aria-expanded="false">📖 レポート</button>
              </td>
            </tr>
            <tr class="recent-detail" id="rec-${escHtml(s.id)}" hidden>
              <td colspan="5">
                <div class="recent-detail-content">
                  <div class="recent-section">
                    <h3>📊 構成サマリー</h3>
                    <div class="kv-grid">
                      <div class="kv"><span class="kv-key">リソース</span><span class="kv-val">${s.resourceCount}個</span></div>
                      <div class="kv"><span class="kv-key">観測ポイント</span><span class="kv-val">${s.observationCount}件</span></div>
                      <div class="kv"><span class="kv-key">評価基準</span><span class="kv-val">${s.evaluationCount}件</span></div>
                      <div class="kv"><span class="kv-key">リージョン</span><span class="kv-val">${escHtml(s.regions.join(', ')) || '—'}</span></div>
                      <div class="kv"><span class="kv-key">マルチリージョン</span><span class="kv-val ${s.isMultiRegion ? 'tag-yes' : 'tag-no'}">${s.isMultiRegion ? 'はい' : 'いいえ'}</span></div>
                      <div class="kv"><span class="kv-key">暗号化</span><span class="kv-val ${s.hasEncryption ? 'tag-yes' : 'tag-no'}">${s.hasEncryption ? 'あり' : 'なし'}</span></div>
                    </div>
                  </div>
                  <div class="recent-section">
                    <h3>🤖 AI分析レポート</h3>
                    ${s.advice
                      ? `<div class="advice-md">${mdToHtml(s.advice)}</div>`
                      : `<div class="advice-empty">この計画にはAI分析レポートがありません（AI強化モードがOFFだった可能性）</div>`}
                  </div>
                </div>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="awsui-container-footer">
        <a href="/history" class="awsui-link">すべての履歴を見る →</a>
      </div>
    </div>
    ` : ''}
  </main>
</div>

<script>
  const dropZone=document.getElementById('dropZone');
  const fileInput=document.getElementById('fileInput');
  const fileInfo=document.getElementById('fileInfo');
  const fileIcon=document.getElementById('fileIcon');
  const fileName=document.getElementById('fileName');
  const removeFile=document.getElementById('removeFile');
  const submitBtn=document.getElementById('submitBtn');
  const form=document.getElementById('uploadForm');
  const loading=document.getElementById('loading');

  function updateFileInfo(file){
    if(!file){fileInfo.classList.remove('visible');submitBtn.disabled=true;return}
    const ext=file.name.split('.').pop().toLowerCase();
    const isImage=['png','jpg','jpeg','gif','webp'].includes(ext);
    fileIcon.textContent=isImage?'🖼️':'📄';
    fileName.textContent=file.name+' ('+( file.size/1024).toFixed(1)+'KB)';
    fileInfo.classList.add('visible');
    submitBtn.disabled=false;
  }
  fileInput.addEventListener('change',()=>updateFileInfo(fileInput.files[0]));
  removeFile.addEventListener('click',()=>{fileInput.value='';updateFileInfo(null)});
  dropZone.addEventListener('dragover',e=>{e.preventDefault();dropZone.classList.add('dragover')});
  dropZone.addEventListener('dragleave',()=>dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop',e=>{e.preventDefault();dropZone.classList.remove('dragover');if(e.dataTransfer.files.length){fileInput.files=e.dataTransfer.files;updateFileInfo(e.dataTransfer.files[0])}});
  form.addEventListener('submit',()=>{submitBtn.style.display='none';loading.classList.add('visible')});

  // 「📖 レポート」トグル
  document.querySelectorAll('.recent-toggle').forEach(function(btn){
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

function cloudscapeCSS(): string {
  return `
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{background:#f2f3f3;color:#000716;font-family:'Amazon Ember','Helvetica Neue','Segoe UI','Hiragino Sans',sans-serif;font-size:14px;line-height:1.5}

  /* Top Navigation */
  .awsui-top-nav{background:#232f3e;color:#fff;height:48px;display:flex;align-items:center;padding:0 20px;position:sticky;top:0;z-index:100}
  .awsui-top-nav-inner{display:flex;align-items:center;justify-content:space-between;width:100%}
  .awsui-top-nav-left{display:flex;align-items:center;gap:10px}
  .awsui-service-icon{font-size:20px}
  .awsui-service-name{font-size:16px;font-weight:700;letter-spacing:.3px}
  .awsui-top-nav-right{display:flex;align-items:center;gap:16px;font-size:13px;color:#d5dbdb}
  .awsui-nav-item{cursor:pointer;padding:4px 8px;border-radius:4px}
  .awsui-nav-item:hover{background:#37475a}
  .awsui-nav-divider{width:1px;height:20px;background:#5f6b7a}

  /* App Layout */
  .awsui-app-layout{display:flex;min-height:calc(100vh - 48px)}

  /* Side Navigation */
  .awsui-side-nav{width:240px;background:#fff;border-right:1px solid #e9ebed;padding:16px 0;flex-shrink:0}
  .awsui-side-nav-header{padding:8px 20px 16px;font-size:16px;font-weight:700;color:#000716}
  .awsui-side-nav-item{display:flex;align-items:center;gap:8px;padding:8px 20px;color:#5f6b7a;text-decoration:none;font-size:14px;border-left:3px solid transparent;transition:all .15s}
  .awsui-side-nav-item:hover{background:#f2f3f3;color:#000716}
  .awsui-side-nav-item.active{border-left-color:#0972d3;color:#0972d3;background:#f2f8fd;font-weight:600}
  .awsui-side-nav-icon{font-size:16px;width:20px;text-align:center}
  .awsui-side-nav-divider{height:1px;background:#e9ebed;margin:12px 20px}
  .awsui-side-nav-section{padding:4px 20px;font-size:12px;font-weight:700;color:#5f6b7a;text-transform:uppercase;letter-spacing:.5px}

  /* Content */
  .awsui-content{flex:1;padding:20px 28px 40px;max-width:1200px}

  /* Breadcrumb */
  .awsui-breadcrumb{font-size:13px;color:#5f6b7a;margin-bottom:8px}
  .awsui-breadcrumb-sep{margin:0 6px;color:#9ba7b6}
  .awsui-breadcrumb-current{color:#0972d3}

  /* Content Header */
  .awsui-content-header{margin-bottom:24px}
  .awsui-heading-l{font-size:24px;font-weight:700;color:#000716;margin-bottom:4px}
  .awsui-heading-m{font-size:18px;font-weight:700;color:#000716;margin-bottom:2px}
  .awsui-text-secondary{font-size:14px;color:#5f6b7a}

  /* Container (Card) */
  .awsui-container{background:#fff;border:1px solid #e9ebed;border-radius:12px;overflow:hidden}
  .awsui-container-header{padding:20px 24px 12px;border-bottom:1px solid #e9ebed}
  .awsui-container-body{padding:20px 24px 24px}

  /* Form */
  .awsui-form-field{margin-bottom:20px}
  .awsui-form-field:last-child{margin-bottom:0}
  .awsui-label{display:block;font-size:14px;font-weight:700;color:#000716;margin-bottom:6px}
  .awsui-label-required{color:#d91515}
  .awsui-form-hint{font-size:13px;color:#5f6b7a;margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center}
  .awsui-form-description{font-size:13px;color:#5f6b7a;margin-top:4px}

  /* Input & Select */
  .awsui-input,.awsui-select{
    width:100%;padding:8px 12px;background:#fff;
    border:2px solid #7d8998;border-radius:8px;
    font-size:14px;color:#000716;transition:border-color .15s;
  }
  .awsui-input:focus,.awsui-select:focus{outline:none;border-color:#0972d3;box-shadow:0 0 0 1px #0972d3}
  .awsui-select-wrap{position:relative}

  /* Column Layout */
  .awsui-column-layout{display:grid;grid-template-columns:1fr 1fr;gap:24px}

  /* Drop Zone */
  .awsui-drop-zone{
    border:2px dashed #9ba7b6;border-radius:8px;padding:40px 24px;
    text-align:center;cursor:pointer;transition:all .2s;position:relative;
  }
  .awsui-drop-zone:hover,.awsui-drop-zone.dragover{border-color:#0972d3;background:#f2f8fd}
  .awsui-drop-zone input[type="file"]{position:absolute;inset:0;opacity:0;cursor:pointer}
  .awsui-drop-zone-icon{margin-bottom:12px}
  .awsui-drop-zone-text{font-size:16px;font-weight:600;color:#000716;margin-bottom:4px}
  .awsui-drop-zone-hint{font-size:13px;color:#5f6b7a}

  /* File Info */
  .awsui-file-info{
    display:none;padding:12px 16px;background:#f2f8fd;border:1px solid #0972d3;
    border-radius:8px;margin-top:12px;align-items:center;gap:10px;
  }
  .awsui-file-info.visible{display:flex}
  .awsui-file-icon{font-size:20px}
  .awsui-file-name{flex:1;font-size:14px;color:#000716;word-break:break-all}
  .awsui-btn-icon{
    background:none;border:none;cursor:pointer;color:#5f6b7a;padding:4px;
    border-radius:4px;display:flex;align-items:center;
  }
  .awsui-btn-icon:hover{background:#e9ebed;color:#d91515}

  /* Badge */
  .awsui-badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600}
  .awsui-badge-blue{background:#f2f8fd;color:#0972d3;border:1px solid #0972d333}
  .awsui-badge-green{background:#f2fcf3;color:#037f0c;border:1px solid #037f0c33}
  .awsui-badge-red{background:#fff7f7;color:#d91515;border:1px solid #d9151533}
  .awsui-badge-grey{background:#f2f3f3;color:#5f6b7a;border:1px solid #5f6b7a33}

  /* Button */
  .awsui-btn{
    padding:8px 20px;border-radius:8px;font-size:14px;font-weight:600;
    cursor:pointer;border:2px solid transparent;transition:all .15s;
  }
  .awsui-btn-primary{background:#0972d3;color:#fff;border-color:#0972d3}
  .awsui-btn-primary:hover{background:#033160;border-color:#033160}
  .awsui-btn-primary:disabled{background:#9ba7b6;border-color:#9ba7b6;cursor:not-allowed}
  .awsui-btn-normal{background:#fff;color:#0972d3;border-color:#0972d3}
  .awsui-btn-normal:hover{background:#f2f8fd}

  /* Actions */
  .awsui-actions{display:flex;justify-content:flex-end;gap:12px}

  /* Loading */
  .awsui-loading{display:none;text-align:center;padding:32px;margin-top:20px;background:#fff;border:1px solid #e9ebed;border-radius:12px}
  .awsui-loading.visible{display:block}
  .awsui-spinner{width:40px;height:40px;border:3px solid #e9ebed;border-top-color:#0972d3;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 12px}
  @keyframes spin{to{transform:rotate(360deg)}}
  .awsui-loading-text{font-size:16px;font-weight:600;color:#000716}
  .awsui-loading-hint{font-size:13px;color:#5f6b7a;margin-top:4px}

  /* Toggle Switch */
  .awsui-toggle-label{display:flex;align-items:center;gap:12px;cursor:pointer;user-select:none}
  .awsui-toggle-input{display:none}
  .awsui-toggle-slider{position:relative;width:44px;height:24px;background:#9ba7b6;border-radius:12px;transition:background .2s;flex-shrink:0}
  .awsui-toggle-slider::after{content:'';position:absolute;top:2px;left:2px;width:20px;height:20px;background:#fff;border-radius:50%;transition:transform .2s}
  .awsui-toggle-input:checked+.awsui-toggle-slider{background:#0972d3}
  .awsui-toggle-input:checked+.awsui-toggle-slider::after{transform:translateX(20px)}
  .awsui-toggle-text{font-size:14px;font-weight:600;color:#000716}

  /* Recent sessions table */
  .awsui-recent-table{width:100%;border-collapse:collapse}
  .awsui-recent-table th{text-align:left;padding:10px 24px;font-size:12px;font-weight:600;color:#5f6b7a;background:#fafbfc;border-bottom:1px solid #e9ebed}
  .awsui-recent-table td{padding:12px 24px;font-size:14px;color:#000716;border-bottom:1px solid #e9ebed;vertical-align:middle}
  .awsui-recent-table tr.recent-main:last-child td{border-bottom:none}
  .awsui-recent-table tr.recent-main:hover{background:#f7f8fa}
  .awsui-recent-table tr.recent-detail td{padding:0;background:#fafbfc;border-bottom:1px solid #e9ebed}
  .awsui-recent-link{color:#0972d3;text-decoration:none}
  .awsui-recent-link:hover{text-decoration:underline}
  .awsui-recent-dl{color:#5f6b7a;text-decoration:none;font-size:13px}
  .awsui-recent-dl:hover{color:#0972d3}
  .awsui-link{color:#0972d3;text-decoration:none;font-size:13px;font-weight:600}
  .awsui-link:hover{text-decoration:underline}
  .awsui-container-footer{padding:14px 24px;border-top:1px solid #e9ebed;background:#fafbfc;text-align:right}

  .recent-toggle{background:#fff;border:1px solid #0972d3;color:#0972d3;padding:4px 10px;border-radius:4px;font-size:12px;cursor:pointer;font-family:inherit;font-weight:600;margin-left:4px}
  .recent-toggle:hover{background:#f2f8fd}
  .recent-toggle[aria-expanded="true"]{background:#0972d3;color:#fff}
  .sev-pill{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;margin-right:4px;font-weight:500}

  .recent-detail-content{padding:18px 24px}
  .recent-section{margin-bottom:18px}
  .recent-section:last-child{margin-bottom:0}
  .recent-section h3{font-size:14px;font-weight:700;color:#000716;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #e9ebed}
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

  /* Tutorial / How-to section */
  .tutorial{background:#fff;border:1px solid #e9ebed;border-radius:12px;margin-bottom:24px;overflow:hidden}
  .tutorial[open]{border-color:#ef7a0c66}
  .tutorial-summary{display:flex;align-items:center;gap:10px;padding:16px 24px;cursor:pointer;list-style:none;background:linear-gradient(90deg,#fff7ef,#fff);user-select:none}
  .tutorial-summary::-webkit-details-marker{display:none}
  .tutorial-summary-icon{font-size:22px}
  .tutorial-summary-title{font-size:18px;font-weight:700;color:#000716;flex:1}
  .tutorial-summary-hint{font-size:12px;color:#9ba7b6}
  .tutorial[open] .tutorial-summary{border-bottom:1px solid #e9ebed}
  .tutorial-body{padding:20px 24px 24px}
  .tutorial-lead{font-size:15px;line-height:1.8;color:#000716;margin-bottom:20px}
  .tutorial-lead strong{color:#ef7a0c}

  .tutorial-steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-bottom:20px}
  .tutorial-step{display:flex;gap:12px;align-items:flex-start;background:#fafbfc;border:1px solid #e9ebed;border-radius:8px;padding:14px 16px}
  .tutorial-step-num{flex-shrink:0;width:30px;height:30px;border-radius:50%;background:#ef7a0c;color:#fff;font-weight:700;font-size:16px;display:flex;align-items:center;justify-content:center}
  .tutorial-step-title{font-size:15px;font-weight:700;color:#000716;margin-bottom:4px}
  .tutorial-step-desc{font-size:13px;line-height:1.6;color:#5f6b7a}

  .tutorial-outputs{margin-bottom:18px}
  .tutorial-outputs-title{font-size:13px;font-weight:700;color:#5f6b7a;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px}
  .tutorial-output-chips{display:flex;flex-wrap:wrap;gap:8px}
  .tutorial-chip{display:inline-block;padding:6px 14px;background:#fff7ef;border:1px solid #ef7a0c66;color:#c2570a;border-radius:20px;font-size:14px;font-weight:600}

  .tutorial-tip{font-size:14px;line-height:1.7;color:#000716;background:#fff7ef;border-left:4px solid #ef7a0c;border-radius:6px;padding:14px 18px}
  .tutorial-tip strong{color:#ef7a0c}

  @media(max-width:768px){
    .awsui-side-nav{display:none}
    .awsui-column-layout{grid-template-columns:1fr}
    .awsui-recent-table th,.awsui-recent-table td{padding:8px 12px}
    .tutorial-steps{grid-template-columns:1fr}
  }
  `;
}
