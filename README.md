# eスポーツ大会運営 AI補助ツール（Chrome拡張）

Discordウェブ版の問い合わせ対応をAIで補助するChrome拡張機能（スタッフ専用）。

## セットアップ手順

### 1. Google OAuth クライアントIDの設定

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成
2. 「APIとサービス」→「認証情報」→「OAuthクライアントID」を作成
3. アプリの種類: **Chrome拡張機能**
4. 拡張機能のID（後述）を設定
5. `manifest.json` の `oauth2.client_id` に取得したクライアントIDを記載

有効にするAPIスコープ:
- Google Drive API（読み取り専用）
- Google Docs API

### 2. Chromeに拡張機能を読み込む

1. Chromeで `chrome://extensions` を開く
2. 右上の「デベロッパーモード」をONにする
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. このフォルダを選択する
5. 拡張機能のIDをコピーして Google Cloud ConsoleのOAuth設定に追加

### 3. 初期設定

1. Discord（discord.com）を開く
2. ツールバーの拡張機能アイコンをクリックしてサイドパネルを開く
3. ⚙️ 設定タブで以下を設定:
   - Gemini APIキーを入力・保存
   - Google DriveのFAQ文書URLを登録・「Google Driveと連携」ボタンで認証
   - 言葉遣い・返答スタイルを設定

## 使い方

### 返答生成タブ

| 操作 | 説明 |
|------|------|
| メッセージ取得 | 開いているDiscordチャンネルの直近メッセージを取得 |
| クリック選択モード | Discordページ上でメッセージをクリック選択 |
| ペーストモード | メッセージを手動でコピー&ペースト |
| AIで返答案を生成 | Gemini APIに送信して返答案を作成 |
| コピー | 返答案をクリップボードにコピー |

### 機能一覧（要件定義 v2.0対応）

- **F-01** DOMからメッセージ取得
- **F-02** クリックによるメッセージ選択（複数選択対応）
- **F-03** 手動ペースト入力モード
- **F-04** Google Drive FAQ文書読み込み（OAuth2・複数文書対応）
- **F-05** Gemini API返答生成（1.5 Flash / 1.5 Pro / 2.0 Flash）
- **F-06** 言葉遣い設定（プリセット4種＋カスタム指示）
- **F-07** 返答長さ調整（短め／ふつう／詳しく）
- **F-08** 返答案表示・編集・コピー
- **F-09** 根拠FAQ表示（ON/OFF切替）
- **F-10** セッション内返答履歴
- **F-11** 過去チャット参照（最大100件）
- **F-12** FAQ文書URL管理（登録・削除・再読込）
- **F-13** APIキー管理（chrome.storage.session暗号化保存）

## セキュリティ

- APIキーは `chrome.storage.session`（暗号化領域）に保存、コードへの直書き禁止
- 会話ログはセッション内メモリのみ（永続保存なし）
- Google DriveはOAuth2で読み取り権限のみ
- Chrome拡張パーミッション: `activeTab`, `storage`, `identity`, `sidePanel`
- 通信はすべてHTTPS

## ファイル構成

```
├── manifest.json          # 拡張機能マニフェスト（MV3）
├── background.js          # Service Worker（API通信・ストレージ管理）
├── content.js             # Content Script（Discord DOM解析・選択UI）
├── sidepanel/
│   ├── sidepanel.html     # サイドパネルUI（3タブ構成）
│   ├── sidepanel.js       # サイドパネルロジック
│   └── sidepanel.css      # スタイル
└── icons/                 # 拡張機能アイコン
```

## 注意事項

- Discord Bot・Discord APIは一切使用しません
- AIが自動でDiscordにメッセージを送信する機能はありません（送信は必ずスタッフの手動操作）
- 表示済みDOMの読み取りのみ行います（非公式APIスクレイピングなし）
- 参加者はこのツールを使用できません（スタッフ専用）