/* 資格・検定トラッカー の Service Worker。
 *
 * 方針は stale-while-revalidate（SWR）。
 * キャッシュがあれば即座に返して表示を止めず、裏側で新しいものを取り直して
 * キャッシュを差し替える。差し替えた内容は次回の起動から反映される。
 * こうすると「オフラインでも開ける」と「更新が届かなくならない」を両立できる。
 *
 * 収録ファイルを増やしたときは PRECACHE に足し、VERSION を上げる。
 */

const VERSION = 'v4';
const CACHE = `cert-tracker-${VERSION}`;

/** 初回インストール時にまとめて取っておくファイル。これだけあれば完全オフラインで動く。 */
const PRECACHE = [
  './',
  'index.html',
  'css/style.css',
  'js/presets.js',
  'js/app.js',
  'manifest.webmanifest',
  'assets/icon.svg',
  'assets/favicon-32.png',
  'assets/apple-touch-icon.png',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 1件でも失敗するとインストール自体が転ぶので、個別に入れて失敗は握りつぶす。
    const results = await Promise.allSettled(
      PRECACHE.map((path) => cache.add(new Request(path, { cache: 'reload' })))
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed) console.warn(`[sw] ${failed}件のプリキャッシュに失敗しました`);

    // これを呼ばないと、新しい Service Worker はタブを全部閉じるまで待機したままになる。
    // リロードでは古いものが残り続け、更新が延々と届かない。
    // このアプリは起動時に全アセットを読み切る（遅延読み込みが無い）ので、
    // 表示中に差し替わっても実害がない。
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 古いバージョンのキャッシュを掃除する。
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((n) => n.startsWith('cert-tracker-') && n !== CACHE)
        .map((n) => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // 扱うのは自分のオリジンへの GET だけ。
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(respond(event));
});

async function respond(event) {
  const request = event.request;
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });

  const fromNetwork = fetch(request)
    .then((response) => {
      if (response && response.ok && response.type === 'basic') {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  // キャッシュがあれば即返し、取り直しは裏で最後まで走らせる。
  if (cached) {
    event.waitUntil(fromNetwork);
    return cached;
  }

  const fresh = await fromNetwork;
  if (fresh) return fresh;

  // オフラインかつ未キャッシュ。ページを開こうとしているならアプリ本体を返す。
  if (request.mode === 'navigate') {
    const shell = (await cache.match('index.html')) || (await cache.match('./'));
    if (shell) return shell;
  }
  return Response.error();
}
