---
title: MongoDB 4.4 安全迁移
icon: database
order: -2
---

# MongoDB 4.4 安全迁移

ZweiBlog 的新安装使用 MongoDB 8.0，并默认启用认证。数据库没有映射宿主机端口，只能通过 Compose 的内部 `database` 网络访问。`zweiblog-root` 仅用于数据库初始化；应用使用权限受限的 `zweiblog` 用户。原生评论保存在 `zweiBlog` 数据库，`waline` 权限仅用于升级后的显式旧评论迁移。

## 重要限制

- 不要把 `mongo:8.0` 镜像直接指向 MongoDB 4.4 的 `/data/db`。
- MongoDB 原地升级必须逐个主要版本进行。官方要求 7.0 升 8.0 前先把 FCV 设置为 7.0；更早版本也必须依次升级。
- MongoDB 5.0 及以上在 x86_64 上需要 AVX，在 ARM 上需要 ARMv8.2-A 或更高版本。
- 不要在迁移确认完成前删除旧数据目录、逻辑备份或旧 Compose 文件。

项目提供的迁移脚本采用更安全的逻辑迁移：短暂停止 ZweiBlog 写入，导出 `zweiBlog`，并在存在时一并导出旧 `waline` 数据库；随后恢复到一个没有公开端口的全新 MongoDB 8.0 容器，并逐集合比较文档数量。旧数据库目录始终保持不变。

MongoDB 官方参考：

- [将独立运行的实例升级到 MongoDB 8.0](https://www.mongodb.com/docs/v8.0/release-notes/8.0-upgrade-standalone/)
- [MongoDB 生产环境平台和 CPU 要求](https://www.mongodb.com/docs/manual/administration/production-notes/)

## 执行迁移预检和暂存

在包含旧 `docker-compose.yaml` 的部署目录中执行：

```bash
sudo bash /path/to/zweiblog/scripts/migrate-mongo.sh
```

Windows 上请在 WSL2 的 Linux 文件系统中运行迁移脚本，并确保 WSL 可以访问 Docker Desktop。迁移脚本依赖 Linux 的 UID 权限、`/proc/cpuinfo` 和 Bash；不要直接用 PowerShell 或 Git Bash 执行数据库迁移。

如果旧 MongoDB 已启用认证，将连接 URL 放入仅 root 可读的文件，不要放进命令历史：

```bash
sudo install -m 600 /dev/null /root/zweiblog-source-mongo-uri
sudoedit /root/zweiblog-source-mongo-uri
sudo env \
  ZWEIBLOG_MONGO_SOURCE_URI_FILE=/root/zweiblog-source-mongo-uri \
  bash /path/to/zweiblog/scripts/migrate-mongo.sh
```

脚本成功后会生成一个 `mongo-migration-<UTC 时间>` 目录，其中包括：

- 两个 gzip 压缩的 BSON archive 及 SHA-256 校验文件；
- 源库和目标库的集合计数；
- 一个空的 `count-verification.diff`；
- 已初始化并启用认证的 MongoDB 8.0 数据目录；
- root、应用密码和应用连接 URL 三个权限隔离的 secret 文件；
- `MIGRATION_REPORT.txt`，记录准确的源目录、目标目录和人工切换步骤。

脚本不会替换 Compose、移动旧目录或自动上线新数据库。

## 上线与回滚

按照 `MIGRATION_REPORT.txt` 完成人工切换：

1. 保存旧 Compose 文件和旧 MongoDB 数据目录。
2. 使用新版 Compose 模板，将 `/data/db` 映射到迁移后的目标数据目录，并将三个 secret 指向目标 secret 目录。
3. 停止旧栈后，先只启动 MongoDB，并等待健康检查成功。
4. 再启动 ZweiBlog，检查登录、文章、设置和评论数据。
5. 经过观察期后再归档旧数据；不要立即删除。

需要回滚时，停止新栈，恢复旧 Compose 文件并重新指向从未修改过的旧目录。不要让 MongoDB 4.4 打开新目录，也不要让 MongoDB 8.0 打开旧目录。

## 新安装凭据

手工使用仓库中的 Compose 文件前，先生成 secret：

```bash
cd docker-compose
sudo sh ./setup-mongo-secrets.sh .
sudo docker compose config --quiet
sudo docker compose up -d
```

Windows PowerShell 可改用：

```powershell
Set-Location docker-compose
.\setup-mongo-secrets.ps1 .
docker compose config --quiet
docker compose up -d
```

生成脚本具有以下保护：如果检测到既有 MongoDB 数据、secret 不完整、路径是符号链接，或已有 secret 与应用 URL 不一致，它会失败退出，不会自动轮换或覆盖凭据。
