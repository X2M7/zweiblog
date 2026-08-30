---
title: 环境变量
icon: leaf
order: 2
---

ZweiBlog 启动时读取下列环境变量。修改后需要重启服务或容器。

| 名称 | 必填 | 说明 | 默认值 |
| --- | --- | --- | --- |
| `ZWEI_BLOG_DATABASE_URL` | 否 | MongoDB URL。不要与 `_FILE` 变量同时设置 | `mongodb://mongo:27017/zweiBlog?authSource=admin` |
| `ZWEI_BLOG_DATABASE_URL_FILE` | 否 | 保存 MongoDB URL 的绝对文件路径；Docker 部署推荐使用 | `""` |
| `ZWEI_BLOG_CDN_URL` | 否 | CDN 地址；启用前不要设置 | `""` |
| `ZWEI_BLOG_LEGACY_WALINE_DB` | 否 | 仅供显式迁移工具读取的旧 Waline 数据库名 | `waline` |
| `ZWEI_BLOG_TRUST_PROXY` | 否 | Express 信任的反向代理地址/子网；内置 Caddy 与本地预览保持默认 `loopback` 即可，外置代理只填写其精确 IP/CIDR | `loopback` |
| `ZWEI_BLOG_HOST` | 否 | 后端监听地址；Windows 原生本地开发建议设为 `127.0.0.1`，容器保持默认值 | `0.0.0.0` |
| `ZWEI_BLOG_COMMENT_FORBIDDEN_WORDS` | 否 | 本地评论违禁词，使用英文逗号分隔 | `""` |
| `ZWEI_BLOG_BACKUP_MAX_BYTES` | 否 | 后台 JSON 备份导入/导出的统一字节上限；最小 1 MiB、最大 512 MiB。源站与恢复目标必须使用相同值，超大站点请使用 MongoDB 快照 | `268435456`（256 MiB） |
| `ZWEI_BLOG_UPDATE_ENDPOINT` | 否 | ZweiBlog 自有版本检查 API；未配置时不请求上游版本服务 | `""` |
| `EMAIL` | 否 | Caddy 申请 HTTPS 证书使用的邮箱 | `""` |

## 数据库凭据

生产环境应使用 `ZWEI_BLOG_DATABASE_URL_FILE`，避免连接 URL 出现在 `docker inspect` 和意外的环境变量日志中。文件必须是小型普通文件，不能是符号链接，且内容只能是一条 `mongodb://` 或 `mongodb+srv://` URL。

官方 Compose 模板已使用 `/run/secrets/mongo_app_uri`，并由 `setup-mongo-secrets.sh` 以非 root ZweiBlog 用户可读、其他用户不可读的权限生成。

::: warning

不要在 shell 命令行中直接拼接数据库密码，也不要同时设置 `ZWEI_BLOG_DATABASE_URL` 和 `ZWEI_BLOG_DATABASE_URL_FILE`。两者同时存在时，ZweiBlog 会拒绝启动。

:::
