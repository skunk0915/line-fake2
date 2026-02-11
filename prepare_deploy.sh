#!/bin/bash

# Clean up previous build
rm -rf dist_server
mkdir -p dist_server

# Build Frontend
echo "Building Frontend..."
cd frontend
npm install
npm run build
cd ..

# Copy Frontend files to root of dist_server (index.html, assets, etc.)
cp -r frontend/dist/* dist_server/

# Copy .htaccess
cp .htaccess dist_server/

# Copy Backend to dist_server/backend
mkdir -p dist_server/backend
rsync -av --exclude 'api/config.php' --exclude 'uploads/*' --exclude 'node_modules' backend/ dist_server/backend/

# Copy Notification Server if exists
if [ -d "notification-server" ]; then
    mkdir -p dist_server/notification-server
    rsync -av --exclude 'node_modules' --exclude '.env' notification-server/ dist_server/notification-server/
fi

# Ensure uploads directory exists
mkdir -p dist_server/backend/uploads
touch dist_server/backend/uploads/.gitkeep

echo "Done! Upload the contents of 'dist_server' to your server's public_html/line-fake2 directory."
