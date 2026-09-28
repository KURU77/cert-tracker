/* Google ドライブを使った端末間の同期（iPhone・iPad・パソコン）。
 *
 * しくみ
 * - Google アカウントでログインし、そのユーザー自身のドライブにある
 *   「アプリ専用の非表示フォルダ（appDataFolder）」に JSON を1つ置く。
 *   ドライブの一覧には出ず、このアプリ以外からは読めない。開発者のサーバーも経由しない。
 * - 権限は drive.appdata だけ。ドライブのほかのファイルは読めない。
 * - サーバーが無い静的サイトなので、Google の「トークンをリダイレクトで受け取る」方式を使う。
 *   ポップアップ方式はホーム画面に追加した iPhone のアプリで戻ってこられないことがあるため。
 *   受け取れるトークンは1時間で切れるので、起動時に一瞬 Google を経由して取り直す。
 *
 * 同期のルール
 * - 資格ごとに updatedAt が新しいほうを採用する（受験記録は資格の一部として一緒に動く）。
 * - 削除は「いつ消したか」を墓標（deleted）として残し、それより古い版は復活させない。
 * - どちらの端末の変更も手元に残るので、同時に書き込んで片方が負けても次の同期で追いつく。
 */
(() => {
  'use strict';

  /* Google Cloud で発行する OAuth クライアント ID。公開されて困る値ではない（秘密鍵ではない）。
     空のあいだは同期機能を表示しない。設定手順は README の「端末間の同期」を参照。 */
  const GOOGLE_CLIENT_ID = '';

  const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  const FILE_NAME = 'cert-tracker-sync.json';
  const DRIVE = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

  const ITEMS_KEY = 'cert-tracker.items.v1';
  const DELETED_KEY = 'cert-tracker.deleted.v1';
  const STATE_KEY = 'cert-tracker.sync.v1';
  const TOKEN_KEY = 'cert-tracker.sync.token';
  const PENDING_KEY = 'cert-tracker.sync.pending';
  /** 開発用。localhost でだけ、クライアント ID をコードを変えずに差し込める。 */
  const CLIENT_ID_OVERRIDE_KEY = 'cert-tracker.sync.clientId';
  /** この起動ですでに Google を経由したか（sessionStorage）。無限に往復しないための目印。 */
  const BOUNCED_KEY = 'cert-tracker.sync.bounced';

  /** 削除の墓標をいつまで覚えておくか。これより長く同期していない端末の削除済みデータは復活しうる。 */
  const TOMBSTONE_TTL = 400 * 86400000;

  // ---------- 突き合わせ（DOM に触らない純粋な処理。Node でも動く） ----------

  function stamp(item) {
    const n = Number(item?.updatedAt);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * 2つのデータを1つにまとめる。どちらを先に渡しても中身は同じになる
   * （同じ updatedAt のときだけ a 側を優先する）。
   * @param {{items: object[], deleted: Record<string, number>}} a
   * @param {{items: object[], deleted: Record<string, number>}} b
   */
  function merge(a, b, now = Date.now()) {
    const deleted = {};
    for (const src of [a?.deleted, b?.deleted]) {
      for (const [id, t] of Object.entries(src ?? {})) {
        const n = Number(t) || 0;
        if (n > (deleted[id] ?? -1)) deleted[id] = n;
      }
    }
    for (const [id, t] of Object.entries(deleted)) {
      if (t < now - TOMBSTONE_TTL) delete deleted[id];
    }

    const byId = new Map();
    const order = [];
    for (const src of [a?.items, b?.items]) {
      for (const it of Array.isArray(src) ? src : []) {
        if (!it || typeof it.id !== 'string' || !it.id) continue;
        const mine = byId.get(it.id);
        if (!mine) {
          byId.set(it.id, it);
          order.push(it.id);
        } else if (stamp(it) > stamp(mine)) {
          byId.set(it.id, it);
        }
      }
    }

    const items = [];
    for (const id of order) {
      const it = byId.get(id);
      if (deleted[id] !== undefined && deleted[id] >= stamp(it)) continue;
      items.push(it);
    }
    return { items, deleted };
  }

  /** キーの並びに左右されない JSON。端末ごとにキーの順番が違っても同じ文字列になる。 */
  function canonical(v) {
    if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
    if (v && typeof v === 'object') {
      return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort()
        .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
    }
    return JSON.stringify(v) ?? 'null';
  }

  /** 中身が同じかどうかを比べるための指紋。資格の並び順とキーの順番の違いは無視する。 */
  function fingerprint(data) {
    const items = [...(Array.isArray(data?.items) ? data.items : [])]
      .filter((it) => it && typeof it.id === 'string')
      .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    return canonical({ items, deleted: data?.deleted ?? {} });
  }

  globalThis.CERT_SYNC_CORE = { merge, fingerprint, TOMBSTONE_TTL };
  if (typeof document === 'undefined') return;

  // ---------- 保存まわり ----------

  function readJSON(storage, key, fallback) {
    try {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJSON(storage, key, value) {
    try {
      storage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.warn(`${key} を保存できませんでした`, err);
    }
  }

  const clientId = GOOGLE_CLIENT_ID
    || (location.hostname === 'localhost' ? (localStorage.getItem(CLIENT_ID_OVERRIDE_KEY) ?? '') : '');
  const configured = Boolean(clientId);

  /** 接続中のアカウント情報。null なら未接続。 */
  let state = readJSON(localStorage, STATE_KEY, null);
  function saveState() {
    if (state) writeJSON(localStorage, STATE_KEY, state);
    else localStorage.removeItem(STATE_KEY);
  }

  function accessToken() {
    const t = readJSON(localStorage, TOKEN_KEY, null);
    return t && t.expiresAt > Date.now() ? t.accessToken : null;
  }

  function localData() {
    const items = readJSON(localStorage, ITEMS_KEY, []);
    const deleted = readJSON(localStorage, DELETED_KEY, {});
    return {
      items: Array.isArray(items) ? items : [],
      deleted: deleted && typeof deleted === 'object' ? deleted : {},
    };
  }

  // ---------- 状態の通知 ----------

  /** 'off' | 'syncing' | 'ok' | 'offline' | 'needs-auth' | 'error' */
  let status = { phase: 'off', message: '' };
  const statusListeners = new Set();
  const remoteListeners = new Set();

  function setStatus(phase, message = '') {
    status = { phase, message };
    for (const fn of statusListeners) fn(status, state);
  }

  // ---------- Google ログイン（リダイレクト方式） ----------

  function randomHex(bytes) {
    const a = new Uint8Array(bytes);
    crypto.getRandomValues(a);
    return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /** 戻り先。Google Cloud の「承認済みのリダイレクト URI」に同じものを登録しておく。 */
  function redirectUri() {
    return new URL('./', location.href).href;
  }

  function showOverlay(text) {
    const o = document.createElement('div');
    o.className = 'sync-overlay';
    o.setAttribute('role', 'status');
    o.textContent = text;
    document.body.append(o);
  }

  /** @param {{silent: boolean}} opts silent なら画面を出さずにトークンだけ取り直す */
  function startAuth({ silent }) {
    const nonce = randomHex(16);
    writeJSON(localStorage, PENDING_KEY, {
      nonce,
      silent,
      returnTo: location.pathname + location.search,
    });

    const p = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri(),
      response_type: 'token',
      scope: SCOPE,
      include_granted_scopes: 'true',
      state: nonce,
      prompt: silent ? 'none' : 'select_account',
    });
    if (state?.email) p.set('login_hint', state.email);

    showOverlay(silent ? 'Google と同期しています…' : 'Google のログイン画面を開いています…');
    location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${p}`);
  }

  /**
   * Google から戻ってきたときの URL（#access_token=… / #error=…）を読み取る。
   * app.js が動く前に済ませ、URL からはすぐ消す。
   */
  function consumeAuthResponse() {
    const hash = location.hash.slice(1);
    if (!/(^|&)(access_token|error)=/.test(hash)) return null;

    const p = new URLSearchParams(hash);
    const pending = readJSON(localStorage, PENDING_KEY, null);
    localStorage.removeItem(PENDING_KEY);
    history.replaceState(null, '', location.pathname + location.search);

    // 自分が送り出したログインへの返事かを確かめる。よそから差し込まれたトークンは使わない。
    if (!pending || p.get('state') !== pending.nonce) return { ok: false, reason: 'state' };

    const base = { silent: Boolean(pending.silent), returnTo: pending.returnTo };
    if (p.get('error')) return { ...base, ok: false, reason: p.get('error') };

    // 同意画面でドライブのチェックを外されると、トークンはあっても権限が無い。
    const granted = String(p.get('scope') ?? '').split(' ');
    if (!granted.includes(SCOPE)) return { ...base, ok: false, reason: 'scope' };

    const expiresIn = Number(p.get('expires_in')) || 3600;
    writeJSON(localStorage, TOKEN_KEY, {
      accessToken: p.get('access_token'),
      // 期限ぎりぎりで使って失敗しないよう、1分早めに切れた扱いにする。
      expiresAt: Date.now() + expiresIn * 1000 - 60000,
    });
    return { ...base, ok: true };
  }

  // ---------- Google ドライブ ----------

  class AuthError extends Error {}

  async function api(url, opts = {}) {
    const token = accessToken();
    if (!token) throw new AuthError('トークンがありません');
    const res = await fetch(url, {
      ...opts,
      headers: { ...(opts.headers ?? {}), Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      throw new AuthError('トークンの期限が切れました');
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Google ドライブ ${res.status} ${detail.slice(0, 200)}`);
    }
    return res;
  }

  async function listFiles() {
    const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
    const res = await api(`${DRIVE}/files?spaces=appDataFolder&q=${q}&orderBy=createdTime&fields=files(id)&pageSize=10`);
    const { files } = await res.json();
    return Array.isArray(files) ? files : [];
  }

  async function readFile(id) {
    const res = await api(`${DRIVE}/files/${encodeURIComponent(id)}?alt=media`);
    const data = await res.json().catch(() => null);
    // 形式が違うものは読み飛ばす（壊れたファイルで手元を消さないため）。
    if (!data || data.format !== 'cert-tracker-sync' || !Array.isArray(data.items)) return null;
    return { items: data.items, deleted: data.deleted ?? {} };
  }

  function payload(data) {
    return JSON.stringify({
      format: 'cert-tracker-sync',
      version: 1,
      savedAt: new Date().toISOString(),
      items: data.items,
      deleted: data.deleted,
    });
  }

  async function createFile(data) {
    const boundary = `cert-tracker-${randomHex(8)}`;
    const meta = { name: FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' };
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(meta),
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      payload(data),
      `--${boundary}--`,
      '',
    ].join('\r\n');
    await api(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
  }

  async function updateFile(id, data) {
    await api(`${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: payload(data),
    });
  }

  async function fetchAccount() {
    const res = await api(`${DRIVE}/about?fields=user(displayName,emailAddress)`);
    const { user } = await res.json();
    return user ?? {};
  }

  // ---------- 同期本体 ----------

  let running = null;
  let again = false;

  /** 同期を1回走らせる。走っている最中に呼ばれたら、終わったあとにもう1回走らせる。 */
  function syncNow() {
    if (!configured || !state) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await syncOnce();
        } while (again);
      } finally {
        running = null;
      }
    })();
    return running;
  }

  async function syncOnce() {
    if (!navigator.onLine) { setStatus('offline'); return; }
    if (!accessToken()) { setStatus('needs-auth'); return; }

    setStatus('syncing');
    try {
      if (!state.email) {
        const user = await fetchAccount();
        state = { ...state, email: user.emailAddress ?? '', name: user.displayName ?? '' };
        saveState();
      }

      // 2台が同時に初回同期するとファイルが2つできることがあるので、あれば全部まとめる。
      const files = await listFiles();
      let remote = { items: [], deleted: {} };
      /** 1つ目のファイルに実際に書かれている中身。書き直しが要るかの判定に使う。 */
      let firstRaw = null;
      for (const [i, f] of files.entries()) {
        const data = await readFile(f.id);
        if (i === 0) firstRaw = data;
        if (data) remote = merge(remote, data);
      }

      // 手元の読み取りから書き込みまでの間に await を挟まない。
      // 挟むと、その隙に保存された手元の変更を上書きしてしまう。
      const local = localData();
      const merged = merge(local, remote);
      if (fingerprint(merged) !== fingerprint(local)) {
        writeJSON(localStorage, ITEMS_KEY, merged.items);
        writeJSON(localStorage, DELETED_KEY, merged.deleted);
        for (const fn of remoteListeners) fn();
      }

      if (!files.length) {
        await createFile(merged);
      } else {
        // 削除済みの古い版が残っているだけ、のような「読めば同じ」ファイルも書き直して掃除する。
        if (files.length > 1 || !firstRaw || fingerprint(merged) !== fingerprint(firstRaw)) {
          await updateFile(files[0].id, merged);
        }
        for (const extra of files.slice(1)) {
          await api(`${DRIVE}/files/${encodeURIComponent(extra.id)}`, { method: 'DELETE' });
        }
      }

      state = { ...state, lastSyncAt: Date.now(), silentFailed: false };
      saveState();
      setStatus('ok');
    } catch (err) {
      if (err instanceof AuthError) {
        setStatus('needs-auth');
      } else {
        console.error('同期に失敗しました', err);
        setStatus(navigator.onLine ? 'error' : 'offline', err.message);
      }
    }
  }

  let pushTimer = null;

  /** 手元のデータが変わったら呼ぶ。少し待ってからまとめて送る。 */
  function notifyChange() {
    if (!configured || !state) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      if (accessToken()) syncNow();
      else setStatus('needs-auth');
    }, 1500);
  }

  /** 削除した資格を墓標に記録する。同期していなくても記録しておく（あとで接続したときのため）。 */
  function recordDeletion(ids) {
    const deleted = readJSON(localStorage, DELETED_KEY, {});
    const now = Date.now();
    for (const id of ids) if (id) deleted[id] = now;
    writeJSON(localStorage, DELETED_KEY, deleted);
  }

  /** 画面から「同期する」を押したとき。トークンが切れていれば Google を経由する。 */
  function requestSync() {
    if (!configured || !state) return;
    if (accessToken()) { syncNow(); return; }
    if (!navigator.onLine) { setStatus('offline'); return; }
    // 黙って取り直せなかったことがある端末では、最初からログイン画面を出す。
    startAuth({ silent: !state.silentFailed });
  }

  function connect() {
    if (!configured) return;
    state = { auto: true, lastSyncAt: 0 };
    saveState();
    startAuth({ silent: false });
  }

  /** この端末でだけログアウトする。ほかの端末の接続はそのまま。 */
  function disconnect() {
    localStorage.removeItem(TOKEN_KEY);
    state = null;
    saveState();
    setStatus('off');
  }

  function setAuto(on) {
    if (!state) return;
    state = { ...state, auto: Boolean(on) };
    saveState();
  }

  // ---------- 起動時 ----------

  function start() {
    if (!configured) return;

    const result = consumeAuthResponse();

    // ずかんのページから出発したなら、そこへ戻す（トークンは保存済み）。
    if (result?.ok && result.returnTo && result.returnTo !== location.pathname + location.search) {
      location.replace(result.returnTo);
      return;
    }

    if (!state) { setStatus('off'); return; }

    if (result && !result.ok) {
      if (!state.email) {
        // 初回ログインを途中でやめた。接続していない状態に戻す。
        state = null;
        saveState();
        setStatus('off', result.reason === 'access_denied' ? '' : authMessage(result.reason));
        return;
      }
      if (result.silent) {
        state = { ...state, silentFailed: true };
        saveState();
      }
      setStatus('needs-auth', authMessage(result.reason));
      return;
    }

    if (accessToken()) { syncNow(); return; }

    // トークン切れ。自動同期がオンなら、この起動で1回だけ Google を経由して取り直す。
    const bounced = sessionStorage.getItem(BOUNCED_KEY);
    if (state.auto && !state.silentFailed && navigator.onLine && !bounced) {
      sessionStorage.setItem(BOUNCED_KEY, '1');
      startAuth({ silent: true });
      return;
    }
    setStatus(navigator.onLine ? 'needs-auth' : 'offline');
  }

  function authMessage(reason) {
    if (reason === 'scope') return 'Google ドライブへのアクセスが許可されませんでした。ログインし直すときに、ドライブの項目にチェックを入れてください';
    if (reason === 'state') return 'ログインの確認に失敗しました。もう一度お試しください';
    if (reason === 'access_denied') return 'ログインがキャンセルされました';
    return 'Google での確認が必要です';
  }

  // 別の端末の変更を拾うため、アプリに戻ってきたときにも同期する。
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !state || !accessToken()) return;
    if (Date.now() - (state.lastSyncAt ?? 0) < 30000) return;
    syncNow();
  });
  window.addEventListener('online', () => {
    if (state && accessToken()) syncNow();
  });

  window.CertSync = {
    get configured() { return configured; },
    get connected() { return Boolean(state); },
    get state() { return state; },
    get status() { return status; },
    onStatus(fn) { statusListeners.add(fn); fn(status, state); },
    onRemoteApplied(fn) { remoteListeners.add(fn); },
    notifyChange,
    recordDeletion,
    requestSync,
    connect,
    disconnect,
    setAuto,
    syncNow,
  };

  start();
  mountUI();

  // ---------- 画面（index.html にだけある） ----------

  function mountUI() {
    const btn = document.getElementById('syncBtn');
    const dlg = document.getElementById('syncDialog');
    if (!btn || !dlg) return;
    if (!configured) return;

    btn.hidden = false;
    const $ = (id) => document.getElementById(id);

    const LABEL = {
      off: '未接続',
      syncing: '同期しています…',
      ok: '同期済み',
      offline: 'オフライン（つながったら同期します）',
      'needs-auth': '未同期（Google での確認が必要です）',
      error: '同期に失敗しました',
    };

    function formatTime(ms) {
      if (!ms) return 'まだありません';
      const d = new Date(ms);
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function paint() {
      const on = Boolean(state);
      btn.dataset.state = on ? status.phase : 'off';
      btn.title = on ? `端末間の同期：${LABEL[status.phase] ?? ''}` : '端末間の同期（Google でログイン）';

      $('syncOff').hidden = on;
      $('syncOn').hidden = !on;
      $('syncMessage').textContent = status.message;
      $('syncMessage').hidden = !status.message;
      if (!on) return;

      $('syncAccount').textContent = state.email
        ? `${state.name ? `${state.name}（${state.email}）` : state.email}`
        : '確認中…';
      $('syncStatus').textContent = LABEL[status.phase] ?? '';
      $('syncStatus').dataset.state = status.phase;
      $('syncLast').textContent = formatTime(state.lastSyncAt);
      $('syncAuto').checked = state.auto !== false;
      $('syncNowBtn').disabled = status.phase === 'syncing';
      $('syncNowBtn').textContent = accessToken() ? '今すぐ同期' : 'Google で確認して同期';
    }

    btn.addEventListener('click', () => {
      paint();
      dlg.showModal();
    });
    $('syncLogin').addEventListener('click', connect);
    $('syncNowBtn').addEventListener('click', requestSync);
    $('syncAuto').addEventListener('change', (e) => setAuto(e.target.checked));
    $('syncLogout').addEventListener('click', () => {
      if (!confirm('この端末で同期をやめます。この端末のデータとドライブのデータはどちらも残ります。よろしいですか？')) return;
      disconnect();
    });

    statusListeners.add(paint);
    paint();
  }
})();
