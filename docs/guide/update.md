---
title: 升级
icon: cloud-arrow-up
order: -3
---

## 升级提示

ZweiBlog 的编排、镜像和数据结构可能同时变化。生产升级以仓库根目录的 [升级与回滚](https://github.com/X2M7/zweiblog#升级与回滚) 为唯一权威步骤。

![升级提醒](https://pic.mereith.com/img/e314ee92dd1ad9b5b6c0b814b014c247.clipboard-2022-08-22.png)

升级前必须备份数据库和全部持久化目录，并记录当前源码提交、Compose 文件和镜像标签。后台“导出全部数据”不包含本地图片、密钥和 Caddy 证书，不能代替服务器完整备份。

![备份数据](https://pic.mereith.com/img/4eba8540c5a7a5ae41885289abf98514.clipboard-2022-08-15.png)

## Docker Compose 部署

1. 完成并验证完整备份。
2. 从 Releases 选择目标版本；固定标签部署必须修改 `.env` 中的 `ZWEIBLOG_IMAGE`，仅执行 `pull` 不会自动切换标签。
3. 更新仓库和部署文件，验证 Compose 配置后再拉取、重建并检查日志。
4. 使用内置 HTTPS 的站点，后续每条 Compose 命令都必须继续带上 `docker-compose.https.yml`；否则会回到默认外部反代模式并关闭 443。

不要使用 `docker compose down -v`，不要为了升级删除 `data/`、`secrets/`、`caddy/`，也不要把自动更新器直接用于未经备份和测试的生产站点。

## 一键脚本部署

只有原本由 `zweiblog.sh` 安装的站点才能继续用该脚本管理。先更新脚本并阅读目标版本的迁移说明；菜单“更新”主要更新镜像，不应被视为自动完成跨 MongoDB 主版本或旧 Compose 布局迁移。发现旧编排缺少当前必需变量时，应停止升级并先完成人工核对。

## 更多

::: info 当前版本查看

ZweiBlog 会在前台和后台的最下方展示版本信息。

![前台版本信息](https://pic.mereith.com/img/720d4503f7ca23cfb035061d0927b088.clipboard-2022-08-16.png)

![后台版本信息](https://pic.mereith.com/img/0f97b214de4965f69db68b935d993f07.clipboard-2022-08-16.png)

:::

::: warning 如何回滚

把镜像标签改回旧版本并不保证数据结构兼容。可靠回滚需要同时恢复升级前保存的 Compose 文件、镜像标签和完整数据备份，并先在隔离环境验证。

:::

## 常见问题

- 详见 [升级常见问题](../faq/update.md)。
