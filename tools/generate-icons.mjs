/**
 * assets/*.svg から各サイズの PNG アイコンを書き出す。
 *
 *   npm install sharp
 *   node tools/generate-icons.mjs
 *
 * アイコンの原本は assets/icon.svg と assets/icon-maskable.svg。
 * 図柄を変えたらこのスクリプトを流し直して PNG を更新する。
 */
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(root, 'assets');

const jobs = [
  // [原本, 出力, 一辺のピクセル数]
  ['icon.svg',          'apple-touch-icon.png',  180], // iOS ホーム画面
  ['icon.svg',          'icon-192.png',          192], // PWA
  ['icon.svg',          'icon-512.png',          512], // PWA
  ['icon-maskable.svg', 'icon-maskable-512.png', 512], // Android のマスク対応
  ['icon.svg',          'favicon-32.png',         32], // タブアイコン
];

for (const [src, out, size] of jobs) {
  const svg = readFileSync(join(assets, src));
  // density を上げてからリサイズすると、斜めの辺のジャギーが出にくい。
  const info = await sharp(svg, { density: 600 })
    .resize(size, size, { fit: 'fill' })
    .png({ compressionLevel: 9 })
    .toFile(join(assets, out));
  console.log(`${out.padEnd(24)} ${info.width}x${info.height}  ${(info.size / 1024).toFixed(1)}KB`);
}
