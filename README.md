# 🎓 資格・検定トラッカー

取りたい資格や検定をリスト化し、**目標スコア**と**受験記録**を管理できる Web アプリです。

インストール不要・ビルド不要。HTML / CSS / JavaScript だけで動きます。

👉 **[デモを開く](https://KURU77.github.io/cert-tracker/)**

---

## できること

| 機能 | 説明 |
| --- | --- |
| 資格リスト | 資格・検定名、カテゴリ、優先度、ステータス（検討中／勉強中／申込済／合格／不合格）を登録 |
| 目標スコア | 目標スコア・満点・単位（点／級／% など）を設定。合否のみの資格にも対応 |
| 受験記録 | 受験日ごとにスコアと合否を記録。最高スコアと目標達成率が自動で計算されます |
| 進捗バー | 「現在の最高スコア ÷ 目標スコア」を可視化。目標到達で緑色に変化 |
| 試験日カウントダウン | 試験予定日までの残り日数を表示。30日以内は強調表示 |
| 検索・絞り込み・並び替え | 資格名／メモの検索、ステータス・カテゴリでの絞り込み、優先度・試験日・達成率などで並び替え |
| 受験料メモ | 受験料や公式サイトURLも記録できます |
| バックアップ | JSON での書き出し／読み込みに対応。端末の乗り換えもかんたん |
| ダークモード | システム設定に追従。ボタンで手動切り替えも可能 |

## データの保存場所

入力したデータは**ブラウザの localStorage にのみ**保存されます。サーバーへの送信は一切ありません。

- 同じブラウザ・同じ端末でのみデータが見えます
- ブラウザのデータを消去すると、登録内容も消えます
- 別の端末に移すときは、メニュー（⋯）から「JSONで書き出し」→ 移行先で「JSONを読み込み」

## 使い方

### そのままブラウザで使う

[デモページ](https://KURU77.github.io/cert-tracker/)を開くだけです。ブックマークしておけば次回もデータが残ります。

### ローカルで動かす

```bash
git clone https://github.com/KURU77/cert-tracker.git
```

クローンした `index.html` をブラウザで開けば動きます。ローカルサーバーを使う場合は次のいずれかで。

```bash
python -m http.server 8000
```

```bash
npx serve
```

## ファイル構成

```
cert-tracker/
├── index.html      # 画面のマークアップ（フォームは <dialog> で実装）
├── css/style.css   # CSS カスタムプロパティによるライト／ダークテーマ
└── js/app.js       # 状態管理・描画・localStorage 永続化
```

依存ライブラリはありません。すべて素の HTML / CSS / JavaScript です。

## データ形式

書き出される JSON は、次のオブジェクトの配列です。

```json
[
  {
    "id": "…",
    "name": "TOEIC L&R",
    "category": "語学",
    "priority": "high",
    "status": "studying",
    "scoreType": "score",
    "targetScore": 800,
    "maxScore": 990,
    "scoreUnit": "点",
    "examDate": "2026-09-13",
    "fee": 7810,
    "url": "https://www.iibc-global.org/toeic.html",
    "memo": "公式問題集を1冊ずつ。",
    "attempts": [
      { "id": "…", "date": "2026-06-21", "score": 745, "result": "", "note": "Part5が課題" }
    ],
    "createdAt": 1770000000000,
    "updatedAt": 1770000000000
  }
]
```

`scoreType` は `score`（スコアで評価）または `pass`（合否のみ）。`result` は `passed` / `failed` / 空文字です。

## ブラウザ対応

`<dialog>`、`replaceChildren`、`color-mix()` を使っています。Chrome / Edge / Firefox / Safari の最近のバージョンで動作します。

## ライセンス

MIT
