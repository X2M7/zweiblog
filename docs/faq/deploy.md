---
title: 部署常见问题
icon: rocket
order: 1
---

部署、端口、反向代理和升级命令以仓库根目录 [README](https://github.com/X2M7/zweiblog#readme) 为准。

## 部署后无法访问后台

默认 Compose 只在宿主机 `127.0.0.1:8080` 提供 HTTP 上游，不能从其他机器直接访问。依次检查：

```bash
sudo docker compose config --quiet
sudo docker compose ps
curl -I http://127.0.0.1:8080/admin/
sudo docker compose logs --tail=200 zweiblog
```

公网环境还要检查外层 Nginx/Caddy、域名解析和防火墙。外部反代模式只代理整个 `http://127.0.0.1:8080` 入口，不要分别代理前台、后台和 API，也不要叠加内置 HTTPS 覆盖文件。

## 图片或文件上传失败

- 后台、初始化和设置图片最多 10 MiB。
- 评论图片最多 5 MiB。
- 多文件自定义页面项目上传不设应用层单文件字节上限，采用磁盘流转；仍受磁盘、文件系统、外层代理/CDN/面板和超时约束。
- 单文件自定义页面 HTML 仍受 5 MiB JSON 请求体和 MongoDB 单文档容量约束。
- 多文件页面 ZIP 导出单文件最多 256 MiB、未压缩总量最多 512 MiB，并有文件数量、目录深度和并发限制。
- 后台 JSON 备份导入默认最多 256 MiB，容器环境变量可配置的绝对上限为 512 MiB。

HTTP 413 通常表示外层 Nginx、CDN 或面板仍有限制。仓库 Nginx 模板只对精确的 `/api/admin/customPage/upload` 路由设置 `client_max_body_size 0` 和 `proxy_request_buffering off`，其他接口继续使用 32 MiB；复制模板时不要遗漏这个精确路由，也不要把无限制配置扩大到整个站点。大备份需要另外同步提高代理限制。若不是 413，检查代理超时、可用磁盘、浏览器响应和 ZweiBlog 容器日志，不要通过开放额外端口绕过代理。

## 如何从外部检查 MongoDB

官方 Compose 把 MongoDB 放在内部网络中，并通过 secret 文件启用认证。不要把 27017 映射到公网，也不要手工把应用连接 URL 和数据库密码写进 Compose。

普通诊断优先使用 `docker compose ps`、MongoDB 健康检查和容器日志。确需使用数据库管理工具时，应使用经过访问控制的 SSH 隧道或受限管理网络，并在操作前完成备份；不要修改官方编排的内部网络和凭据文件。

## 真实访客 IP 或评论归属地不正确

仅转发 `X-Forwarded-For` 不够。还需把外层代理实际使用的精确 IP/CIDR 同时配置到 `ZWEI_BLOG_CADDY_TRUSTED_PROXIES` 和 `ZWEI_BLOG_TRUST_PROXY`。不要使用 `0.0.0.0/0` 或整个私有地址范围；具体检查方法见 README 的 [真实访客 IP](https://github.com/X2M7/zweiblog#真实访客-ip)。

## 如何部署到 CDN

CDN 应位于最外层，只缓存明确的静态资源路径，并把动态页面、后台、API、评论和上传请求回源。启用前先确认 CDN 不缓存鉴权响应，并按服务商公布的地址范围配置外层代理信任；不要把任意客户端提供的转发头直接当作真实 IP。

## 容器持续重启

保存并脱敏日志后，核对当前镜像标签、Compose 文件、MongoDB 版本和 CPU 要求是否匹配。不要删除 `data/`、`secrets/`、`caddy/`，也不要执行 `docker compose down -v`。升级后出现问题时按完整备份回滚，并向 [ZweiBlog Issues](https://github.com/X2M7/zweiblog/issues/new/choose) 反馈。
