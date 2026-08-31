---
title: 反代
icon: refresh
order: 4
---

ZweiBlog 默认把 `127.0.0.1:8080` 作为宿主机反向代理的 HTTP 上游。容器内 Caddy 仍负责 `/admin`、`/api`、`/static` 和前台页面的路径分发，但默认不监听 443，也不申请证书。

## 推荐拓扑

```text
浏览器 → 宿主机 Nginx/Caddy（证书与 HTTPS 跳转）
       → 127.0.0.1:8080 → 容器内 Caddy → 前台 / 后台 / API
```

- 外层代理应转发整个站点，不要分别代理前台、后台和 API。
- 外部反代模式不要叠加 `docker-compose.https.yml`；后台的内置 HTTPS 控件也不会代替外层代理管理证书。
- 不要把未加密的 8080 端口直接开放到公网。
- Nginx 必须转发 `Host`、`X-Forwarded-For`、`X-Forwarded-Host`、`X-Forwarded-Proto` 和 WebSocket 请求头。

完整、持续维护的 Nginx 与 Caddy 示例以仓库根目录的 [反向代理部署](https://github.com/X2M7/zweiblog#反向代理部署) 为准，也可以直接使用仓库中的 [Nginx 模板](https://github.com/X2M7/zweiblog/blob/main/docker-compose/reverse-proxy/nginx.conf.example) 或 [Caddy 模板](https://github.com/X2M7/zweiblog/blob/main/docker-compose/reverse-proxy/Caddyfile.example)。

## 真实访客 IP

评论归属地、后台 IP 和限流依赖可信的代理链。外层代理与容器内 Caddy 都要配置，并且只能信任实际代理使用的精确 IP/CIDR：

```dotenv
ZWEI_BLOG_CADDY_TRUSTED_PROXIES=172.18.0.1/32
ZWEI_BLOG_TRUST_PROXY=loopback,172.18.0.1/32
```

示例地址不能直接照抄，应按 README 的方法检查 Docker 网关和访问日志。不要使用 `0.0.0.0/0`、整个私有地址范围或其他过宽范围。

## 上传大小

后台图片最多 10 MiB，评论图片最多 5 MiB，自定义页面单文件最多 10 MiB。仓库 Nginx 模板的 `client_max_body_size 32m` 足以覆盖这些文件，但后台 JSON 备份导入默认可达 256 MiB；导入大备份时需要同步提高外层代理限制。出现 HTTP 413 时，优先检查 Nginx、CDN 或面板的请求体限制。
