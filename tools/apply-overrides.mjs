/**
 * 開発者向けツールが書き出した preset-overrides-*.json を js/presets.js に反映する。
 *
 *   node tools/apply-overrides.mjs preset-overrides-2026-08-29.json
 *   node tools/apply-overrides.mjs overrides.json --dry-run
 *
 * ふだんはアプリ内の「GitHub に反映」で直接コミットできるので、
 * これはトークンを使わずに手元で当てたいときの経路。
 * 書き換えの中身は js/preset-patch.js をブラウザと共用している。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

const overrides = JSON.parse(readFileSync(jsonPath, 'utf8'));
if (overrides.format && overrides.format !== 'cert-tracker-preset-overrides') {
  console.error(`形式が違います: ${overrides.format}`);
  process.exit(1);
}

// ブラウザ向けのスクリプトをそのまま読み込んで共用する
await import(pathToFileURL(join(root, 'js', 'preset-patch.js')).href);
const { applyOverrides } = globalThis.PRESET_PATCH;

// 現在のプリセット配列（パッチの土台）
globalThis.window = {};
await import(`${pathToFileURL(presetsPath).href}?t=${Date.now()}`);
const current = globalThis.window.CERT_PRESETS;

const src = readFileSync(presetsPath, 'utf8');
const { source, report } = applyOverrides(src, overrides, current);

if (!dryRun) writeFileSync(presetsPath, source);

const show = (label, list, mark) => {
  console.log(`${label}: ${list.length}件`);
  list.forEach((n) => console.log(`  ${mark} ${n}`));
};
show('編集', report.edited, '~');
show('追加', report.added, '+');
show('削除', report.removed, '-');
if (report.skipped.length) show('スキップ', report.skipped, '?');

console.log(dryRun
  ? '\n--dry-run のため書き込みませんでした。'
  : `\n${presetsPath} を更新しました。`);
