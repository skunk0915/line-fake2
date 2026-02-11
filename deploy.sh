#!/bin/bash

# ============================================
# deploy.sh - ビルド＆デプロイ一括スクリプト
# 使い方:
#   ./deploy.sh          → フルビルド＆アップロード
#   ./deploy.sh --upload → ビルドせずアップロードのみ
#   ./deploy.sh --build  → ビルドのみ（アップロードしない）
# ============================================

set -e

# サーバー設定
SERVER_HOST="mizy.sakura.ne.jp"
SERVER_USER="mizy"
REMOTE_PATH="/home/mizy/www/line-fake2"
LOCAL_DIR="dist_server"

# 色付き出力
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# --- ビルド ---
do_build() {
    info "dist_server をクリーン..."
    rm -rf "$LOCAL_DIR"
    mkdir -p "$LOCAL_DIR"

    info "フロントエンドをビルド中..."
    cd frontend
    npm install --silent
    npm run build
    cd ..

    info "ビルド成果物をコピー..."
    cp -r frontend/dist/* "$LOCAL_DIR/"

    info ".htaccess をコピー..."
    cp .htaccess "$LOCAL_DIR/"

    info "バックエンドを同期..."
    # backend ディレクトリ全体を同期
    mkdir -p "$LOCAL_DIR/backend"
    rsync -av --exclude 'uploads/*' --exclude 'node_modules' backend/ "$LOCAL_DIR/backend/"
    mkdir -p "$LOCAL_DIR/backend/uploads"
    touch "$LOCAL_DIR/backend/uploads/.gitkeep"

    if [ -d "notification-server" ]; then
        info "通知サーバーを同期..."
        mkdir -p "$LOCAL_DIR/notification-server"
        rsync -av --exclude 'node_modules' --exclude '.env' notification-server/ "$LOCAL_DIR/notification-server/"
    fi

    info "ビルド完了！"
}

# --- アップロード ---
do_upload() {
    if [ ! -d "$LOCAL_DIR" ]; then
        error "dist_server が存在しません。先にビルドしてください: ./deploy.sh --build"
    fi

    info "サーバーにアップロード中..."
    info "  ローカル:  ./$LOCAL_DIR/"
    info "  リモート:  $SERVER_USER@$SERVER_HOST:$REMOTE_PATH/"

    # rsync で同期（--delete で古いファイルも削除）
    # uploads/ はサーバー側のみに存在するので除外
    rsync -avz --delete \
        --exclude '.DS_Store' \
        --exclude 'backend/uploads/*' \
        --exclude '!backend/uploads/.gitkeep' \
        "$LOCAL_DIR/" \
        "$SERVER_USER@$SERVER_HOST:$REMOTE_PATH/"

    info "アップロード完了！"
    info "URL: https://$SERVER_HOST/line-fake2/"
}

# --- メイン ---
case "${1:-}" in
    --upload)
        do_upload
        ;;
    --build)
        do_build
        ;;
    *)
        do_build
        do_upload
        ;;
esac
