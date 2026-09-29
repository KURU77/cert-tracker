/* 資格の「更新」の情報を表示用の言葉にする。マイリストと資格ずかんで共用。
 *
 * プリセット側の項目
 *   renew      'none' | 'required' | 'member' | 'expiry' | 'na'（無ければ未調査）
 *   renewYears 周期（年）。1なら毎年
 *   renewFee   1回あたりの費用の目安（円）。0は無料
 *   renewNote  何をすれば更新できるかの説明
 */
(() => {
  'use strict';

  const KINDS = {
    none:     { label: '更新不要', cls: 'renew-none', hint: '一度合格すれば生涯有効' },
    required: { label: '更新あり', cls: 'renew-required', hint: '講習・研修・再受験などの更新が必要' },
    member:   { label: '会費制', cls: 'renew-member', hint: '団体への登録・年会費で資格を維持する' },
    expiry:   { label: '有効期限あり', cls: 'renew-expiry', hint: '成績に有効期限がある（更新制度はなく再受験）' },
    na:       { label: '対象外', cls: 'renew-na', hint: '採用試験や適性検査など、更新という考え方がないもの' },
  };

  const yen = (n) => `${Number(n).toLocaleString('ja-JP')}円`;

  /** 「5年ごと・約16,500円」のような短い説明。更新が要らないものは空文字。 */
  function cycle(p) {
    if (!p || (p.renew !== 'required' && p.renew !== 'member' && p.renew !== 'expiry')) return '';
    const parts = [];
    const y = Number(p.renewYears);
    if (p.renew === 'expiry') {
      if (y) parts.push(`有効期限${y}年`);
    } else if (y === 1) {
      parts.push(p.renew === 'member' ? '毎年の会費' : '毎年');
    } else if (y) {
      parts.push(`${y}年ごと`);
    }
    if (p.renewFee === 0) parts.push('無料');
    else if (p.renewFee != null) parts.push(`約${yen(p.renewFee)}`);
    return parts.join('・');
  }

  /** バッジ用。{ text, cls, title } を返す。未調査なら null。 */
  function badge(p) {
    const k = KINDS[p?.renew];
    if (!k) return null;
    const c = cycle(p);
    return {
      text: c ? `${k.label}（${c}）` : k.label,
      cls: k.cls,
      title: p.renewNote || k.hint,
    };
  }

  /** 一覧の絞り込みに使う大きな区分。 */
  function group(p) {
    if (!p?.renew) return 'unknown';
    if (p.renew === 'required' || p.renew === 'member') return 'keep';
    return 'free';
  }

  window.CertRenewal = { KINDS, cycle, badge, group };
})();
