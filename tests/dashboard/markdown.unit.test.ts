import { describe, it, expect } from 'vitest';
import { mdToHtml } from '../../src/dashboard/markdown.js';

describe('mdToHtml: 見出しと段落', () => {
  it('# / ## / ### が h3/h3/h4 に変換される', () => {
    const html = mdToHtml('# ヘッダ1\n## ヘッダ2\n### ヘッダ3\n');
    expect(html).toContain('<h3>ヘッダ1</h3>');
    expect(html).toContain('<h3>ヘッダ2</h3>');
    expect(html).toContain('<h4>ヘッダ3</h4>');
  });

  it('連続した非空行は1つの <p> に結合される', () => {
    const html = mdToHtml('行1\n行2\n行3');
    expect(html).toMatch(/<p>行1 行2 行3<\/p>/);
  });

  it('段落間の空行は <br><br> に置換されない（marginで間隔をとる）', () => {
    const html = mdToHtml('段落A\n\n段落B');
    expect(html).not.toContain('<br><br>');
    expect(html).toContain('<p>段落A</p>');
    expect(html).toContain('<p>段落B</p>');
  });
});

describe('mdToHtml: リスト', () => {
  it('- 始まりは <ul><li> になる', () => {
    const html = mdToHtml('- アイテム1\n- アイテム2');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>アイテム1</li>');
    expect(html).toContain('<li>アイテム2</li>');
    expect(html).toContain('</ul>');
  });

  it('1. 始まりは <ol><li> になる', () => {
    const html = mdToHtml('1. ステップ1\n2. ステップ2');
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>ステップ1</li>');
    expect(html).toContain('<li>ステップ2</li>');
    expect(html).toContain('</ol>');
  });
});

describe('mdToHtml: GFM 表', () => {
  it('ヘッダ + セパレータ + 本文 → <table> に変換', () => {
    const md = `| # | 焦点 | 目標 |\n|---|------|------|\n| 1 | A    | B    |\n| 2 | C    | D    |`;
    const html = mdToHtml(md);
    expect(html).toContain('<table class="md-table">');
    expect(html).toContain('<th>#</th>');
    expect(html).toContain('<th>焦点</th>');
    expect(html).toContain('<td>A</td>');
    expect(html).toContain('<td>D</td>');
  });

  it('セルに **bold** や `code` を含められる', () => {
    const md = `| K | V |\n|---|---|\n| **太字** | \`code\` |`;
    const html = mdToHtml(md);
    expect(html).toContain('<strong>太字</strong>');
    expect(html).toContain('<code>code</code>');
  });
});

describe('mdToHtml: インライン記法', () => {
  it('**bold** が <strong> になる', () => {
    expect(mdToHtml('これは**重要**です')).toContain('<strong>重要</strong>');
  });

  it('`code` が <code> になる', () => {
    expect(mdToHtml('値は `42` です')).toContain('<code>42</code>');
  });
});

describe('mdToHtml: セキュリティ', () => {
  it('<script> はエスケープされる', () => {
    const html = mdToHtml('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('& はエスケープされる', () => {
    expect(mdToHtml('A & B')).toContain('A &amp; B');
  });
});
