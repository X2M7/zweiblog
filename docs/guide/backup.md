---
title: 备份与迁移
icon: retweet
---

以下是备份或迁移 ZweiBlog 的方法。

<!-- more -->

:::: tabs#deploy

@tab 脚本部署时

备份脚本会暂时停止当前正在运行的服务，确认 MongoDB 正常退出后再打包 `data`、编排配置、环境文件和应用镜像固定版本。完成或失败后都会尝试恢复此前运行的服务；停止失败、MongoDB 被强制终止、打包失败或服务恢复失败均返回失败，不会显示备份成功。请在维护窗口运行，并检查命令退出状态。

备份权限为 `0600`，包含数据库密码等敏感内容，需安全存放在另一台机器或加密存储中。已有停止状态的服务不会被备份过程自动启动。此流程适用于本脚本管理的单机 MongoDB；外部数据库和其他写入同一数据卷的进程需要单独停止或使用数据库原生备份。

一键安装的持久化根目录是 `/var/zweiblog/data`，里面包括 `data/static`、`data/mongo`、`secrets`、`log`、`caddy` 和 MongoDB 初始化/健康检查脚本，均随整个 `data` 目录保存。对于仓库 Compose 的默认平铺布局，备份也会保存安装根目录旁列的 `secrets`、`log`、`caddy` 和 MongoDB 辅助脚本，以及标准的 HTTPS/构建覆盖配置。通过 `ZWEIBLOG_DATA_DIR` 或自定义挂载指向安装目录之外的数据，需要另行纳入一致性备份；脚本不会自动收集任意外部目录。

归档会记录正在运行的应用镜像 ID，但不包含镜像本身。跨机器恢复前，请同时用 `docker save` / `docker load` 转移匹配的应用和 MongoDB 镜像，或核对仓库中对应的不可变摘要；本地镜像 ID 不能直接从远程仓库拉取。备份、更新、恢复期间不要并行执行其他部署命令。

```bash
# 执行一键脚本自动打包备份文件
curl -fsSL https://raw.githubusercontent.com/X2M7/zweiblog/main/scripts/zweiblog.sh -o zweiblog.sh && chmod +x zweiblog.sh && ./zweiblog.sh backup
# 复制备份文件到新机器后，再次执行一键脚本恢复备份即可
curl -fsSL https://raw.githubusercontent.com/X2M7/zweiblog/main/scripts/zweiblog.sh -o zweiblog.sh && chmod +x zweiblog.sh && ./zweiblog.sh restore
```

恢复只应使用自己保管的可信备份。脚本先验证并暂存归档，拒绝链接、特殊文件和格式外的路径；之后停止服务，整体替换数据目录，避免把两套 MongoDB 文件混在一起。原数据保留在 `zweiblog-before-restore.*` 目录。恢复完成后服务保持停止；请先核对配置、镜像版本及旧数据保留目录，再手动启动。正式更新前，请在隔离的测试实例完成一次恢复演练，核对文章、分类权限、图片和管理员登录。

### 更新与应用回滚

```bash
./zweiblog.sh update
./zweiblog.sh rollback
```

`update` 先完成上述停写备份，再保留正在运行的应用镜像，且只拉取和替换 `zweiblog` 服务，不升级 MongoDB。更新后的健康检查失败会自动尝试恢复上一应用镜像，并返回失败。成功后也可通过 `rollback` 手动恢复。旧镜像带有独立的 `zweiblog:rollback-*` 标签，不会自动删除。

应用固定镜像 ID 保存在 `/var/zweiblog/.zweiblog-image.yaml`，脚本的启动、重启、备份和回滚都会读取它，避免重启时意外重新使用 `latest`。直接手动运行 Docker Compose 时，也必须把这个文件作为最后一个 `-f` 参数。下一次成功更新会替换“上一次更新”记录；更早的镜像标签及备份需要自行保留和核对。

镜像回滚不会倒退数据库。若更新含不兼容的数据迁移，应保持维护模式、停止写入，并恢复匹配版本的更新前备份。自动健康检查与脚本回归测试不能替代真实服务器上的恢复演练。

@tab docker 手动部署时

`docker` 部署的 ZweiBlog 所有的状态都存储在持久化目录中，所以只需要备份/迁移持久化目录。

停止应用与数据库并确认 MongoDB 正常退出后，再复制映射到宿主机的持久化目录、编排文件和密钥；不要直接打包运行中的 MongoDB 数据目录。复制完成后恢复服务。需要不停机备份时，使用 MongoDB 支持的一致性备份流程。

::: tip

迁移映射的目录到新机器的对应目录后，再用一模一样的 `docker-compose` 启动就好了。

:::

::::

## 更多

ZweiBlog 后台内置有 [导入导出](../advanced/backup.md) 功能，可以通过此功能实现备份。但当前有一些局限：

- 无法备份内置图床的数据。
- 无法备份自定义文件夹页面点数据。

后面会逐步优化，改善这点。
