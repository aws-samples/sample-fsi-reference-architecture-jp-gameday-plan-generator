/**
 * ジョブ進捗ページ - SSEで進捗を受信して表示
 */

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderJobProgressPage(jobId: string, fileName: string): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>生成中... - GameDay Plan Generator</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:#f2f3f3;color:#000716;font-family:'Amazon Ember','Helvetica Neue','Segoe UI','Hiragino Sans',sans-serif;font-size:14px;line-height:1.5;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#fff;border:1px solid #e9ebed;border-radius:12px;padding:40px;max-width:600px;width:100%;box-shadow:0 4px 12px rgba(0,0,0,0.05)}
h1{font-size:22px;font-weight:700;margin-bottom:8px;color:#000716}
.file-name{font-size:14px;color:#5f6b7a;margin-bottom:24px;display:flex;align-items:center;gap:8px}
.progress-bar{width:100%;height:24px;background:#f2f3f3;border-radius:12px;overflow:hidden;margin-bottom:12px;position:relative}
.progress-fill{height:100%;background:linear-gradient(90deg,#0972d3,#539fe5);transition:width .4s ease;border-radius:12px;position:relative}
.progress-fill::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,0.4),transparent);animation:shimmer 2s infinite}
@keyframes shimmer{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
.progress-percent{font-size:12px;color:#5f6b7a;text-align:right;margin-bottom:20px}
.step{display:flex;align-items:center;gap:12px;padding:12px;background:#f2f8fd;border-radius:8px;margin-bottom:8px;border-left:3px solid #0972d3}
.step-icon{font-size:18px}
.step-text{font-size:14px;color:#000716;font-weight:500}
.log{margin-top:24px;padding:16px;background:#0d1117;color:#c9d1d9;border-radius:8px;font-family:'SF Mono','Monaco',monospace;font-size:12px;max-height:200px;overflow-y:auto}
.log-line{padding:2px 0;line-height:1.5}
.log-line.success{color:#7ee787}
.log-line.warning{color:#f0b72f}
.log-line.error{color:#ff7b72}
.error-box{background:#fff7f7;border:1px solid #d91515;border-radius:8px;padding:16px;margin-top:20px;color:#d91515}
.error-box h3{margin-bottom:6px}
.actions{margin-top:24px;display:flex;gap:12px;justify-content:flex-end}
.btn{padding:8px 20px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;border:2px solid transparent;text-decoration:none;display:inline-block}
.btn-primary{background:#0972d3;color:#fff;border-color:#0972d3}
.btn-primary:hover{background:#033160}
.btn-normal{background:#fff;color:#0972d3;border-color:#0972d3}
.spinner{display:inline-block;width:16px;height:16px;border:2px solid #e9ebed;border-top-color:#0972d3;border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="card">
  <h1>🎮 GameDay計画を生成中...</h1>
  <div class="file-name">📂 ${escapeHtml(fileName)}</div>

  <div class="progress-bar">
    <div class="progress-fill" id="bar" style="width:0%"></div>
  </div>
  <div class="progress-percent" id="percent">0%</div>

  <div class="step" id="currentStep">
    <span class="step-icon"><span class="spinner"></span></span>
    <span class="step-text" id="stepMessage">待機中...</span>
  </div>

  <div class="log" id="log"></div>

  <div id="errorBox" style="display:none" class="error-box">
    <h3>❌ エラー</h3>
    <div id="errorText"></div>
  </div>

  <div class="actions" id="actions" style="display:none">
    <a href="/" class="btn btn-normal">トップに戻る</a>
  </div>
</div>

<script>
(function(){
  var jobId = ${JSON.stringify(jobId)};
  var bar = document.getElementById('bar');
  var percent = document.getElementById('percent');
  var stepMessage = document.getElementById('stepMessage');
  var log = document.getElementById('log');
  var errorBox = document.getElementById('errorBox');
  var errorText = document.getElementById('errorText');
  var actions = document.getElementById('actions');

  function addLog(msg, cls){
    var line = document.createElement('div');
    line.className = 'log-line' + (cls ? ' ' + cls : '');
    line.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  addLog('接続中...');
  var es = new EventSource('/jobs/' + jobId + '/stream');

  es.addEventListener('progress', function(e){
    var data = JSON.parse(e.data);
    bar.style.width = data.percent + '%';
    percent.textContent = data.percent + '%';
    stepMessage.textContent = data.message;
    addLog(data.message);
  });

  es.addEventListener('completed', function(e){
    var data = JSON.parse(e.data);
    bar.style.width = '100%';
    percent.textContent = '100%';
    stepMessage.textContent = '✅ 完了 — リダイレクト中...';
    addLog('生成完了！ダッシュボードへ移動します', 'success');
    es.close();
    setTimeout(function(){
      window.location.href = '/dashboard/' + data.sessionId;
    }, 800);
  });

  es.addEventListener('failed', function(e){
    var data = JSON.parse(e.data);
    stepMessage.textContent = '❌ 失敗';
    addLog('エラー: ' + data.error, 'error');
    errorText.textContent = data.error;
    errorBox.style.display = 'block';
    actions.style.display = 'flex';
    es.close();
  });

  es.onerror = function(){
    addLog('接続エラー（再接続を試みます）', 'warning');
  };
})();
</script>
</body>
</html>`;
}
