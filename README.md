# LINE風チャットアプリ構築手順

このプロジェクトは、フロントエンド(React)、バックエンド(PHP+MySQL on Sakura)、通知サーバー(Node.js on Render)で構成されています。

## 1. 準備

### Google Cloud Console
1. 新しいプロジェクトを作成し、**OAuth 2.0 クライアントID** を作成します。
2. アプリケーションの種類: **Webアプリケーション**
3. 承認済みのJavaScript生成元: `http://localhost:5173` (開発用), `https://mizy.sakura.ne.jp` (本番用)
   ※ディレクトリパス (`/line-fake2/`) は含めず、ドメインのみ入力してください。

### VAPIDキーの生成 (Web Push用)
ターミナルで以下を実行し、生成されたキーを控えてください。
```bash
cd notification-server
npm install
npx web-push generate-vapid-keys
```
これらは `.env` 設定で使用します。

## 2. データベース (MySQL - さくらサーバー)
1. さくらサーバーのコントロールパネルからMySQLデータベースを作成します。
2. phpMyAdmin等を使用し、`backend/schema.sql` の内容をインポートしてください。

## 3. バックエンド (PHP)
1. `backend/api/config.php` を開き、DB接続情報やGoogle Client ID、Render URLを設定してください。
   - `RENDER_URL` は後述のRenderデプロイ後のURL (例: https://chat-notify.onrender.com) です。
2. `backend/api` ディレクトリの中身を、さくらサーバーの公開ディレクトリ (例: `public_html/api`) にアップロードします。
3. `backend/uploads` フォルダを `public_html` 直下に作成し、**書き込み権限 (755または777)** を与えてください。

## 4. 通知サーバー (Render.com)
1. [Render.com](https://render.com) でアカウント作成。
2. `New Web Service` から、このリポジトリの `notification-server` ディレクトリをデプロイ対象にするか、手動でコードを配置します。
   - GitHub連携する場合は、Root Directoryに `notification-server` を指定。
3. **Environment Variables** (環境変数) を設定:
   - `VAPID_PUBLIC_KEY`: (手順1で生成した公開鍵)
   - `VAPID_PRIVATE_KEY`: (手順1で生成した秘密鍵)
   - `VAPID_EMAIL`: mailto:your-email@example.com
4. デプロイ後のURLをメモし、PHP側の `config.php` とフロントエンドの `.env` に設定します。

## 5. フロントエンド (React)
1. `frontend/.env.example` をコピーして `frontend/.env` を作成します。
   ```bash
   VITE_GOOGLE_CLIENT_ID=あなたのGoogleクライアントID
   VITE_API_URL=https://あなたのドメイン/api
   VITE_SOCKET_URL=https://あなたのRenderアプリURL
   VITE_VAPID_PUBLIC_KEY=手順1で生成した公開鍵
    ```
   ※本番環境のURLは `vite.config.js` の `base` 設定と合わせてください。
   
d. ビルド設定 (`vite.config.js`)
   サブディレクトリ運用 (`/line-fake2/`) のため、`base: '/line-fake2/'` が設定されています。

2. ビルドします。
   ```bash
   cd frontend
   npm install
   npm run build
   ```
3. `frontend/dist` フォルダの中身すべてを、さくらサーバーの `public_html` (または任意のサブディレクトリ) にアップロードします。

## 構成図
[User Browser] 
   | (HTTP / Socket.io)
   v
[Frontend (React)] <--(Web Push)--- [Browser Service Worker]
   | (API Call)
   v
[Backend (PHP on Sakura)] --(SQL)--> [MySQL]
   | (Webhook)
   v
[Notification Server (Node on Render)] --(Socket/Push API)--> [Google FCM] --> [User]
