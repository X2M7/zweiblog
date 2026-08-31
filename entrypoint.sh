#!/bin/sh
set -eu

echo "============================================="
echo "欢迎使用 ZweiBlog 博客系统"
echo "GitHub: https://github.com/X2M7/zweiblog"
echo "Version(Env): ${ZWEI_BLOG_VERSION}"
echo "============================================="

node /app/render-caddy-config.js /app/caddyTemplate.json /app/caddy.json
caddy start --config /app/caddy.json

exec node start.js
