/* 開発者向け: 資格・検定プリセットの編集ツール。
 *
 * ふだんは何も表示しない。有効にしたときだけ ⋯ メニューに入口が出る。
 *
 * ■ 有効にする方法（どちらでも）
 *   1. URL に ?dev=1 を付けて開く（?dev=0 で解除）
 *   2. ヘッダーのタイトルを 7 回続けてタップ
 *
 * ■ できること
 *   - プリセットの追加 / 編集 / 削除（削除は「候補から外す」）
 *   - 編集中はこの端末の localStorage に差分として持つ（下書き）
 *   - 「GitHub に反映」で js/presets.js へ直接コミットする。
 *     これで全ユーザーの自動入力候補が実際に変わる
 *   - 手動でやりたいときは JSON を書き出して tools/apply-overrides.mjs で当てる
 *
 * ■ GitHub への反映について
 *   静的サイトなのでサーバーがない。代わりに GitHub の API を直接叩く。
 *   個人アクセストークンはこの端末の localStorage にだけ置き、
 *   リポジトリには絶対に含めない。権限は対象リポジトリの Contents 読み書きだけで足りる。
 *
 * ■ 入口そのものは認証ではない
 *   ?dev=1 を知っていれば誰でもパネルは開ける。ただし GitHub へ反映するには
 *   トークンが要るので、公開中のプリセットを書き換えられるのはトークンを持つ人だけ。
 */
(() => {
  'use strict';

  const DEV_KEY = 'cert-tracker.dev';
  const OVERRIDES_KEY = 'cert-tracker.presetOverrides.v1';
  const GH_KEY = 'cert-tracker.github';        // 反映先の設定（トークン以外）
  const GH_TOKEN_KEY = 'cert-tracker.githubToken';  // トークンは別キーに分けて持つ

  const FIELDS = ['name', 'short', 'alias', 'category', 'scoreType',
                  'targetScore', 'maxScore', 'scoreUnit', 'fee', 'url', 'memo'];

  const CATEGORIES = [
    'IT', 'ビジネス', '医療・福祉', '技術・工業', '語学', '会計・金融', '法律',
    '不動産・建築', '公務員・教育', '車・運転', '食・料理', '動物・自然',
    'デザイン・美術', '服飾・美容', '音楽・芸能', 'スポーツ', '歴史・地理',
    '理科・数学', '趣味・カルチャー', 'ご当地', '適性検査', 'その他',
  ];

  /** 素のプリセット（overrides を当てる前）。差分の計算に使う。 */
  const BASE = (window.CERT_PRESETS ?? []).map((p) => ({ ...p }));

  let overrides = loadOverrides();

  // ---------- 有効・無効 ----------

  function readDevFlag() {
    const params = new URLSearchParams(location.search);
    if (params.has('dev')) {
      const on = params.get('dev') !== '0';
      try { localStorage.setItem(DEV_KEY, on ? '1' : '0'); } catch { /* 保存できなくても続行 */ }
      // URL に痕跡を残さない
      const url = new URL(location.href);
      url.searchParams.delete('dev');
      history.replaceState(null, '', url);
      return on;
    }
    try { return localStorage.getItem(DEV_KEY) === '1'; } catch { return false; }
  }

  let devMode = readDevFlag();

  // ---------- overrides ----------

  function loadOverrides() {
    try {
      const raw = localStorage.getItem(OVERRIDES_KEY);
      return normalizeOverrides(raw ? JSON.parse(raw) : null);
    } catch {
      return normalizeOverrides(null);
    }
  }

  function normalizeOverrides(o) {
    return {
      edits: (o && typeof o.edits === 'object' && o.edits) || {},
      added: Array.isArray(o?.added) ? o.added : [],
      removed: Array.isArray(o?.removed) ? o.removed : [],
    };
  }

  function saveOverrides() {
    try {
      localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
    } catch (err) {
      console.error('プリセットの変更を保存できませんでした', err);
      alert('変更を保存できませんでした（保存容量の上限かもしれません）');
    }
  }

  function hasOverrides() {
    return Object.keys(overrides.edits).length > 0
        || overrides.added.length > 0
        || overrides.removed.length > 0;
  }

  function diffCount() {
    return {
      edited: Object.keys(overrides.edits).length,
      added: overrides.added.length,
      removed: overrides.removed.length,
    };
  }

  /** 空のキーは持たせない。presets.js の見た目をそろえるため。 */
  function clean(p) {
    const out = {};
    for (const k of FIELDS) {
      const v = p[k];
      if (v === undefined || v === null || v === '') continue;
      out[k] = v;
    }
    return out;
  }

  /** BASE に overrides を重ねて、実際に使うプリセット配列を作る。 */
  function materialize() {
    const removed = new Set(overrides.removed);
    const out = [];
    for (const p of BASE) {
      if (removed.has(p.name)) continue;
      const patch = overrides.edits[p.name];
      out.push(patch ? clean({ ...p, ...patch }) : p);
    }
    for (const a of overrides.added) out.push(clean({ ...a }));
    return out;
  }

  function applyToApp() {
    window.CERT_PRESETS = materialize();
    window.__certTracker?.reloadPresets?.();
  }

  // このスクリプトは app.js より前に読み込む。ここで差し替えておけば、
  // アプリが候補検索の索引を作る時点で変更が反映されている。
  if (hasOverrides()) window.CERT_PRESETS = materialize();

  // ---------- 起動 ----------

  document.addEventListener('DOMContentLoaded', () => {
    setupSecretGesture();
    if (devMode) enable();
  });

  /** タイトルを7回タップで切り替え。スマホで URL を打たずに済ませるため。 */
  function setupSecretGesture() {
    const logo = document.querySelector('.logo');
    if (!logo) return;
    let count = 0;
    let timer = null;
    logo.addEventListener('click', () => {
      count += 1;
      clearTimeout(timer);
      timer = setTimeout(() => { count = 0; }, 1200);
      if (count < 7) return;
      count = 0;
      devMode = !devMode;
      try { localStorage.setItem(DEV_KEY, devMode ? '1' : '0'); } catch { /* noop */ }
      if (devMode) { enable(); note('開発モードを有効にしました'); }
      else { disable(); note('開発モードを解除しました'); }
    });
  }

  function note(msg) {
    if (window.__certTracker?.toast) window.__certTracker.toast(msg);
    else console.log(msg);
  }

  function enable() {
    document.documentElement.dataset.dev = 'on';
    ensureMenuButton();
  }

  function disable() {
    delete document.documentElement.dataset.dev;
    document.getElementById('devOpenBtn')?.remove();
    if (dlg?.open) dlg.close();
  }

  function ensureMenuButton() {
    if (document.getElementById('devOpenBtn')) return;
    const menu = document.getElementById('menuList');
    if (!menu) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'devOpenBtn';
    btn.setAttribute('role', 'menuitem');
    btn.className = 'dev-entry';
    btn.textContent = '🛠 プリセットを編集';
    btn.addEventListener('click', openPanel);
    menu.append(btn);
  }

  // ---------- パネル ----------

  let dlg = null;
  let listEl = null;
  let searchEl = null;
  let summaryEl = null;
  /** 編集中プリセットの「元の名前」。新規追加なら null。 */
  let editingName = null;

  function openPanel() {
    if (!dlg) buildPanel();
    renderList();
    renderSummary();
    dlg.showModal();
  }

  function buildPanel() {
    dlg = document.createElement('dialog');
    dlg.id = 'devDialog';
    dlg.className = 'dialog dev-dialog';
    dlg.innerHTML = [
      '<div class="dev-head">',
      '  <h2 tabindex="-1" autofocus>プリセット編集<span class="dev-badge">開発者用</span></h2>',
      '  <button type="button" class="btn" data-act="close">閉じる</button>',
      '</div>',
      '<p class="dev-note">ここでの編集はまず下書きとしてこの端末に溜まります。',
      '<strong>「GitHub に反映」を押すと js/presets.js に直接コミットされ、',
      '全ユーザーの自動入力候補が変わります。</strong></p>',
      '<div class="dev-summary" id="devSummary"></div>',
      '<div class="dev-toolbar">',
      '  <input type="search" id="devSearch" placeholder="資格名・通称・別名で検索…" aria-label="プリセットを検索">',
      '  <button type="button" class="btn btn-primary" data-act="new">＋ 新規追加</button>',
      '</div>',
      '<ul class="dev-list" id="devList"></ul>',
      '<div class="dev-actions">',
      '  <button type="button" class="btn btn-primary" data-act="publish">GitHub に反映</button>',
      '  <button type="button" class="btn" data-act="gh-settings">反映先の設定</button>',
      '  <button type="button" class="btn" data-act="export-diff">変更点を書き出し</button>',
      '  <button type="button" class="btn" data-act="export-full">presets.js を書き出し</button>',
      '  <button type="button" class="btn" data-act="import">変更点を読み込み</button>',
      '  <button type="button" class="btn link-danger" data-act="reset">変更を全部破棄</button>',
      '</div>',
      '<input type="file" id="devImportFile" accept="application/json,.json" hidden>',
    ].join('\n');
    document.body.append(dlg);

    listEl = dlg.querySelector('#devList');
    searchEl = dlg.querySelector('#devSearch');
    summaryEl = dlg.querySelector('#devSummary');

    searchEl.addEventListener('input', renderList);
    dlg.addEventListener('click', onPanelClick);
    dlg.querySelector('#devImportFile').addEventListener('change', onImportFile);
  }

  function onPanelClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;

    if (act === 'close') { dlg.close(); return; }
    if (act === 'new') { openEditor(null); return; }
    if (act === 'export-diff') { exportDiff(); return; }
    if (act === 'export-full') { exportFull(); return; }
    if (act === 'import') { dlg.querySelector('#devImportFile').click(); return; }
    if (act === 'reset') { resetAll(); return; }
    if (act === 'publish') { publishToGitHub(); return; }
    if (act === 'gh-settings') { openGhSettings(); return; }

    const name = btn.dataset.name;
    if (act === 'edit') { openEditor(name); return; }
    if (act === 'remove') { removePreset(name); return; }
    if (act === 'restore') { restorePreset(name); return; }
  }

  // ---------- 一覧 ----------

  const fold = (s) => String(s ?? '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s　・（）()]/g, '')
    .toLowerCase();

  const LIST_LIMIT = 80;

  function renderList() {
    const raw = searchEl.value.trim();
    const q = fold(raw);
    const current = materialize();

    let rows;
    let heading;
    if (q) {
      rows = current.filter((p) => fold(`${p.name} ${p.short ?? ''} ${p.alias ?? ''}`).includes(q));
      heading = `「${raw}」に一致: ${rows.length}件`;
    } else {
      // 検索していないときは手を入れたものだけ。1400件を全部並べても選べないので。
      const touched = new Set([...Object.keys(overrides.edits), ...overrides.added.map((a) => a.name)]);
      rows = current.filter((p) => touched.has(p.name));
      heading = rows.length
        ? `変更したプリセット: ${rows.length}件（検索すると全${current.length}件から探せます）`
        : `検索して編集するプリセットを選んでください（全${current.length}件）。`;
    }

    const frag = document.createDocumentFragment();
    frag.append(hintRow(heading));

    for (const p of rows.slice(0, LIST_LIMIT)) frag.append(rowFor(p));
    if (rows.length > LIST_LIMIT) {
      frag.append(hintRow(`ほか ${rows.length - LIST_LIMIT} 件。検索を絞り込んでください。`));
    }

    // 候補から外したものは戻せるように別枠で出す
    for (const name of overrides.removed) frag.append(removedRow(name));

    listEl.replaceChildren(frag);
  }

  function hintRow(text) {
    const li = document.createElement('li');
    li.className = 'dev-hint';
    li.textContent = text;
    return li;
  }

  function removedRow(name) {
    const li = document.createElement('li');
    li.className = 'dev-row is-removed';
    li.append(mainCell(name, '候補から外しています'));
    li.append(actionBtn('restore', name, '戻す', ''));
    return li;
  }

  function mainCell(name, meta) {
    const wrap = document.createElement('div');
    wrap.className = 'dev-row-main';
    const n = document.createElement('span');
    n.className = 'dev-name';
    n.textContent = name;
    const m = document.createElement('span');
    m.className = 'dev-meta';
    m.textContent = meta;
    wrap.append(n, m);
    return wrap;
  }

  function actionBtn(act, name, label, cls) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn ${cls}`.trim();
    b.dataset.act = act;
    b.dataset.name = name;
    b.textContent = label;
    return b;
  }

  function rowFor(p) {
    const li = document.createElement('li');
    const state = overrides.added.some((a) => a.name === p.name) ? 'is-added'
      : overrides.edits[p.name] ? 'is-edited' : '';
    li.className = `dev-row ${state}`.trim();

    const bits = [];
    if (p.category) bits.push(p.category);
    if (p.short) bits.push(`短縮: ${p.short}`);
    if (p.targetScore != null) bits.push(`目標 ${p.targetScore}${p.scoreUnit ?? ''}`);
    else if (p.scoreType === 'pass') bits.push('合否のみ');
    if (p.fee != null) bits.push(`${p.fee.toLocaleString('ja-JP')}円`);

    li.append(mainCell(p.name, bits.join(' ・ ')));
    li.append(actionBtn('edit', p.name, '編集', ''));
    li.append(actionBtn('remove', p.name, '削除', 'link-danger'));
    return li;
  }

  function renderSummary() {
    const d = diffCount();
    const total = d.edited + d.added + d.removed;
    summaryEl.className = `dev-summary${total ? ' has-diff' : ''}`;
    const when = lastPublish?.at
      ? `　最後の反映: ${new Date(lastPublish.at).toLocaleString('ja-JP')}`
      : '';
    summaryEl.textContent = total
      ? `未反映の変更: 追加 ${d.added} / 編集 ${d.edited} / 削除 ${d.removed}${when}`
      : `変更はありません。${when}`;
  }

  // ---------- 編集フォーム ----------

  let editor = null;

  function openEditor(name) {
    editingName = name;
    const current = name ? materialize().find((p) => p.name === name) : null;
    if (!editor) buildEditor();

    const f = editor.querySelector('form').elements;
    editor.querySelector('h2').textContent = name ? 'プリセットを編集' : 'プリセットを追加';
    for (const k of FIELDS) f[k].value = current?.[k] ?? '';

    editor.querySelector('[data-act="revert"]').hidden = !(name && overrides.edits[name]);
    editor.showModal();
  }

  function buildEditor() {
    editor = document.createElement('dialog');
    editor.className = 'dialog dev-editor';
    editor.innerHTML = [
      '<form method="dialog" class="form">',
      '  <h2 tabindex="-1" autofocus>プリセットを編集</h2>',
      '  <label class="field"><span class="label">名称 <em>必須</em></span>',
      '    <input type="text" name="name" required maxlength="60" placeholder="例: 実用英語技能検定 2級"></label>',
      '  <div class="row">',
      '    <label class="field"><span class="label">短縮名（通称）</span>',
      '      <input type="text" name="short" maxlength="20" placeholder="例: 英検2級"></label>',
      '    <label class="field"><span class="label">カテゴリ</span>',
      '      <input type="text" name="category" list="devCategories" maxlength="20" placeholder="例: 語学">',
      `      <datalist id="devCategories">${CATEGORIES.map((c) => `<option value="${c}"></option>`).join('')}</datalist>`,
      '    </label>',
      '  </div>',
      '  <label class="field"><span class="label">検索用の別名（スペース区切り）</span>',
      '    <input type="text" name="alias" maxlength="120" placeholder="例: 英検 えいけん eiken 英語"></label>',
      '  <div class="row">',
      '    <label class="field"><span class="label">評価方式</span>',
      '      <select name="scoreType">',
      '        <option value="">指定なし（目標は本人が決める）</option>',
      '        <option value="score">スコアで評価</option>',
      '        <option value="pass">合否のみ</option>',
      '      </select></label>',
      '    <label class="field"><span class="label">単位</span>',
      '      <input type="text" name="scoreUnit" maxlength="8" placeholder="点"></label>',
      '  </div>',
      '  <div class="row">',
      '    <label class="field"><span class="label">目標スコア</span>',
      '      <input type="number" name="targetScore" step="any" placeholder="例: 60"></label>',
      '    <label class="field"><span class="label">満点</span>',
      '      <input type="number" name="maxScore" step="any" placeholder="例: 100"></label>',
      '    <label class="field"><span class="label">受験料（円）</span>',
      '      <input type="number" name="fee" step="1" placeholder="例: 7500"></label>',
      '  </div>',
      '  <label class="field"><span class="label">公式サイトURL</span>',
      '    <input type="url" name="url" placeholder="https://…"></label>',
      '  <label class="field"><span class="label">メモ（合格基準など）</span>',
      '    <textarea name="memo" rows="2" maxlength="200"></textarea></label>',
      '  <menu class="dialog-actions">',
      '    <button type="button" class="btn link-danger" data-act="revert" hidden>変更を取り消す</button>',
      '    <button type="button" class="btn" data-act="cancel">キャンセル</button>',
      '    <button type="submit" class="btn btn-primary">保存</button>',
      '  </menu>',
      '</form>',
    ].join('\n');
    document.body.append(editor);

    editor.querySelector('form').addEventListener('submit', saveEditor);
    editor.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'cancel') editor.close();
      if (act === 'revert') revertEdit();
    });
  }

  function saveEditor() {
    const f = editor.querySelector('form').elements;
    const num = (v) => (v === '' ? null : Number(v));
    const next = clean({
      name: f.name.value.trim(),
      short: f.short.value.trim(),
      alias: f.alias.value.trim(),
      category: f.category.value.trim(),
      scoreType: f.scoreType.value,
      targetScore: num(f.targetScore.value),
      maxScore: num(f.maxScore.value),
      scoreUnit: f.scoreUnit.value.trim(),
      fee: num(f.fee.value),
      url: f.url.value.trim(),
      memo: f.memo.value.trim(),
    });
    if (!next.name) return;

    const addedIdx = editingName ? overrides.added.findIndex((a) => a.name === editingName) : -1;

    if (editingName === null) {
      if (materialize().some((p) => p.name === next.name)) {
        alert(`「${next.name}」は既にあります。名前を変えてください。`);
        return;
      }
      overrides.added.push(next);
    } else if (addedIdx >= 0) {
      overrides.added[addedIdx] = next;
    } else {
      // 既存プリセットへのパッチ。素の値と変わらないキーは持たせない。
      const base = BASE.find((p) => p.name === editingName) ?? {};
      const patch = {};
      for (const k of FIELDS) {
        const a = base[k] ?? null;
        const b = next[k] ?? null;
        if (a !== b) patch[k] = b;
      }
      if (Object.keys(patch).length) overrides.edits[editingName] = patch;
      else delete overrides.edits[editingName];
    }

    commit(`「${next.name}」を保存しました`);
    editor.close();
  }

  function revertEdit() {
    if (!editingName) return;
    delete overrides.edits[editingName];
    commit(`「${editingName}」を元に戻しました`);
    editor.close();
  }

  function removePreset(name) {
    if (!confirm(`「${name}」を候補から外します。よろしいですか？`)) return;
    const i = overrides.added.findIndex((a) => a.name === name);
    if (i >= 0) overrides.added.splice(i, 1);        // 自分で足したものは消すだけ
    else if (!overrides.removed.includes(name)) overrides.removed.push(name);
    delete overrides.edits[name];
    commit(`「${name}」を候補から外しました`);
  }

  function restorePreset(name) {
    overrides.removed = overrides.removed.filter((n) => n !== name);
    commit(`「${name}」を戻しました`);
  }

  function resetAll() {
    if (!hasOverrides()) { note('変更はありません'); return; }
    const d = diffCount();
    if (!confirm(`追加 ${d.added} / 編集 ${d.edited} / 削除 ${d.removed} をすべて破棄します。よろしいですか？`)) return;
    overrides = normalizeOverrides(null);
    commit('変更をすべて破棄しました');
  }

  function commit(msg) {
    saveOverrides();
    applyToApp();
    if (dlg) { renderList(); renderSummary(); }
    window.__certTracker?.render?.();
    note(msg);
  }

  // ---------- GitHub へ反映 ----------

  const GH_DEFAULTS = { owner: 'KURU77', repo: 'cert-tracker', branch: 'main', path: 'js/presets.js' };

  function ghConfig() {
    try {
      return { ...GH_DEFAULTS, ...JSON.parse(localStorage.getItem(GH_KEY) || '{}') };
    } catch {
      return { ...GH_DEFAULTS };
    }
  }

  function ghToken() {
    try { return localStorage.getItem(GH_TOKEN_KEY) || ''; } catch { return ''; }
  }

  /** UTF-8 の文字列を GitHub API が求める base64 にする。btoa は Latin-1 しか扱えない。 */
  function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }

  function fromBase64(b64) {
    const bin = atob(b64.replace(/\n/g, ''));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  async function ghFetch(path, options = {}) {
    const res = await fetch(`https://api.github.com${path}`, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${ghToken()}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      let msg = `GitHub API ${res.status}`;
      try { msg += `: ${JSON.parse(detail).message}`; } catch { /* 本文が JSON でないこともある */ }
      throw new Error(msg);
    }
    return res.json();
  }

  async function publishToGitHub() {
    if (!hasOverrides()) { note('反映する変更がありません'); return; }
    if (!ghToken()) { note('先に「反映先の設定」でトークンを入れてください'); openGhSettings(); return; }

    const cfg = ghConfig();
    const d = diffCount();
    const msg = prompt(
      `js/presets.js に直接コミットします（追加 ${d.added} / 編集 ${d.edited} / 削除 ${d.removed}）。\nコミットメッセージ:`,
      `プリセットを更新（追加 ${d.added} / 編集 ${d.edited} / 削除 ${d.removed}）`
    );
    if (msg === null) return;

    const btn = dlg.querySelector('[data-act="publish"]');
    btn.disabled = true;
    btn.textContent = '反映中…';

    try {
      // いまの presets.js を取ってくる（sha が無いと更新できない）
      const file = await ghFetch(
        `/repos/${cfg.owner}/${cfg.repo}/contents/${cfg.path}?ref=${encodeURIComponent(cfg.branch)}`
      );
      const currentSource = fromBase64(file.content);

      // 取得したソースを土台にして差分を当てる。
      // BASE ではなく取得結果を使うのは、他の端末からの変更を踏み潰さないため。
      const { source, report } = globalThis.PRESET_PATCH.applyOverrides(currentSource, overrides, BASE);

      if (source === currentSource) {
        note('反映できる変更がありませんでした');
        return;
      }

      const commit = await ghFetch(`/repos/${cfg.owner}/${cfg.repo}/contents/${cfg.path}`, {
        method: 'PUT',
        body: JSON.stringify({
          message: msg,
          content: toBase64(source),
          sha: file.sha,
          branch: cfg.branch,
        }),
      });

      lastPublish = {
        at: new Date().toISOString(),
        url: commit.commit?.html_url ?? '',
        report,
      };
      savePublishState();
      renderSummary();

      const skipped = report.skipped.length ? `\n\n反映できなかったもの:\n${report.skipped.join('\n')}` : '';
      alert(
        `コミットしました。\n\n追加 ${report.added.length} / 編集 ${report.edited.length} / 削除 ${report.removed.length}`
        + `\n\n公開サイトへの反映には1分ほどかかります。`
        + `\n反映を確認したら「変更を全部破棄」で手元の下書きを片付けてください。${skipped}`
      );
    } catch (err) {
      console.error(err);
      alert(`反映できませんでした。\n\n${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = 'GitHub に反映';
    }
  }

  let lastPublish = loadPublishState();

  function loadPublishState() {
    try { return JSON.parse(localStorage.getItem('cert-tracker.lastPublish') || 'null'); } catch { return null; }
  }

  function savePublishState() {
    try { localStorage.setItem('cert-tracker.lastPublish', JSON.stringify(lastPublish)); } catch { /* noop */ }
  }

  // ---------- 反映先の設定 ----------

  let ghDialog = null;

  function openGhSettings() {
    if (!ghDialog) buildGhSettings();
    const cfg = ghConfig();
    const f = ghDialog.querySelector('form').elements;
    f.owner.value = cfg.owner;
    f.repo.value = cfg.repo;
    f.branch.value = cfg.branch;
    f.path.value = cfg.path;
    f.token.value = ghToken();
    ghDialog.querySelector('.gh-status').textContent = '';
    ghDialog.showModal();
  }

  function buildGhSettings() {
    ghDialog = document.createElement('dialog');
    ghDialog.className = 'dialog dev-editor';
    ghDialog.innerHTML = [
      '<form method="dialog" class="form">',
      '  <h2 tabindex="-1" autofocus>反映先の設定</h2>',
      '  <p class="dev-note">',
      '    GitHub の個人アクセストークンを使って js/presets.js に直接コミットします。',
      '    トークンはこの端末にだけ保存され、リポジトリには含まれません。',
      '    <br><strong>Fine-grained token</strong> で、このリポジトリだけに絞り、',
      '    権限は <strong>Contents: Read and write</strong> のみで足ります。',
      '  </p>',
      '  <label class="field"><span class="label">アクセストークン</span>',
      '    <input type="password" name="token" autocomplete="off" placeholder="github_pat_…"></label>',
      '  <div class="row">',
      '    <label class="field"><span class="label">オーナー</span>',
      '      <input type="text" name="owner" placeholder="KURU77"></label>',
      '    <label class="field"><span class="label">リポジトリ</span>',
      '      <input type="text" name="repo" placeholder="cert-tracker"></label>',
      '  </div>',
      '  <div class="row">',
      '    <label class="field"><span class="label">ブランチ</span>',
      '      <input type="text" name="branch" placeholder="main"></label>',
      '    <label class="field"><span class="label">ファイル</span>',
      '      <input type="text" name="path" placeholder="js/presets.js"></label>',
      '  </div>',
      '  <p class="gh-status"></p>',
      '  <menu class="dialog-actions">',
      '    <button type="button" class="btn link-danger" data-act="gh-forget">トークンを消す</button>',
      '    <button type="button" class="btn" data-act="gh-test">接続テスト</button>',
      '    <button type="submit" class="btn btn-primary">保存</button>',
      '  </menu>',
      '</form>',
    ].join('\n');
    document.body.append(ghDialog);

    ghDialog.querySelector('form').addEventListener('submit', saveGhSettings);
    ghDialog.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'gh-test') testGhConnection();
      if (act === 'gh-forget') forgetToken();
    });
  }

  function saveGhSettings() {
    const f = ghDialog.querySelector('form').elements;
    const cfg = {
      owner: f.owner.value.trim() || GH_DEFAULTS.owner,
      repo: f.repo.value.trim() || GH_DEFAULTS.repo,
      branch: f.branch.value.trim() || GH_DEFAULTS.branch,
      path: f.path.value.trim() || GH_DEFAULTS.path,
    };
    try {
      localStorage.setItem(GH_KEY, JSON.stringify(cfg));
      const t = f.token.value.trim();
      if (t) localStorage.setItem(GH_TOKEN_KEY, t);
    } catch (err) {
      console.error(err);
    }
    note('反映先を保存しました');
  }

  function forgetToken() {
    try { localStorage.removeItem(GH_TOKEN_KEY); } catch { /* noop */ }
    ghDialog.querySelector('form').elements.token.value = '';
    ghDialog.querySelector('.gh-status').textContent = 'トークンを消しました。';
  }

  async function testGhConnection() {
    const f = ghDialog.querySelector('form').elements;
    const status = ghDialog.querySelector('.gh-status');
    const t = f.token.value.trim();
    if (!t) { status.textContent = 'トークンを入れてください。'; return; }
    try { localStorage.setItem(GH_TOKEN_KEY, t); } catch { /* noop */ }

    status.textContent = '確認中…';
    const owner = f.owner.value.trim() || GH_DEFAULTS.owner;
    const repo = f.repo.value.trim() || GH_DEFAULTS.repo;
    const branch = f.branch.value.trim() || GH_DEFAULTS.branch;
    const path = f.path.value.trim() || GH_DEFAULTS.path;
    try {
      const file = await ghFetch(`/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`);
      const src = fromBase64(file.content);
      const count = (src.match(/\{ name: /g) || []).length;
      status.textContent = `OK: ${path} を読めました（プリセット ${count} 件）。書き込み権限は反映時に確認されます。`;
    } catch (err) {
      status.textContent = `失敗: ${err.message}`;
    }
  }

  // ---------- 書き出し・読み込み ----------

  function download(filename, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const stamp = () => new Date().toISOString().slice(0, 10);

  function exportDiff() {
    if (!hasOverrides()) { note('書き出す変更がありません'); return; }
    const payload = {
      format: 'cert-tracker-preset-overrides',
      version: 1,
      exportedAt: new Date().toISOString(),
      edits: overrides.edits,
      added: overrides.added,
      removed: overrides.removed,
    };
    download(`preset-overrides-${stamp()}.json`, JSON.stringify(payload, null, 2), 'application/json');
    note('変更点を書き出しました');
  }

  function exportFull() {
    download(`presets-${stamp()}.js`, toPresetsSource(materialize()), 'text/javascript');
    note('presets.js を書き出しました');
  }

  /** materialize() の結果を presets.js のソースに戻す。 */
  function toPresetsSource(list) {
    const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    const byCat = new Map();
    for (const p of list) {
      const c = p.category || 'その他';
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c).push(p);
    }

    let out = '/* よく受験される資格・検定のプリセット。\n'
      + '   このファイルは開発者向けツールから書き出したものです。\n'
      + `   書き出し: ${new Date().toISOString()}\n`
      + '   合格基準や受験料は変わることがあるので、公式サイトで確認してください。 */\n'
      + 'window.CERT_PRESETS = [\n';

    for (const [cat, rows] of byCat) {
      out += `\n  /* ---------- ${cat} ---------- */\n`;
      for (const p of rows) {
        const parts = [];
        for (const k of FIELDS) {
          const v = p[k];
          if (v === undefined || v === null || v === '') continue;
          parts.push(`${k}: ${typeof v === 'number' ? v : q(v)}`);
        }
        out += `  { ${parts.join(', ')} },\n`;
      }
    }
    return `${out}];\n`;
  }

  function onImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (parsed.format && parsed.format !== 'cert-tracker-preset-overrides') {
          throw new Error('形式が違います');
        }
        overrides = normalizeOverrides(parsed);
        commit('変更点を読み込みました');
      } catch (err) {
        console.error(err);
        alert('読み込めませんでした。書き出した JSON か確認してください。');
      }
    };
    reader.readAsText(file);
  }

  // コンソールからも触れるようにしておく
  window.CERT_DEV = {
    get enabled() { return devMode; },
    enable() { devMode = true; try { localStorage.setItem(DEV_KEY, '1'); } catch {} enable(); },
    disable() { devMode = false; try { localStorage.setItem(DEV_KEY, '0'); } catch {} disable(); },
    open: openPanel,
    get overrides() { return overrides; },
    exportDiff,
    exportFull,
    publish: publishToGitHub,
    settings: openGhSettings,
    toPresetsSource: () => toPresetsSource(materialize()),
  };
})();
