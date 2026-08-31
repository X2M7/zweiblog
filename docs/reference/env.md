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
| `ZWEI_BLOG_ALLOW_TRUSTED_CUSTOM_CODE` | 否 | 执行整站“定制化”中的自定义脚本；脚本与前台同源，只能运行完全信任的代码 | `false` |
| `ZWEI_BLOG_PIPELINE_ALLOW_UNSAFE_EXECUTION` | 否 | 允许服务端执行流水线代码；生产环境只接受精确值 `true` | `false` |
| `ZWEI_BLOG_PICGO_ALLOW_UNSAFE_PLUGIN_INSTALL` | 否 | 允许运行时安装第三方 PicGo 插件；生产环境只接受精确值 `true` | `false` |
| `EMAIL` | 否 | Caddy 申请 HTTPS 证书使用的邮箱；HTTPS 覆盖文件把部署变量 `ACME_EMAIL` 映射到此变量 | `""` |

早期一键部署没有写入 `ZWEI_BLOG_CADDY_HTTPS`。仅为防止旧站点升级后突然失去 443，模式缺失且 `EMAIL` 有效时会临时兼容为 `on-demand` 并输出警告；新部署必须显式选择模式，不应依赖该推断。

## 上传限制

后台、初始化和设置图片最多 10 MiB，访客评论图片最多 5 MiB。多文件自定义页面的项目上传不设应用层单文件字节上限，并采用磁盘流转；它仍受可用磁盘、文件系统、外层代理/CDN/面板和超时约束。单文件自定义页面 HTML 走 5 MiB JSON 请求体并保存到 MongoDB，不属于无上限上传；项目 ZIP 导出也保留独立的文件数量、单文件 256 MiB 与未压缩总量 512 MiB 等预算。这些限制不受 `ZWEI_BLOG_BACKUP_MAX_BYTES` 影响。HTTP 413 的排查方法见 [部署常见问题](../faq/deploy.md#图片或文件上传失败)。

三个可执行代码开关必须作为运行时变量传入 ZweiBlog 容器。修改 `docker-compose/.env` 后需要重新创建容器；生产环境中，后台保存的设置不能代替部署者把对应变量精确设为小写 `true`。这些开关彼此独立。

## 数据库凭据

生产环境应使用 `ZWEI_BLOG_DATABASE_URL_FILE`，避免连接 URL 出现在 `docker inspect` 和意外的环境变量日志中。文件必须是小型普通文件，不能是符号链接，且内容只能是一条 `mongodb://` 或 `mongodb+srv://` URL。

官方 Compose 模板已使用 `/run/secrets/mongo_app_uri`，并由 `setup-mongo-secrets.sh` 以非 root ZweiBlog 用户可读、其他用户不可读的权限生成。

::: warning

不要在 shell 命令行中直接拼接数据库密码，也不要同时设置 `ZWEI_BLOG_DATABASE_URL` 和 `ZWEI_BLOG_DATABASE_URL_FILE`。两者同时存在时，ZweiBlog 会拒绝启动。

:::
