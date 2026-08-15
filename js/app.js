/* 資格・検定トラッカー — localStorage だけで動く単一ページアプリ */
(() => {
  'use strict';

  const STORAGE_KEY = 'cert-tracker.items.v1';
  const THEME_KEY = 'cert-tracker.theme';

  const STATUSES = [
    { value: 'planning', label: '検討中' },
    { value: 'studying', label: '勉強中' },
    { value: 'applied',  label: '申込済' },
    { value: 'passed',   label: '合格' },
    { value: 'failed',   label: '不合格' },
  ];

  const PRIORITIES = [
    { value: 'high', label: '優先度 高', weight: 0 },
    { value: 'mid',  label: '優先度 中', weight: 1 },
    { value: 'low',  label: '優先度 低', weight: 2 },
  ];

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const el = {
    list: $('#list'),
    empty: $('#empty'),
    search: $('#search'),
    filterStatus: $('#filterStatus'),
    filterCategory: $('#filterCategory'),
    sortBy: $('#sortBy'),
    categoryOptions: $('#categoryOptions'),
    statusSelect: $('#statusSelect'),
    certDialog: $('#certDialog'),
    certForm: $('#certForm'),
    dialogTitle: $('#dialogTitle'),
    scoreType: $('#scoreType'),
    scoreFields: $('#scoreFields'),
    nameInput: $('#nameInput'),
    nameSuggest: $('#nameSuggest'),
    attemptDialog: $('#attemptDialog'),
    attemptForm: $('#attemptForm'),
    attemptCertName: $('#attemptCertName'),
    attemptScoreField: $('#attemptScoreField'),
    importFile: $('#importFile'),
    menuBtn: $('#menuBtn'),
    menuList: $('#menuList'),
    toast: $('#toast'),
  };

  /** @type {Array<object>} */
  let items = [];
  let editingId = null;
  let attemptTargetId = null;

  // ---------- storage ----------

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      items = Array.isArray(parsed) ? parsed.map(normalize) : [];
    } catch (err) {
      console.error('保存データの読み込みに失敗しました', err);
      items = [];
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (err) {
      console.error('保存に失敗しました', err);
      toast('保存に失敗しました（保存容量が上限の可能性があります）');
    }
  }

  function normalize(raw) {
    const item = raw && typeof raw === 'object' ? raw : {};
    return {
      id: typeof item.id === 'string' && item.id ? item.id : newId(),
      name: String(item.name ?? '名称未設定'),
      category: String(item.category ?? ''),
      priority: PRIORITIES.some((p) => p.value === item.priority) ? item.priority : 'mid',
      status: STATUSES.some((s) => s.value === item.status) ? item.status : 'planning',
      scoreType: item.scoreType === 'pass' ? 'pass' : 'score',
      targetScore: toNumberOrNull(item.targetScore),
      maxScore: toNumberOrNull(item.maxScore),
      scoreUnit: String(item.scoreUnit ?? '点'),
      examDate: typeof item.examDate === 'string' ? item.examDate : '',
      fee: toNumberOrNull(item.fee),
      url: typeof item.url === 'string' ? item.url : '',
      memo: String(item.memo ?? ''),
      attempts: Array.isArray(item.attempts) ? item.attempts.map(normalizeAttempt) : [],
      createdAt: Number(item.createdAt) || Date.now(),
      updatedAt: Number(item.updatedAt) || Date.now(),
    };
  }

  function normalizeAttempt(raw) {
    const a = raw && typeof raw === 'object' ? raw : {};
    return {
      id: typeof a.id === 'string' && a.id ? a.id : newId(),
      date: typeof a.date === 'string' ? a.date : '',
      score: toNumberOrNull(a.score),
      result: a.result === 'passed' || a.result === 'failed' ? a.result : '',
      note: String(a.note ?? ''),
    };
  }

  function toNumberOrNull(v) {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function newId() {
    return (crypto.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  }

  // ---------- derived values ----------

  function bestScore(item) {
    const scores = item.attempts.map((a) => a.score).filter((s) => s !== null);
    return scores.length ? Math.max(...scores) : null;
  }

  function progress(item) {
    if (item.status === 'passed') return 1;
    if (item.scoreType !== 'score' || !item.targetScore) return null;
    const best = bestScore(item);
    if (best === null) return 0;
    return Math.min(best / item.targetScore, 1);
  }

  function daysUntil(dateStr) {
    if (!dateStr) return null;
    const target = new Date(`${dateStr}T00:00:00`);
    if (Number.isNaN(target.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((target - today) / 86400000);
  }

  function statusLabel(value) {
    return STATUSES.find((s) => s.value === value)?.label ?? value;
  }

  function priorityLabel(value) {
    return PRIORITIES.find((p) => p.value === value)?.label ?? value;
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(`${dateStr}T00:00:00`);
    if (Number.isNaN(d.getTime())) return dateStr;
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  }

  // ---------- rendering ----------

  function visibleItems() {
    const q = el.search.value.trim().toLowerCase();
    const status = el.filterStatus.value;
    const category = el.filterCategory.value;

    const filtered = items.filter((item) => {
      if (status && item.status !== status) return false;
      if (category && item.category !== category) return false;
      if (q) {
        const hay = `${item.name} ${item.category} ${item.memo}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const sorters = {
      priority: (a, b) => prioWeight(a) - prioWeight(b) || examRank(a) - examRank(b) || a.name.localeCompare(b.name, 'ja'),
      examDate: (a, b) => examRank(a) - examRank(b) || a.name.localeCompare(b.name, 'ja'),
      name: (a, b) => a.name.localeCompare(b.name, 'ja'),
      progress: (a, b) => (progress(b) ?? -1) - (progress(a) ?? -1),
      created: (a, b) => b.createdAt - a.createdAt,
    };

    return filtered.sort(sorters[el.sortBy.value] ?? sorters.priority);
  }

  function prioWeight(item) {
    return PRIORITIES.find((p) => p.value === item.priority)?.weight ?? 1;
  }

  function examRank(item) {
    const d = daysUntil(item.examDate);
    return d === null ? Number.MAX_SAFE_INTEGER : d;
  }

  function render() {
    renderStats();
    renderFilterOptions();

    const shown = visibleItems();
    el.list.replaceChildren(...shown.map(buildCard));

    const noItems = items.length === 0;
    el.empty.hidden = !(noItems || shown.length === 0);
    if (!noItems && shown.length === 0) {
      el.empty.textContent = '条件に一致する資格がありません。検索条件を変えてみてください。';
    } else if (noItems) {
      el.empty.innerHTML =
        'まだ資格が登録されていません。<br>「＋ 資格を追加」から、取りたい資格と目標スコアを登録してみましょう。';
    }
  }

  function renderStats() {
    $('#statTotal').textContent = String(items.length);
    $('#statStudying').textContent = String(items.filter((i) => i.status === 'studying' || i.status === 'applied').length);
    $('#statPassed').textContent = String(items.filter((i) => i.status === 'passed').length);

    const upcoming = items
      .filter((i) => i.status !== 'passed' && examRank(i) >= 0 && i.examDate)
      .sort((a, b) => examRank(a) - examRank(b))[0];

    const nextEl = $('#statNext');
    if (!upcoming) {
      nextEl.textContent = '—';
      nextEl.title = '';
    } else {
      const d = daysUntil(upcoming.examDate);
      nextEl.textContent = d === 0 ? '今日' : `あと${d}日`;
      nextEl.title = `${upcoming.name}（${formatDate(upcoming.examDate)}）`;
    }
  }

  function renderFilterOptions() {
    const categories = [...new Set(items.map((i) => i.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'));

    const keep = el.filterCategory.value;
    el.filterCategory.replaceChildren(
      option('', 'すべてのカテゴリ'),
      ...categories.map((c) => option(c, c))
    );
    el.filterCategory.value = categories.includes(keep) ? keep : '';

    el.categoryOptions.replaceChildren(...categories.map((c) => option(c, '')));
  }

  function option(value, label) {
    const o = document.createElement('option');
    o.value = value;
    if (label) o.textContent = label;
    return o;
  }

  function buildCard(item) {
    const li = document.createElement('li');
    li.className = 'card';
    li.dataset.id = item.id;

    // --- title + badges ---
    const top = document.createElement('div');
    top.className = 'card-top';

    const h3 = document.createElement('h3');
    h3.className = 'card-title';
    if (item.url) {
      const a = document.createElement('a');
      a.href = item.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = item.name;
      h3.append(a);
    } else {
      h3.textContent = item.name;
    }
    top.append(h3);

    const badges = document.createElement('div');
    badges.className = 'badges';
    badges.append(
      badge(statusLabel(item.status), `status-${item.status}`),
      badge(priorityLabel(item.priority), `prio-${item.priority}`)
    );
    if (item.category) badges.append(badge(item.category, ''));
    top.append(badges);
    li.append(top);

    // --- score ---
    if (item.scoreType === 'score') {
      const best = bestScore(item);
      const unit = item.scoreUnit || '';

      const row = document.createElement('div');
      row.className = 'score-row';

      const now = document.createElement('span');
      now.innerHTML = `<span class="score-now">${best === null ? '—' : escapeHtml(String(best))}</span>`
        + `<span> ${escapeHtml(unit)} 現在の最高</span>`;

      const target = document.createElement('span');
      target.className = 'score-target';
      target.textContent = item.targetScore !== null
        ? `目標 ${item.targetScore}${unit}${item.maxScore !== null ? ` / 満点 ${item.maxScore}${unit}` : ''}`
        : '目標未設定';

      row.append(now, target);
      li.append(row);

      const p = progress(item);
      if (p !== null) {
        const bar = document.createElement('div');
        bar.className = `bar${p >= 1 ? ' reached' : ''}`;
        bar.setAttribute('role', 'progressbar');
        bar.setAttribute('aria-valuenow', String(Math.round(p * 100)));
        bar.setAttribute('aria-valuemin', '0');
        bar.setAttribute('aria-valuemax', '100');
        bar.setAttribute('aria-label', `${item.name} の目標達成率`);
        const fill = document.createElement('span');
        fill.style.width = `${Math.round(p * 100)}%`;
        bar.append(fill);
        li.append(bar);
      }
    }

    // --- meta ---
    const meta = document.createElement('div');
    meta.className = 'meta';

    if (item.examDate) {
      const d = daysUntil(item.examDate);
      const span = document.createElement('span');
      let suffix = '';
      if (d !== null) {
        if (d < 0) { span.className = 'past'; suffix = `（${-d}日前に終了）`; }
        else if (d === 0) { span.className = 'soon'; suffix = '（今日）'; }
        else if (d <= 30) { span.className = 'soon'; suffix = `（あと${d}日）`; }
        else { suffix = `（あと${d}日）`; }
      }
      span.textContent = `📅 ${formatDate(item.examDate)}${suffix}`;
      meta.append(span);
    }
    if (item.fee !== null) {
      const span = document.createElement('span');
      span.textContent = `💴 ${item.fee.toLocaleString('ja-JP')}円`;
      meta.append(span);
    }
    if (meta.children.length) li.append(meta);

    // --- memo ---
    if (item.memo) {
      const memo = document.createElement('p');
      memo.className = 'memo';
      memo.textContent = item.memo;
      li.append(memo);
    }

    // --- attempts ---
    if (item.attempts.length) {
      const details = document.createElement('details');
      details.className = 'attempts';
      const summary = document.createElement('summary');
      summary.textContent = `受験記録 ${item.attempts.length}件`;
      details.append(summary);

      const ul = document.createElement('ul');
      ul.className = 'attempt-list';
      const sorted = [...item.attempts].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      for (const a of sorted) {
        const row = document.createElement('li');
        row.className = 'attempt';

        const date = document.createElement('span');
        date.className = 'a-date';
        date.textContent = formatDate(a.date) || '日付なし';
        row.append(date);

        if (a.score !== null) {
          const score = document.createElement('span');
          score.className = 'a-score';
          score.textContent = `${a.score}${item.scoreUnit || ''}`;
          row.append(score);
        }
        if (a.result) {
          row.append(badge(a.result === 'passed' ? '合格' : '不合格', `status-${a.result}`));
        }
        if (a.note) {
          const note = document.createElement('span');
          note.className = 'a-note';
          note.textContent = a.note;
          row.append(note);
        }

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'a-del';
        del.dataset.action = 'delete-attempt';
        del.dataset.attemptId = a.id;
        del.title = 'この記録を削除';
        del.setAttribute('aria-label', 'この受験記録を削除');
        del.textContent = '×';
        row.append(del);

        ul.append(row);
      }
      details.append(ul);
      li.append(details);
    }

    // --- actions ---
    const actions = document.createElement('div');
    actions.className = 'card-actions';
    actions.append(
      actionBtn('スコアを記録', 'add-attempt'),
      actionBtn('編集', 'edit'),
      actionBtn('削除', 'delete', 'link-danger')
    );
    li.append(actions);

    return li;
  }

  function badge(text, cls) {
    const span = document.createElement('span');
    span.className = `badge${cls ? ` ${cls}` : ''}`;
    span.textContent = text;
    return span;
  }

  function actionBtn(label, action, extra = '') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn${extra ? ` ${extra}` : ''}`;
    b.dataset.action = action;
    b.textContent = label;
    return b;
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------- 資格名のサジェスト ----------

  const PRESETS = Array.isArray(window.CERT_PRESETS) ? window.CERT_PRESETS : [];
  const SUGGEST_LIMIT = 8;

  /** 直前にプリセットが自動入力したメモ。手書きのメモを消さないための目印。 */
  let lastPresetMemo = '';

  /** 候補を選んだ直後かどうか。フォーカスし直しただけで候補が開くのを防ぐ。 */
  let justPicked = false;

  /** 全角英数→半角、カタカナ→ひらがな、小文字化。表記ゆれを吸収して検索するため。 */
  function foldText(str) {
    return String(str)
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
      .replace(/[\s　・（）()]/g, '')
      .toLowerCase();
  }

  const presetIndex = PRESETS.map((p) => ({
    preset: p,
    name: foldText(p.name),
    haystack: `${foldText(p.name)} ${foldText(p.alias ?? '')}`,
    // 「英検」「乙4」のような通称そのもので引かれたときに最優先するための語集合。
    aliasWords: new Set(String(p.alias ?? '').split(/[\s　]+/).map(foldText).filter(Boolean)),
  }));

  /** 空白区切りの語をすべて含むものを拾う（「英検 2級」「aws アソシエイト」のような絞り込み用）。 */
  function searchPresets(query) {
    const tokens = String(query).split(/[\s　]+/).map(foldText).filter(Boolean);
    if (!tokens.length) return [];

    const joined = tokens.join('');
    const first = tokens[0];
    const hits = [];
    for (const entry of presetIndex) {
      if (!tokens.every((t) => entry.haystack.includes(t))) continue;
      // 名前が完全一致 → 通称が完全一致 → 名前の先頭一致 → 名前に含む → その他、の順。
      const rank =
        entry.name === joined ? 0 :
        entry.aliasWords.has(joined) ? 1 :
        entry.name.startsWith(joined) ? 2 :
        entry.name.startsWith(first) ? 3 :
        entry.name.includes(first) ? 4 : 5;
      hits.push({ rank, preset: entry.preset });
    }
    return hits.sort((a, b) => a.rank - b.rank).slice(0, SUGGEST_LIMIT).map((h) => h.preset);
  }

  /** 候補行に出す「カテゴリ・目標」の一行説明。 */
  function presetSummary(p) {
    const parts = [];
    if (p.category) parts.push(p.category);
    if (p.targetScore != null) {
      const unit = p.scoreUnit ?? '';
      parts.push(`目標 ${p.targetScore}${unit}${p.maxScore != null ? ` / ${p.maxScore}${unit}` : ''}`);
    } else if (p.scoreType === 'pass') {
      parts.push('合否のみ');
    } else {
      parts.push('目標は自分で設定');
    }
    if (p.fee != null) parts.push(`${p.fee.toLocaleString('ja-JP')}円`);
    return parts.join('・');
  }

  function renderSuggest() {
    if (!PRESETS.length) return;
    // 候補を選んだ直後は再表示しない。手で打ち直したら（input が飛んだら）また出す。
    if (justPicked) { closeSuggest(); return; }

    const query = el.nameInput.value.trim();
    const hits = searchPresets(query);
    if (!query || !hits.length) {
      closeSuggest();
      return;
    }

    el.nameSuggest.replaceChildren(...hits.map((p) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'presentation');

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', 'false');
      btn.dataset.presetName = p.name;

      const name = document.createElement('span');
      name.className = 's-name';
      name.textContent = p.name;

      const meta = document.createElement('span');
      meta.className = 's-meta';
      meta.textContent = presetSummary(p);

      btn.append(name, meta);
      li.append(btn);
      return li;
    }));

    el.nameSuggest.hidden = false;
    el.nameInput.setAttribute('aria-expanded', 'true');
  }

  function closeSuggest() {
    el.nameSuggest.hidden = true;
    el.nameSuggest.replaceChildren();
    el.nameInput.setAttribute('aria-expanded', 'false');
  }

  /** 候補を選んだときに、フォームの各欄をプリセットの値で埋める。 */
  function applyPreset(preset) {
    const f = el.certForm.elements;
    f.name.value = preset.name;
    if (preset.category) f.category.value = preset.category;

    // scoreType が無いプリセットは合格基準が公表されていないもの。
    // 評価方式はスコアのままにして、目標は本人に決めてもらう。
    f.scoreType.value = preset.scoreType ?? 'score';
    f.targetScore.value = preset.targetScore ?? '';
    f.maxScore.value = preset.maxScore ?? '';
    f.scoreUnit.value = preset.scoreUnit ?? '点';
    syncScoreFields();

    f.fee.value = preset.fee ?? '';
    f.url.value = preset.url ?? '';

    // メモは自分で書いた内容を優先。空か、直前に別のプリセットが入れた文言のままなら差し替える。
    if (!f.memo.value.trim() || f.memo.value === lastPresetMemo) {
      f.memo.value = preset.memo ?? '';
    }
    lastPresetMemo = preset.memo ?? '';

    justPicked = true;
    closeSuggest();
    toast(`「${preset.name}」の目安を入力しました`);
  }

  // ---------- dialogs ----------

  function openCertDialog(item) {
    editingId = item?.id ?? null;
    el.dialogTitle.textContent = item ? '資格を編集' : '資格を追加';
    el.certForm.reset();
    lastPresetMemo = '';
    justPicked = Boolean(item); // 編集時は開いた直後に候補を出さない

    const f = el.certForm.elements;
    f.name.value = item?.name ?? '';
    f.category.value = item?.category ?? '';
    f.priority.value = item?.priority ?? 'mid';
    f.status.value = item?.status ?? 'planning';
    f.examDate.value = item?.examDate ?? '';
    f.scoreType.value = item?.scoreType ?? 'score';
    f.targetScore.value = item?.targetScore ?? '';
    f.maxScore.value = item?.maxScore ?? '';
    f.scoreUnit.value = item?.scoreUnit ?? '点';
    f.fee.value = item?.fee ?? '';
    f.url.value = item?.url ?? '';
    f.memo.value = item?.memo ?? '';

    syncScoreFields();
    closeSuggest();
    el.certDialog.showModal();
    // タッチ端末では自動フォーカスするとキーボードが即座にせり上がるので、ユーザー操作に任せる。
    if (!window.matchMedia?.('(pointer: coarse)').matches) f.name.focus();
  }

  function syncScoreFields() {
    el.scoreFields.hidden = el.scoreType.value !== 'score';
  }

  function openAttemptDialog(item) {
    attemptTargetId = item.id;
    el.attemptForm.reset();
    el.attemptCertName.textContent = item.name;
    el.attemptScoreField.hidden = item.scoreType !== 'score';
    el.attemptForm.elements.date.value = new Date().toISOString().slice(0, 10);
    el.attemptDialog.showModal();
  }

  // ---------- actions ----------

  function upsertFromForm() {
    const f = el.certForm.elements;
    const data = {
      name: f.name.value.trim(),
      category: f.category.value.trim(),
      priority: f.priority.value,
      status: f.status.value,
      examDate: f.examDate.value,
      scoreType: f.scoreType.value,
      targetScore: toNumberOrNull(f.targetScore.value),
      maxScore: toNumberOrNull(f.maxScore.value),
      scoreUnit: f.scoreUnit.value.trim() || '点',
      fee: toNumberOrNull(f.fee.value),
      url: f.url.value.trim(),
      memo: f.memo.value.trim(),
    };
    if (!data.name) return;

    const existing = items.find((i) => i.id === editingId);
    if (existing) {
      Object.assign(existing, data, { updatedAt: Date.now() });
      toast('更新しました');
    } else {
      items.push(normalize({ ...data, attempts: [], createdAt: Date.now(), updatedAt: Date.now() }));
      toast('追加しました');
    }
    save();
    render();
  }

  function addAttemptFromForm() {
    const item = items.find((i) => i.id === attemptTargetId);
    if (!item) return;

    const f = el.attemptForm.elements;
    if (!f.date.value) return;

    item.attempts.push(normalizeAttempt({
      date: f.date.value,
      score: toNumberOrNull(f.score.value),
      result: f.result.value,
      note: f.note.value.trim(),
    }));

    if (f.result.value === 'passed') item.status = 'passed';
    else if (f.result.value === 'failed' && item.status !== 'passed') item.status = 'failed';

    item.updatedAt = Date.now();
    save();
    render();
    toast('受験記録を追加しました');
  }

  // ---------- import / export ----------

  function exportJson() {
    if (!items.length) { toast('書き出すデータがありません'); return; }
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cert-tracker-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('JSONを書き出しました');
  }

  function importJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!Array.isArray(parsed)) throw new Error('形式が不正です');
        const incoming = parsed.map(normalize);
        const known = new Set(items.map((i) => i.id));
        const added = incoming.filter((i) => !known.has(i.id));
        items = items.concat(added);
        save();
        render();
        toast(`${added.length}件を読み込みました`);
      } catch (err) {
        console.error(err);
        toast('読み込みに失敗しました（JSONの形式を確認してください）');
      }
    };
    reader.readAsText(file);
  }

  function addSamples() {
    const samples = [
      { name: 'TOEIC L&R', category: '語学', priority: 'high', status: 'studying', scoreType: 'score',
        targetScore: 800, maxScore: 990, scoreUnit: '点', fee: 7810,
        url: 'https://www.iibc-global.org/toeic.html', memo: '公式問題集を1冊ずつ。まずはリスニング強化。',
        attempts: [{ date: '2026-03-15', score: 690, note: '初受験' }, { date: '2026-06-21', score: 745, note: 'Part5が課題' }] },
      { name: '基本情報技術者試験', category: 'IT', priority: 'high', status: 'applied', scoreType: 'score',
        targetScore: 600, maxScore: 1000, scoreUnit: '点', fee: 7500, memo: '科目A・科目Bとも600点以上で合格。' },
      { name: '日商簿記2級', category: '会計・金融', priority: 'mid', status: 'planning', scoreType: 'score',
        targetScore: 70, maxScore: 100, scoreUnit: '点', fee: 5500, memo: '3級の復習から。' },
      { name: '普通自動車第一種運転免許', category: 'その他', priority: 'low', status: 'planning', scoreType: 'pass',
        scoreUnit: '', memo: '合宿で取得予定。' },
    ];
    for (const s of samples) items.push(normalize({ ...s, createdAt: Date.now(), updatedAt: Date.now() }));
    save();
    render();
    toast('サンプルデータを追加しました');
  }

  // ---------- misc ui ----------

  let toastTimer = null;
  function toast(message) {
    el.toast.textContent = message;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2600);
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    $('#themeToggle').textContent = theme === 'dark' ? '☀️' : '🌙';
  }

  function initTheme() {
    const stored = localStorage.getItem(THEME_KEY);
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    applyTheme(stored ?? (prefersDark ? 'dark' : 'light'));
  }

  function fillSelects() {
    el.filterStatus.replaceChildren(
      option('', 'すべてのステータス'),
      ...STATUSES.map((s) => option(s.value, s.label))
    );
    el.statusSelect.replaceChildren(...STATUSES.map((s) => option(s.value, s.label)));
  }

  function toggleMenu(force) {
    const open = force ?? el.menuList.hidden;
    el.menuList.hidden = !open;
    el.menuBtn.setAttribute('aria-expanded', String(open));
  }

  // ---------- events ----------

  function bind() {
    $('#addBtn').addEventListener('click', () => openCertDialog(null));

    $('#themeToggle').addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem(THEME_KEY, next);
      applyTheme(next);
    });

    el.menuBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
    document.addEventListener('click', () => toggleMenu(false));
    el.menuList.addEventListener('click', () => toggleMenu(false));

    $('#exportBtn').addEventListener('click', exportJson);
    $('#importBtn').addEventListener('click', () => el.importFile.click());
    $('#sampleBtn').addEventListener('click', addSamples);
    $('#clearBtn').addEventListener('click', () => {
      if (!items.length) { toast('削除するデータがありません'); return; }
      if (!confirm(`登録されている${items.length}件をすべて削除します。よろしいですか？`)) return;
      items = [];
      save();
      render();
      toast('すべて削除しました');
    });

    el.importFile.addEventListener('change', () => {
      const file = el.importFile.files?.[0];
      if (file) importJson(file);
      el.importFile.value = '';
    });

    for (const node of [el.search, el.filterStatus, el.filterCategory, el.sortBy]) {
      node.addEventListener('input', render);
    }

    el.scoreType.addEventListener('change', syncScoreFields);

    // 資格名のサジェスト
    el.nameInput.addEventListener('input', () => { justPicked = false; renderSuggest(); });
    el.nameInput.addEventListener('focus', renderSuggest);
    el.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !el.nameSuggest.hidden) {
        e.stopPropagation(); // 候補だけ閉じ、ダイアログは閉じない
        closeSuggest();
      }
    });
    // click だと blur が先に走って候補が消える端末があるため mousedown / touchstart で拾う。
    el.nameSuggest.addEventListener('pointerdown', (e) => {
      const btn = e.target.closest('[data-preset-name]');
      if (!btn) return;
      e.preventDefault();
      const preset = PRESETS.find((p) => p.name === btn.dataset.presetName);
      if (preset) applyPreset(preset);
    });
    el.certDialog.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('.combo')) closeSuggest();
    });
    el.certDialog.addEventListener('close', closeSuggest);

    el.certForm.addEventListener('submit', upsertFromForm);
    el.attemptForm.addEventListener('submit', addAttemptFromForm);

    for (const btn of $$('[data-close]')) {
      btn.addEventListener('click', () => btn.closest('dialog').close());
    }

    el.list.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const id = btn.closest('.card')?.dataset.id;
      const item = items.find((i) => i.id === id);
      if (!item) return;

      switch (btn.dataset.action) {
        case 'edit':
          openCertDialog(item);
          break;
        case 'add-attempt':
          openAttemptDialog(item);
          break;
        case 'delete':
          if (!confirm(`「${item.name}」を削除します。よろしいですか？`)) return;
          items = items.filter((i) => i.id !== id);
          save();
          render();
          toast('削除しました');
          break;
        case 'delete-attempt':
          if (!confirm('この受験記録を削除します。よろしいですか？')) return;
          item.attempts = item.attempts.filter((a) => a.id !== btn.dataset.attemptId);
          item.updatedAt = Date.now();
          save();
          render();
          toast('受験記録を削除しました');
          break;
      }
    });
  }

  // ---------- オフライン対応 ----------

  /** Service Worker を登録して、電波がなくても起動できるようにする。 */
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const incoming = reg.installing;
        if (!incoming) return;
        incoming.addEventListener('statechange', () => {
          // すでに動いている Service Worker がある状態でのインストール完了＝更新あり。
          // 表示中の内容を差し替えると入力中のフォームが飛ぶので、反映は次回起動に回す。
          if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
            toast('新しいバージョンを取得しました。次に開いたときに反映されます');
          }
        });
      });
    }).catch((err) => {
      // オフライン対応が使えないだけで、アプリ自体は問題なく動く。
      console.warn('Service Worker を登録できませんでした', err);
    });
  }

  // ---------- init ----------

  initTheme();
  fillSelects();
  bind();
  load();
  render();

  if (document.readyState === 'complete') registerServiceWorker();
  else window.addEventListener('load', registerServiceWorker);
})();
