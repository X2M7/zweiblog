#!/bin/sh
set -eu

echo "============================================="
echo "欢迎使用 ZweiBlog 博客系统"
echo "GitHub: https://github.com/X2M7/zweiblog"
echo "Version(Env): ${ZWEI_BLOG_VERSION}"
echo "============================================="

# New deployment files always set this explicitly. Older installer-generated
# Compose files only supplied EMAIL; keep those HTTPS sites reachable for one
# compatibility cycle while directing operators to migrate to an explicit mode.
if [ -z "${ZWEI_BLOG_CADDY_HTTPS:-}" ]; then
  if [ -z "${EMAIL:-}" ]; then
    ZWEI_BLOG_CADDY_HTTPS=off
  elif printf '%s' "${EMAIL}" | grep -Eq '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'; then
    ZWEI_BLOG_CADDY_HTTPS=on-demand
    echo >&2 'WARNING: inferred on-demand HTTPS from legacy EMAIL; set ZWEI_BLOG_CADDY_HTTPS explicitly.'
  else
    echo >&2 'ERROR: legacy EMAIL is invalid; set ZWEI_BLOG_CADDY_HTTPS=off or on-demand explicitly.'
    exit 1
  fi
  export ZWEI_BLOG_CADDY_HTTPS
fi

node /app/render-caddy-config.js /app/caddyTemplate.json /app/caddy.json
caddy start --config /app/caddy.json

exec node start.js
