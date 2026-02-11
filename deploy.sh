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

    info "バックエンドをコピー..."
    mkdir -p "$LOCAL_DIR/backend"
    cp -r backend/api "$LOCAL_DIR/backend/"
    cp -r backend/vendor "$LOCAL_DIR/backend/"
    cp backend/composer.json "$LOCAL_DIR/backend/"
    cp backend/composer.lock "$LOCAL_DIR/backend/"
    cp backend/schema.sql "$LOCAL_DIR/backend/"
    mkdir -p "$LOCAL_DIR/backend/uploads"
    touch "$LOCAL_DIR/backend/uploads/.gitkeep"

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
    # config.php と uploads/ はサーバー側のみに存在するので除外
    rsync -avz --delete \
        --exclude '.DS_Store' \
        --exclude 'backend/api/config.php' \
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
