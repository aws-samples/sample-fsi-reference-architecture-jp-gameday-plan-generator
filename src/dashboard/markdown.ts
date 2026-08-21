/**
 * 共通の簡易マークダウン → HTML 変換
 *
 * 対応する記法:
 *   - ATX 見出し (#, ##, ###) → h3 / h3 / h4
 *   - 段落 (連続する非空行は1つの <p> に結合)
 *   - 箇条書き (-, *) と番号付きリスト (1.)
 *   - GFM パイプ表
 *   - 強調 **bold** と インラインコード `code`
 *
 * セキュリティ: 入力は最初に HTML エスケープしてから処理するので、
 * 任意の生 HTML が出力される心配はない。
 */

export function mdToHtml(md: string): string {
  // ── HTML エスケープ ──
  const escaped = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const lines = escaped.split('\n');
  const out: string[] = [];
  let i = 0;
  let inUl = false;
  let inOl = false;

  const closeLists = (): void => {
    if (inUl) { out.push('</ul>'); inUl = false; }
    if (inOl) { out.push('</ol>'); inOl = false; }
  };

  // インライン: **bold** と `code`
  const inline = (s: string): string =>
    s
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');

  const splitPipeRow = (row: string): string[] | null => {
    const t = row.trim();
    if (!t.startsWith('|')) return null;
    return t
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map(c => c.trim());
  };

  const isSeparatorRow = (row: string): boolean => {
    const cells = splitPipeRow(row);
    if (!cells) return false;
    return cells.every(c => /^:?-+:?$/.test(c));
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') { closeLists(); i++; continue; }

    const h3 = /^### (.+)$/.exec(line);
    if (h3) { closeLists(); out.push(`<h4>${inline(h3[1])}</h4>`); i++; continue; }
    const h2 = /^## (.+)$/.exec(line);
    if (h2) { closeLists(); out.push(`<h3>${inline(h2[1])}</h3>`); i++; continue; }
    const h1 = /^# (.+)$/.exec(line);
    if (h1) { closeLists(); out.push(`<h3>${inline(h1[1])}</h3>`); i++; continue; }

    // GFM 表
    if (line.trim().startsWith('|') && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      closeLists();
      const headerCells = splitPipeRow(line) ?? [];
      i += 2;
      const bodyRows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = splitPipeRow(lines[i]);
        if (cells) bodyRows.push(cells);
        i++;
      }
      const thead =
        '<thead><tr>' + headerCells.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead>';
      const tbody =
        '<tbody>' +
        bodyRows
          .map(row => '<tr>' + row.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>')
          .join('') +
        '</tbody>';
      out.push(`<div class="md-table-wrap"><table class="md-table">${thead}${tbody}</table></div>`);
      continue;
    }

    const ol = /^(\d+)\. (.+)$/.exec(line);
    if (ol) {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (!inOl) { out.push('<ol>'); inOl = true; }
      out.push(`<li>${inline(ol[2])}</li>`);
      i++;
      continue;
    }

    const ul = /^[-*] (.+)$/.exec(line);
    if (ul) {
      if (inOl) { out.push('</ol>'); inOl = false; }
      if (!inUl) { out.push('<ul>'); inUl = true; }
      out.push(`<li>${inline(ul[1])}</li>`);
      i++;
      continue;
    }

    closeLists();
    const paraLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^#{1,3} /.test(lines[i]) &&
      !/^[-*] /.test(lines[i]) &&
      !/^\d+\. /.test(lines[i]) &&
      !lines[i].trim().startsWith('|')
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    out.push(`<p>${inline(paraLines.join(' '))}</p>`);
  }

  closeLists();
  return out.join('');
}
