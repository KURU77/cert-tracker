/**
 * 開発者向けツールが書き出した preset-overrides-*.json を js/presets.js に反映する。
 *
 *   node tools/apply-overrides.mjs preset-overrides-2026-08-16.json
 *   node tools/apply-overrides.mjs overrides.json --dry-run
 *
 * 既存プリセットの行だけを差し替え、追加分は末尾の専用セクションに足す。
 * 手で書いたコメントや分野ごとの並びを崩さないための作りにしている。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const presetsPath = join(root, 'js', 'presets.js');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const jsonPath = args.find((a) => !a.startsWith('--'));

if (!jsonPath) {
  console.error('使い方: node tools/apply-overrides.mjs <preset-overrides.json> [--dry-run]');
  process.exit(1);
}

const FIELDS = ['name', 'short', 'alias', 'category', 'scoreType',
                'targetScore', 'maxScore', 'scoreUnit', 'fee', 'url', 'memo'];

const ADDED_HEADER = '  /* ---------- 開発者ツールから追加 ---------- */';

const ov = JSON.parse(readFileSync(jsonPath, 'utf8'));
if (ov.format && ov.format !== 'cert-tracker-preset-overrides') {
  console.error(`形式が違います: ${ov.format}`);
  process.exit(1);
}
const edits = ov.edits ?? {};
const added = ov.added ?? [];
const removed = new Set(ov.removed ?? []);

let src = readFileSync(presetsPath, 'utf8');

/** 現在の presets.js を読み込んで、名前 -> オブジェクト を作る。 */
async function loadCurrent() {
  global.window = {};
  await import(`file:///${presetsPath.replace(/\\/g, '/')}?t=${Date.now()}`);
  return global.window.CERT_PRESETS;
}
const current = await loadCurrent();
const byName = new Map(current.map((p) => [p.name, p]));

const quote = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function toLine(p, indent = '  ') {
  const parts = [];
  for (const k of FIELDS) {
    const v = p[k];
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${k}: ${typeof v === 'number' ? v : quote(v)}`);
  }
  return `${indent}{ ${parts.join(', ')} },`;
}

/** name: '…' で始まるエントリ全体（複数行にまたがることがある）を切り出す。 */
function findEntry(text, name) {
  const needle = `{ name: ${quote(name)},`;
  const start = text.indexOf(needle);
  if (start < 0) return null;
  const lineStart = text.lastIndexOf('\n', start) + 1;

  // 波かっこの対応を数えて終端を探す
  let depth = 0;
  let i = start;
  for (; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  while (i < text.length && text[i] === ',') i++;
  return { start: lineStart, end: i };
}

const report = { edited: [], added: [], removed: [], missing: [] };

// --- 既存プリセットの書き換え ---
for (const [name, patch] of Object.entries(edits)) {
  const base = byName.get(name);
  if (!base) { report.missing.push(name); continue; }
  const next = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === '') delete next[k];
    else next[k] = v;
  }
  const span = findEntry(src, name);
  if (!span) { report.missing.push(name); continue; }
  src = src.slice(0, span.start) + toLine(next) + src.slice(span.end);
  report.edited.push(name);
}

// --- 削除 ---
for (const name of removed) {
  const span = findEntry(src, name);
  if (!span) { report.missing.push(name); continue; }
  let end = span.end;
  if (src[end] === '\n') end++;   // 行ごと消す
  src = src.slice(0, span.start) + src.slice(end);
  report.removed.push(name);
}

// --- 追加 ---
if (added.length) {
  const fresh = added.filter((p) => {
    if (byName.has(p.name) && !removed.has(p.name)) {
      report.missing.push(`${p.name}（既にあるので追加せず）`);
      return false;
    }
    return true;
  });

  if (fresh.length) {
    const lines = fresh.map((p) => toLine(p)).join('\n');
    if (src.includes(ADDED_HEADER)) {
      src = src.replace(ADDED_HEADER, `${ADDED_HEADER}\n${lines}`);
    } else {
      const close = src.lastIndexOf('];');
      src = `${src.slice(0, close)}\n${ADDED_HEADER}\n${lines}\n${src.slice(close)}`;
    }
    report.added.push(...fresh.map((p) => p.name));
  }
}

if (!dryRun) writeFileSync(presetsPath, src);

console.log(`編集: ${report.edited.length}件`);
report.edited.forEach((n) => console.log(`  ~ ${n}`));
console.log(`追加: ${report.added.length}件`);
report.added.forEach((n) => console.log(`  + ${n}`));
console.log(`削除: ${report.removed.length}件`);
report.removed.forEach((n) => console.log(`  - ${n}`));
if (report.missing.length) {
  console.log(`見つからず／スキップ: ${report.missing.length}件`);
  report.missing.forEach((n) => console.log(`  ? ${n}`));
}
console.log(dryRun ? '\n--dry-run のため書き込みませんでした。' : `\n${presetsPath} を更新しました。`);
