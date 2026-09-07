/* 資格ずかん — プリセットを分野ごとに眺めるためのページ。
   マイリスト（index.html）と同じ localStorage を使うので、
   ここから追加したものはそのままトラッカー側に出ます。 */
(() => {
  'use strict';

  const STORAGE_KEY = 'cert-tracker.items.v1';
  const THEME_KEY = 'cert-tracker.theme';
  /** 開いていた分野を覚えておくキー。次に来たとき同じ状態で始められる。 */
  const OPEN_KEY = 'cert-tracker.browseOpen';

  const PRESETS = Array.isArray(window.CERT_PRESETS) ? window.CERT_PRESETS : [];

  /* 分野の並び順と、その分野が何なのかの一行説明。
     presets.js に新しいカテゴリが増えても、ここに無ければ末尾にまわるだけで表示はされる。 */
  const CATEGORIES = [
    ['語学', '英語・中国語など、ことばの力をはかるもの'],
    ['IT', 'プログラミング、ネットワーク、情報セキュリティ'],
    ['ビジネス', '経営・労務・マーケティングなど、働き方まわり'],
    ['会計・金融', '簿記、税、投資、保険'],
    ['法律', '法律を仕事にするための国家資格'],
    ['不動産・建築', '土地・建物・住まいに関わるもの'],
    ['技術・工業', '電気、機械、危険物、設備の管理'],
    ['車・運転', '運転免許、整備、ドローン、船舶'],
    ['医療・福祉', '医療職、介護、こころの支援'],
    ['食・料理', '調理、製菓、食品衛生、お酒'],
    ['動物・自然', 'ペット、園芸、環境、気象'],
    ['理科・数学', '数学、統計、宇宙、生きもの'],
    ['歴史・地理', '歴史、地理、世界遺産'],
    ['ご当地', '地域や街のことを知るご当地検定'],
    ['デザイン・美術', '色彩、CG、写真、インテリア'],
    ['音楽・芸能', '音楽、演劇、アニメ'],
    ['服飾・美容', 'ファッション、美容、着付け'],
    ['スポーツ', '指導者・審判・トレーニングの資格'],
    ['趣味・カルチャー', '暮らしのたのしみを深めるもの'],
    ['公務員・教育', '公務員試験、教員、保育'],
    ['適性検査', '就職活動で使われる能力検査'],
  ];

  const TRAINING_LABEL = {
    professional: '専門実践',
    specific: '特定一般',
    general: '一般',
    yes: '給付対象',
    none: '対象なし',
  };

  /** 厚生労働省の講座検索は POST でしか動かないので、その場でフォームを作って投げる。 */
  const KYUFU_ENDPOINT = 'https://www.kyufu.mhlw.go.jp/kensaku/SSR101Scr01S';

  const $ = (sel) => document.querySelector(sel);

  const el = {
    search: $('#search'),
    onlyTraining: $('#onlyTraining'),
    chips: $('#chips'),
    sections: $('#sections'),
    count: $('#count'),
    empty: $('#empty'),
    pickup: $('#pickup'),
    toast: $('#toast'),
    randomBtn: $('#randomBtn'),
    toggleAll: $('#toggleAll'),
  };

  /** 分野の絞り込み。'' はすべて。 */
  let activeCategory = '';
  /** 分野ごとの <details> と、中身をもう作ったかどうか。 */
  const sectionMap = new Map();
  /** マイリストに入っている名前。追加済みの表示に使う。 */
  let myNames = new Set();

  // ---------- 検索用のゆらぎ吸収 ----------

  /** 全角英数→半角、カタカナ→ひらがな、小文字化。app.js と同じ考え方。 */
  function foldText(str) {
    return String(str)
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
      .replace(/[\s　・（）()]/g, '')
      .toLowerCase();
  }

  const index = PRESETS.map((p) => ({
    preset: p,
    haystack: [p.name, p.short, p.alias, p.category, p.memo].map((v) => foldText(v ?? '')).join(' '),
  }));

  /** 空白区切りの語をすべて含むものを拾う。件数は絞らない（眺めるページなので）。 */
  function matches(query) {
    const tokens = String(query).split(/[\s　]+/).map(foldText).filter(Boolean);
    if (!tokens.length) return PRESETS;
    return index.filter((e) => tokens.every((t) => e.haystack.includes(t))).map((e) => e.preset);
  }

  // ---------- マイリストへの追加 ----------

  function readItems() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.error('保存データの読み込みに失敗しました', err);
      return [];
    }
  }

  function refreshMyNames() {
    myNames = new Set(readItems().map((it) => String(it?.name ?? '')));
  }

  function newId() {
    return (crypto.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  }

  /** index.html 側の normalize と同じ形に揃えて保存する。 */
  function addToList(preset) {
    const list = readItems();
    if (list.some((it) => String(it?.name ?? '') === preset.name)) {
      toast('すでにマイリストにあります');
      return false;
    }
    const now = Date.now();
    list.push({
      id: newId(),
      name: preset.name,
      short: preset.short ?? '',
      category: preset.category ?? '',
      priority: 'mid',
      status: 'planning',
      scoreType: preset.scoreType === 'pass' ? 'pass' : 'score',
      targetScore: preset.targetScore ?? null,
      maxScore: preset.maxScore ?? null,
      scoreUnit: preset.scoreUnit ?? '点',
      examDate: '',
      fee: preset.fee ?? null,
      url: preset.url ?? '',
      memo: preset.memo ?? '',
      training: preset.training ?? '',
      attempts: [],
      createdAt: now,
      updatedAt: now,
    });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (err) {
      console.error('保存に失敗しました', err);
      toast('保存に失敗しました（保存容量が上限の可能性があります）');
      return false;
    }
    myNames.add(preset.name);
    toast(`「${preset.name}」をマイリストに追加しました`);
    return true;
  }

  // ---------- 給付金検索 ----------

  /**
   * 厚労省の検索は空白を区切りとして扱うため、「世界遺産検定 2級」で投げると
   * 「2級」に引っかかる講座まで拾ってしまう。括弧と級・種別を落として最初の語だけで引く。
   */
  function trainingKeyword(name) {
    let k = String(name).replace(/[（(][^）)]*[）)]/g, ' ');
    k = k.replace(/[\s　]*(準?[0-9０-９]+級|[甲乙丙]種[^\s　]*|第[一二三四五六七八九十]+種[^\s　]*)$/, ' ');
    k = k.replace(/[\s　]+/g, ' ').trim();
    return k.split(' ')[0] || String(name);
  }

  function openTrainingSearch(keyword) {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = KYUFU_ENDPOINT;
    form.target = '_blank';
    form.rel = 'noopener';
    form.hidden = true;

    const add = (name, value) => {
      const i = document.createElement('input');
      i.type = 'hidden';
      i.name = name;
      i.value = value;
      form.append(i);
    };
    add('keyword', keyword);
    add('searchCond', '');
    // 通学（昼/夜/土日）・通信・eラーニングを全部対象にする
    for (const m of ['1', '2', '3', '4', '5']) add('implementalMethods', m);

    document.body.append(form);
    form.submit();
    form.remove();
  }

  // ---------- 1件分の見た目 ----------

  function metaLine(p) {
    const parts = [];
    if (p.scoreType === 'pass') {
      parts.push('合否で判定');
    } else if (p.targetScore != null) {
      const unit = p.scoreUnit ?? '';
      parts.push(`目安 ${p.targetScore}${unit}${p.maxScore != null ? ` / ${p.maxScore}${unit}` : ''}`);
    }
    if (p.fee != null) parts.push(`受験料 ${Number(p.fee).toLocaleString('ja-JP')}円`);
    return parts.join(' · ');
  }

  function itemNode(p) {
    const li = document.createElement('li');
    li.className = 'b-item';

    const head = document.createElement('div');
    head.className = 'b-head';

    const name = document.createElement('p');
    name.className = 'b-name';
    name.textContent = p.name;
    head.append(name);

    if (p.training && TRAINING_LABEL[p.training]) {
      const badge = document.createElement('span');
      badge.className = `badge training-${p.training}`;
      badge.textContent = TRAINING_LABEL[p.training];
      badge.title = p.training === 'none'
        ? '確認した時点では教育訓練給付の対象講座が見つかりませんでした'
        : '教育訓練給付（厚生労働省）の対象講座があります';
      head.append(badge);
    }
    li.append(head);

    const meta = metaLine(p);
    if (meta) {
      const m = document.createElement('p');
      m.className = 'b-meta';
      m.textContent = meta;
      li.append(m);
    }

    if (p.memo) {
      const memo = document.createElement('p');
      memo.className = 'b-memo';
      memo.textContent = p.memo;
      li.append(memo);
    }

    const actions = document.createElement('div');
    actions.className = 'b-actions';

    if (p.url) {
      const a = document.createElement('a');
      a.className = 'btn';
      a.href = p.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = '公式サイト';
      actions.append(a);
    }

    if (p.training && p.training !== 'none') {
      const k = document.createElement('button');
      k.type = 'button';
      k.className = 'btn btn-training';
      k.textContent = '給付金の講座';
      k.addEventListener('click', () => openTrainingSearch(trainingKeyword(p.name)));
      actions.append(k);
    }

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn-primary';
    const already = myNames.has(p.name);
    addBtn.textContent = already ? '追加済み' : '＋ 追加';
    addBtn.disabled = already;
    addBtn.addEventListener('click', () => {
      if (!addToList(p)) return;
      addBtn.textContent = '追加済み';
      addBtn.disabled = true;
    });
    actions.append(addBtn);

    li.append(actions);
    return li;
  }

  // ---------- 分野ごとのセクション ----------

  function loadOpenState() {
    try {
      const raw = localStorage.getItem(OPEN_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch {
      return new Set();
    }
  }

  function saveOpenState() {
    const open = [...sectionMap.entries()].filter(([, s]) => s.details.open).map(([cat]) => cat);
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(open));
    } catch { /* 保存できなくても表示には困らないので黙って諦める */ }
  }

  /** presets.js に実在するカテゴリを、CATEGORIES の順で並べる。 */
  function orderedCategories() {
    const found = new Set(PRESETS.map((p) => p.category || 'その他'));
    const known = CATEGORIES.filter(([c]) => found.has(c));
    const knownNames = new Set(known.map(([c]) => c));
    const rest = [...found].filter((c) => !knownNames.has(c)).sort((a, b) => a.localeCompare(b, 'ja'));
    return [...known, ...rest.map((c) => [c, ''])];
  }

  function buildSections() {
    const openState = loadOpenState();
    const frag = document.createDocumentFragment();

    for (const [cat, hint] of orderedCategories()) {
      const details = document.createElement('details');
      details.className = 'b-section';
      details.open = openState.has(cat);

      const summary = document.createElement('summary');
      summary.className = 'b-summary';

      const title = document.createElement('span');
      title.className = 'b-cat';
      title.textContent = cat;

      const count = document.createElement('span');
      count.className = 'b-count';

      summary.append(title, count);
      if (hint) {
        const h = document.createElement('span');
        h.className = 'b-hint';
        h.textContent = hint;
        summary.append(h);
      }

      const ul = document.createElement('ul');
      ul.className = 'b-list';

      details.append(summary, ul);
      details.addEventListener('toggle', () => {
        if (details.open) fillSection(cat);
        saveOpenState();
        syncToggleAllLabel();
      });

      sectionMap.set(cat, { details, ul, count, list: [], filled: false });
      frag.append(details);
    }

    el.sections.replaceChildren(frag);
  }

  /** 開かれたときに初めて中身を作る。1400件を一度に組み立てると重いため。 */
  function fillSection(cat) {
    const s = sectionMap.get(cat);
    if (!s || s.filled) return;
    const frag = document.createDocumentFragment();
    for (const p of s.list) frag.append(itemNode(p));
    s.ul.replaceChildren(frag);
    s.filled = true;
  }

  // ---------- 絞り込みの反映 ----------

  function apply() {
    const query = el.search.value.trim();
    const onlyTraining = el.onlyTraining.checked;

    let hits = matches(query);
    if (onlyTraining) hits = hits.filter((p) => p.training && p.training !== 'none');
    if (activeCategory) hits = hits.filter((p) => (p.category || 'その他') === activeCategory);

    const byCat = new Map();
    for (const p of hits) {
      const c = p.category || 'その他';
      if (!byCat.has(c)) byCat.set(c, []);
      byCat.get(c).push(p);
    }

    // 検索や給付金の絞り込みが効いているときは、結果が畳まれたままだと気づけないので自動で開く。
    const narrowed = Boolean(query) || onlyTraining;

    for (const [cat, s] of sectionMap) {
      const list = byCat.get(cat) ?? [];
      // 中身が変わるので、作り直しの対象に戻す。
      s.list = list;
      s.filled = false;
      s.ul.replaceChildren();
      s.count.textContent = `${list.length}件`;
      s.details.hidden = list.length === 0;
      if (narrowed && list.length) s.details.open = true;
      if (s.details.open && !s.details.hidden) fillSection(cat);
    }

    el.count.textContent = narrowed || activeCategory
      ? `${hits.length}件が該当（全${PRESETS.length}件中）`
      : `全${PRESETS.length}件を${sectionMap.size}の分野に分けて掲載しています`;
    el.empty.hidden = hits.length > 0;
    syncToggleAllLabel();
  }

  function syncToggleAllLabel() {
    const visible = [...sectionMap.values()].filter((s) => !s.details.hidden);
    const allOpen = visible.length > 0 && visible.every((s) => s.details.open);
    el.toggleAll.textContent = allOpen ? 'すべて閉じる' : 'すべて開く';
    el.toggleAll.setAttribute('aria-pressed', String(allOpen));
  }

  // ---------- 分野チップ ----------

  function buildChips() {
    const frag = document.createDocumentFragment();
    const all = document.createElement('button');
    all.type = 'button';
    all.className = 'chip is-on';
    all.dataset.cat = '';
    all.textContent = 'すべて';
    frag.append(all);

    for (const [cat] of orderedCategories()) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.cat = cat;
      b.textContent = cat;
      frag.append(b);
    }
    el.chips.replaceChildren(frag);

    el.chips.addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      activeCategory = btn.dataset.cat;
      for (const c of el.chips.querySelectorAll('.chip')) {
        c.classList.toggle('is-on', c === btn);
      }
      // 分野をひとつ選んだときは、そのまま中身が見えたほうが早い。
      if (activeCategory) {
        const s = sectionMap.get(activeCategory);
        if (s) s.details.open = true;
      }
      apply();
    });
  }

  // ---------- ランダム表示 ----------

  function showRandom() {
    const pool = PRESETS.slice();
    const picked = [];
    for (let i = 0; i < 10 && pool.length; i++) {
      picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }

    const h = document.createElement('h2');
    h.className = 'pickup-title';
    h.textContent = '🎲 ランダムに選んでみました';

    const ul = document.createElement('ul');
    ul.className = 'b-list';
    for (const p of picked) {
      const li = itemNode(p);
      const tag = document.createElement('span');
      tag.className = 'b-tag';
      tag.textContent = p.category || 'その他';
      li.querySelector('.b-head').append(tag);
      ul.append(li);
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn pickup-close';
    close.textContent = '閉じる';
    close.addEventListener('click', () => { el.pickup.hidden = true; });

    el.pickup.replaceChildren(h, ul, close);
    el.pickup.hidden = false;
  }

  // ---------- こまごま ----------

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

  function debounce(fn, ms) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function bind() {
    $('#themeToggle').addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem(THEME_KEY, next);
      applyTheme(next);
    });

    el.search.addEventListener('input', debounce(apply, 160));
    el.onlyTraining.addEventListener('change', apply);
    el.randomBtn.addEventListener('click', showRandom);

    el.toggleAll.addEventListener('click', () => {
      const visible = [...sectionMap.values()].filter((s) => !s.details.hidden);
      const open = !(visible.length > 0 && visible.every((s) => s.details.open));
      for (const s of visible) s.details.open = open;
      saveOpenState();
      syncToggleAllLabel();
    });

    // 別のタブでマイリストを触ったときに「追加済み」の表示を合わせる。
    window.addEventListener('storage', (e) => {
      if (e.key !== STORAGE_KEY) return;
      refreshMyNames();
      apply();
    });
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((err) => {
        console.warn('Service Worker の登録に失敗しました', err);
      });
    });
  }

  initTheme();
  refreshMyNames();
  buildChips();
  buildSections();
  bind();
  apply();
  registerServiceWorker();
})();
