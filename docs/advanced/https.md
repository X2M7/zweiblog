---
title: HTTPS
icon: certificate
order: 1
---

ZweiBlog 镜像内的 Caddy 始终负责内部路径路由，但容器内 TLS 是可选功能。默认部署由宿主机反向代理管理域名和证书。

<!-- more -->

## 默认：外部反向代理

基础 Compose 只把 HTTP 上游绑定到 `127.0.0.1:8080`，容器内 Caddy 不监听 443、不申请证书。宿主机 Nginx、Caddy 或其他代理负责：

- 公网 80/443 监听与证书续期；
- HTTP 到 HTTPS 跳转；
- 把整个站点转发到 `http://127.0.0.1:8080`；
- 设置可信的真实访客 IP 请求头。

该模式不要叠加 `docker-compose.https.yml`。后台的内置 HTTPS 申请、重定向控件在此模式下不可用，证书和跳转应在外层代理配置。完整示例见根目录 README 的 [反向代理部署](https://github.com/X2M7/zweiblog#反向代理部署)。

## 可选：直接使用内置 Caddy

只有服务器没有其他 Web 服务，并且 ZweiBlog 可以独占公网 80/443 时，才建议启用此模式。

使用仓库 Compose 部署时，在 `.env` 中设置公网绑定和 `ACME_EMAIL`，然后显式叠加 HTTPS 覆盖文件：

```bash
sudo docker compose \
  -f docker-compose.yml \
  -f docker-compose.https.yml \
  up -d
```

使用 `zweiblog.sh` 新安装时，则在安装提示中选择“直接使用 ZweiBlog 内置 Caddy”，脚本会生成包含 `ZWEI_BLOG_CADDY_HTTPS=on-demand` 的单一 Compose 文件，不需要额外 overlay。

启用前确认：

- 域名 A/AAAA 记录已指向服务器；
- 公网 80/443 均可达且没有被其他进程占用；
- 已提供有效的 ACME 邮箱；
- 初始化时把站点 URL 填为最终的 `https://` 域名。

先通过 HTTP 完成初始化，再在后台的 Caddy/HTTPS 设置中触发当前站点域名的证书申请。只有站点 URL 中已经配置的域名可以申请；IP 地址不能用于公开 HTTPS 证书。

::: warning 保持 Compose 模式一致

仓库 Compose 一旦启用 HTTPS overlay，后续启动、重建、备份恢复和升级时都必须继续带上 `-f docker-compose.yml -f docker-compose.https.yml`。单独执行 `docker compose up -d` 会恢复默认外部反代模式，关闭容器内 TLS 并移除 443。

:::

## HTTPS 自动重定向

仅在内置 HTTPS 模式下，并确认域名证书已经正常工作后，才在后台开启 HTTP 自动跳转。外部反代模式应在外层 Nginx/Caddy 配置跳转。

## 排查

- `docker compose ps`：确认容器健康；
- `docker compose logs --tail=200 zweiblog`：查看整体启动日志；
- `/var/log/caddy.log`：Caddy 运行日志；
- `/var/log/zweiblog-access.log`：访问日志。

分享日志前必须移除令牌、Cookie、邮箱、IP 和其他隐私信息。当前部署命令和故障处理始终以仓库根目录 [README](https://github.com/X2M7/zweiblog#readme) 为准。
