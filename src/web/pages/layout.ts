/**
 * 共通レイアウト部品（トップナビ / サイドナビ / 共通CSS）
 *
 * 全ページでヘッダ・サイドメニューの見た目を揃えるために使う。
 * 各ページは自前の <style> 内に navChromeCss() を含め、
 * トップナビ / サイドナビの HTML は renderTopNav() / renderSideNav() を使う。
 */

export type NavKey = 'generate' | 'history' | 'dashboard';

/** トップナビ（ロゴはトップへのリンク、右側メニューは全ページ共通） */
export function renderTopNav(): string {
  return `<div class="awsui-top-nav">
  <div class="awsui-top-nav-inner">
    <a href="/" class="awsui-top-nav-left awsui-top-nav-home" aria-label="トップへ戻る">
      <span class="awsui-service-icon">🎮</span>
      <span class="awsui-service-name">GameDay Plan Generator</span>
    </a>
    <div class="awsui-top-nav-right">
      <a href="/" class="awsui-nav-item">計画生成</a>
      <span class="awsui-nav-divider"></span>
      <a href="/history" class="awsui-nav-item">過去の計画</a>
    </div>
  </div>
</div>`;
}

/**
 * サイドナビ（計画生成 / 過去の計画）。
 * extraItems で各ページ固有の項目（ダッシュボードのセクション等）を末尾に追加できる。
 */
export function renderSideNav(active: NavKey, extraItems = ''): string {
  const cls = (k: NavKey): string => 'awsui-side-nav-item' + (active === k ? ' active' : '');
  return `<nav class="awsui-side-nav">
    <div class="awsui-side-nav-header">GameDay Planner</div>
    <a href="/" class="${cls('generate')}"><span class="awsui-side-nav-icon">📋</span>計画生成</a>
    <a href="/history" class="${cls('history')}"><span class="awsui-side-nav-icon">📚</span>過去の計画</a>
    ${extraItems}
  </nav>`;
}

/**
 * トップナビ / サイドナビ / app-layout 共通の CSS。
 * 各ページの <style> 末尾に差し込む（既存定義があっても同内容なので後勝ちで整合）。
 */
export function navChromeCss(): string {
  return `
  /* ── 共通ナビ chrome ── */
  .awsui-top-nav{background:#232f3e;color:#fff;height:48px;display:flex;align-items:center;padding:0 20px;position:sticky;top:0;z-index:100}
  .awsui-top-nav-inner{display:flex;align-items:center;justify-content:space-between;width:100%}
  .awsui-top-nav-left{display:flex;align-items:center;gap:10px}
  .awsui-top-nav-home{text-decoration:none;color:#fff;cursor:pointer;border-radius:4px;padding:2px 4px}
  .awsui-top-nav-home:hover{background:#37475a}
  .awsui-service-icon{font-size:20px}
  .awsui-service-name{font-size:16px;font-weight:700;letter-spacing:.3px}
  .awsui-top-nav-right{display:flex;align-items:center;gap:16px;font-size:13px;color:#d5dbdb}
  .awsui-nav-item{cursor:pointer;padding:4px 8px;border-radius:4px;color:#d5dbdb;text-decoration:none}
  a.awsui-nav-item:hover{background:#37475a}
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

  @media(max-width:768px){.awsui-side-nav{display:none}}
  `;
}
