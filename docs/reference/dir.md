---
title: 目录映射
icon: folder-tree
order: 3
---

为了持久化配置，ZweiBlog 会将相关数据存储至相应文件夹。如果你在使用 Docker 之类的容器服务，你需要映射相关目录以确保更新镜像后相关文件不会丢失。

| 容器内目录 | 说明 |
| --- | --- |
| `/app/static` | 图床中数据的存放路径，使用内置图床请务必映射好！ |
| `/var/log` | 日志的存放路径，包括 access 日志、 Caddy 日志和前台服务日志 |
| `/home/zweiblog/.config/caddy` | Caddy 配置和运行状态；官方 Compose 已持久化映射 |
| `/home/zweiblog/.local/share/caddy` | 内置 HTTPS 的证书数据；官方 Compose 已持久化映射 |
