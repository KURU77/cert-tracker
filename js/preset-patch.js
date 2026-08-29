/* js/presets.js のソースそのものを書き換えるための処理。
 *
 * ブラウザ（開発者ツールから GitHub へコミットするとき）と
 * Node（tools/apply-overrides.mjs）の両方から使うので、
 * DOM にもファイルシステムにも触らない純粋な関数だけを置く。
 *
 * 配列を作り直して丸ごと吐き出すのではなく、該当する行だけを差し替える。
 * 手で書いたコメントや分野ごとの並びを保つため。
 */
(() => {
  'use strict';

  const FIELDS = ['name', 'short', 'alias', 'category', 'scoreType',
                  'targetScore', 'maxScore', 'scoreUnit', 'fee', 'url', 'memo'];

  const ADDED_HEADER = '  /* ---------- 開発者ツールから追加 ---------- */';

  const quote = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

  /** プリセット1件を presets.js の1行に組み立てる。 */
  function toLine(p, indent = '  ') {
    const parts = [];
    for (const k of FIELDS) {
      const v = p[k];
      if (v === undefined || v === null || v === '') continue;
      parts.push(`${k}: ${typeof v === 'number' ? v : quote(v)}`);
    }
    return `${indent}{ ${parts.join(', ')} },`;
  }

  /**
   * name が一致するエントリの範囲を返す。エントリは複数行にまたがることがあるので、
   * 波かっこの対応を数えて終端を探す。見つからなければ null。
   */
  function findEntry(text, name) {
    const needle = `{ name: ${quote(name)},`;
    const start = text.indexOf(needle);
    if (start < 0) return null;
    const lineStart = text.lastIndexOf('\n', start) + 1;

    let depth = 0;
    let i = start;
    for (; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) { i++; break; }
      }
    }
    while (i < text.length && text[i] === ',') i++;
    return { start: lineStart, end: i };
  }

  /**
   * presets.js のソースに overrides を適用する。
   *
   * @param {string} src           現在の js/presets.js の中身
   * @param {object} overrides     { edits, added, removed }
   * @param {Array<object>} current 現在のプリセット配列（パッチの土台に使う）
   * @returns {{source: string, report: object}}
   */
  function applyOverrides(src, overrides, current) {
    const edits = overrides?.edits ?? {};
    const added = overrides?.added ?? [];
    const removed = new Set(overrides?.removed ?? []);
    const byName = new Map(current.map((p) => [p.name, p]));

    const report = { edited: [], added: [], removed: [], skipped: [] };
    let out = src;

    // --- 既存エントリの書き換え ---
    for (const [name, patch] of Object.entries(edits)) {
      const base = byName.get(name);
      const span = findEntry(out, name);
      if (!base || !span) { report.skipped.push(`${name}（見つからず）`); continue; }

      const next = { ...base };
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === '') delete next[k];
        else next[k] = v;
      }
      out = out.slice(0, span.start) + toLine(next) + out.slice(span.end);
      report.edited.push(name);
    }

    // --- 削除 ---
    for (const name of removed) {
      const span = findEntry(out, name);
      if (!span) { report.skipped.push(`${name}（見つからず）`); continue; }
      let end = span.end;
      if (out[end] === '\n') end++;   // 行ごと消す
      out = out.slice(0, span.start) + out.slice(end);
      report.removed.push(name);
    }

    // --- 追加 ---
    const fresh = added.filter((p) => {
      if (byName.has(p.name) && !removed.has(p.name)) {
        report.skipped.push(`${p.name}（同名が既にある）`);
        return false;
      }
      return true;
    });

    if (fresh.length) {
      const lines = fresh.map((p) => toLine(p)).join('\n');
      if (out.includes(ADDED_HEADER)) {
        out = out.replace(ADDED_HEADER, `${ADDED_HEADER}\n${lines}`);
      } else {
        const close = out.lastIndexOf('];');
        out = `${out.slice(0, close)}\n${ADDED_HEADER}\n${lines}\n${out.slice(close)}`;
      }
      report.added.push(...fresh.map((p) => p.name));
    }

    return { source: out, report };
  }

  globalThis.PRESET_PATCH = { FIELDS, ADDED_HEADER, quote, toLine, findEntry, applyOverrides };
})();
