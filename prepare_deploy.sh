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
cp -r backend/api dist_server/backend/
cp -r backend/vendor dist_server/backend/
cp backend/composer.json dist_server/backend/
cp backend/composer.lock dist_server/backend/
cp backend/schema.sql dist_server/backend/

# Ensure uploads directory exists and has permissions (handled on server side usually)
mkdir -p dist_server/backend/uploads
touch dist_server/backend/uploads/.gitkeep

echo "Done! Upload the contents of 'dist_server' to your server's public_html/line-fake2 directory."
