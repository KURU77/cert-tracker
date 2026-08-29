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
 *   - 変更はこの端末の localStorage に持つ。本体の presets.js は書き換えない
 *   - 変更点を JSON で書き出し → tools/apply-overrides.mjs で presets.js に反映
 *   - presets.js を丸ごと書き出すこともできる
 *
 * ■ これは認証ではない
 *   静的サイトなのでサーバー側で誰かを判定できない。URL を知っていれば誰でも開ける。
 *   ただし編集結果はその人の端末に閉じており、公開中のデータは一切変わらない。
 *   秘密にしたい情報はここに置かないこと。
 */
(() => {
  'use strict';

  const DEV_KEY = 'cert-tracker.dev';
  const OVERRIDES_KEY = 'cert-tracker.presetOverrides.v1';

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
      '<p class="dev-note">変更はこの端末にだけ保存されます。公開中のアプリは変わりません。',
      '直したら「変更点を書き出し」で JSON を保存してください。</p>',
      '<div class="dev-summary" id="devSummary"></div>',
      '<div class="dev-toolbar">',
      '  <input type="search" id="devSearch" placeholder="資格名・通称・別名で検索…" aria-label="プリセットを検索">',
      '  <button type="button" class="btn btn-primary" data-act="new">＋ 新規追加</button>',
      '</div>',
      '<ul class="dev-list" id="devList"></ul>',
      '<div class="dev-actions">',
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
    summaryEl.textContent = total
      ? `未書き出しの変更: 追加 ${d.added} / 編集 ${d.edited} / 削除 ${d.removed}`
      : '変更はありません。';
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
    toPresetsSource: () => toPresetsSource(materialize()),
  };
})();
