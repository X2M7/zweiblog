#!/bin/sh
echo "============================================="
echo "欢迎使用 ZweiBlog 博客系统"
echo "Github: https://github.com/mereithhh/vanblog"
echo "Version(Env): ${ZWEI_BLOG_VERSION}"
echo "============================================="


sed "s/ZWEI_BLOG_EMAIL/${EMAIL}/g" /app/caddyTemplate.json >/app/caddy.json
caddy start --config /app/caddy.json

node start.js
