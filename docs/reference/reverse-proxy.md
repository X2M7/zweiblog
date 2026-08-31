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

后台图片最多 10 MiB，评论图片最多 5 MiB。多文件自定义页面的上传采用磁盘流转，不设应用层单文件字节上限；为了不同时放宽图片、评论和备份接口，Nginx 应只给经过后台鉴权的精确上传路由添加例外：

```nginx
location = /api/admin/customPage/upload {
    client_max_body_size 0;
    proxy_request_buffering off;
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
}
```

`client_max_body_size 0` 只取消这一层 Nginx 的请求体大小检查，`proxy_request_buffering off` 让请求直接流向应用；它们不会创造无限磁盘空间，也不会取消浏览器、CDN、面板、文件系统或超时限制。其余路由继续使用模板的 32 MiB 上限。单文件自定义页面仍受 5 MiB JSON 请求体及 MongoDB 单文档限制，项目 ZIP 导出也有独立预算；后台 JSON 备份导入默认可达 256 MiB。出现 HTTP 413 时优先检查每一层代理的请求体配置，上传中断时同时检查超时、磁盘余量和容器日志。
