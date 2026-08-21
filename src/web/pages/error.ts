/**
 * エラーページ HTML - Cloudscape Design風
 */

function escapeHtml(str: string): string {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

export function renderErrorPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>エラー - GameDay Plan Generator</title>
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{background:#f2f3f3;color:#000716;font-family:'Amazon Ember','Helvetica Neue','Segoe UI','Hiragino Sans',sans-serif;font-size:14px;line-height:1.5}
  .awsui-top-nav{background:#232f3e;color:#fff;height:48px;display:flex;align-items:center;padding:0 20px}
  .awsui-top-nav-inner{display:flex;align-items:center;gap:10px}
  .awsui-top-nav-home{display:flex;align-items:center;gap:10px;text-decoration:none;color:#fff;border-radius:4px;padding:2px 4px}
  .awsui-top-nav-home:hover{background:#37475a}
  .awsui-service-icon{font-size:20px}
  .awsui-service-name{font-size:16px;font-weight:700}
  .wrap{max-width:600px;margin:60px auto;padding:0 24px}
  .awsui-flashbar{display:flex;align-items:flex-start;gap:12px;padding:16px 20px;border-radius:8px;margin-bottom:20px}
  .awsui-flashbar-error{background:#fff7f7;border:1px solid #d9151533}
  .awsui-flashbar-icon{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;flex-shrink:0;background:#d91515;color:#fff}
  .awsui-flashbar-title{font-size:14px;font-weight:700;color:#000716}
  .awsui-flashbar-message{font-size:13px;color:#5f6b7a;margin-top:4px;white-space:pre-wrap}
  .awsui-btn{display:inline-block;padding:8px 20px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;border:2px solid #0972d3;background:#fff;color:#0972d3;text-decoration:none;transition:all .15s}
  .awsui-btn:hover{background:#f2f8fd}
</style>
</head>
<body>
<div class="awsui-top-nav">
  <div class="awsui-top-nav-inner">
    <a href="/" class="awsui-top-nav-home" aria-label="トップへ戻る">
      <span class="awsui-service-icon">🎮</span>
      <span class="awsui-service-name">GameDay Plan Generator</span>
    </a>
  </div>
</div>
<div class="wrap">
  <div class="awsui-flashbar awsui-flashbar-error">
    <div class="awsui-flashbar-icon">!</div>
    <div>
      <div class="awsui-flashbar-title">エラーが発生しました</div>
      <div class="awsui-flashbar-message">${escapeHtml(message)}</div>
    </div>
  </div>
  <a href="/" class="awsui-btn">トップに戻る</a>
</div>
</body>
</html>`;
}
