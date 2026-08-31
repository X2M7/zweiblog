---
title: 环境变量
icon: leaf
order: 2
---

ZweiBlog 启动时读取下列环境变量。修改后需要重启服务或容器。`docker-compose/.env` 只为 Compose 提供变量替换；只有在服务的 `environment` 中引用或由覆盖文件映射的变量才会传入容器。

| 名称 | 必填 | 说明 | 默认值 |
| --- | --- | --- | --- |
| `ZWEI_BLOG_DATABASE_URL` | 否 | MongoDB URL。不要与 `_FILE` 变量同时设置 | `mongodb://mongo:27017/zweiBlog?authSource=admin` |
| `ZWEI_BLOG_DATABASE_URL_FILE` | 否 | 保存 MongoDB URL 的绝对文件路径；Docker 部署推荐使用 | `""` |
| `ZWEI_BLOG_CDN_URL` | 否 | CDN 地址；启用前不要设置 | `""` |
| `ZWEI_BLOG_LEGACY_WALINE_DB` | 否 | 仅供显式迁移工具读取的旧 Waline 数据库名 | `waline` |
| `ZWEI_BLOG_TRUST_PROXY` | 否 | Express 信任的代理链；外部反代时保留 `loopback` 并加入代理实际使用的精确 IP/CIDR | `loopback` |
| `ZWEI_BLOG_CADDY_TRUSTED_PROXIES` | 否 | 容器内 Caddy 接受真实访客转发头的来源；只填写外层代理的精确 IP/CIDR，不能使用全网或整个私有地址范围 | `""` |
| `ZWEI_BLOG_HOST` | 否 | 后端监听地址；官方 Compose 固定为 `127.0.0.1`，只允许容器内 Caddy 连接 | `0.0.0.0` |
| `ZWEI_BLOG_COMMENT_FORBIDDEN_WORDS` | 否 | 本地评论违禁词，使用英文逗号分隔 | `""` |
| `ZWEI_BLOG_BACKUP_MAX_BYTES` | 否 | 后台 JSON 备份导入/导出的统一字节上限；最小 1 MiB、最大 512 MiB。源站与恢复目标必须使用相同值，超大站点请使用 MongoDB 快照 | `268435456`（256 MiB） |
| `ZWEI_BLOG_UPDATE_ENDPOINT` | 否 | ZweiBlog 自有版本检查 API；未配置时不请求上游版本服务 | `""` |
| `ZWEI_BLOG_CADDY_HTTPS` | 否 | 容器内 TLS 模式；基础 Compose 固定为 `off`，仓库部署应通过 `docker-compose.https.yml` 切换到 `on-demand` | `off` |
| `EMAIL` | 否 | Caddy 申请 HTTPS 证书使用的邮箱；HTTPS 覆盖文件把部署变量 `ACME_EMAIL` 映射到此变量 | `""` |

早期一键部署没有写入 `ZWEI_BLOG_CADDY_HTTPS`。仅为防止旧站点升级后突然失去 443，模式缺失且 `EMAIL` 有效时会临时兼容为 `on-demand` 并输出警告；新部署必须显式选择模式，不应依赖该推断。

## 上传限制

后台、初始化和设置图片最多 10 MiB，访客评论图片最多 5 MiB，自定义页面单文件最多 10 MiB。这些限制不受 `ZWEI_BLOG_BACKUP_MAX_BYTES` 影响。外层代理还可能设置更小的请求体限制，HTTP 413 的排查方法见 [部署常见问题](../faq/deploy.md#图片或文件上传失败)。

## 数据库凭据

生产环境应使用 `ZWEI_BLOG_DATABASE_URL_FILE`，避免连接 URL 出现在 `docker inspect` 和意外的环境变量日志中。文件必须是小型普通文件，不能是符号链接，且内容只能是一条 `mongodb://` 或 `mongodb+srv://` URL。

官方 Compose 模板已使用 `/run/secrets/mongo_app_uri`，并由 `setup-mongo-secrets.sh` 以非 root ZweiBlog 用户可读、其他用户不可读的权限生成。

::: warning

不要在 shell 命令行中直接拼接数据库密码，也不要同时设置 `ZWEI_BLOG_DATABASE_URL` 和 `ZWEI_BLOG_DATABASE_URL_FILE`。两者同时存在时，ZweiBlog 会拒绝启动。

:::
