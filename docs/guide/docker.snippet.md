### 1. 获取部署文件

```bash
git clone https://github.com/X2M7/zweiblog.git
cd zweiblog/docker-compose
cp .env.example .env
```

Windows PowerShell 使用 `Copy-Item .env.example .env`。按需编辑 `.env`；默认只监听宿主机 `127.0.0.1:8080`，容器内 TLS 和 443 均关闭，适合再接一层 Nginx 或 Caddy。直接使用内置 HTTPS 时必须按根目录 README 显式叠加 `docker-compose.https.yml`。

### 2. 准备编排和数据库凭据

```bash
sudo sh ./setup-mongo-secrets.sh .
sudo docker compose config --quiet
```

Windows PowerShell 使用：

```powershell
Set-Location docker-compose
.\setup-mongo-secrets.ps1 .
docker compose config --quiet
```

凭据生成器会创建 256 位随机 root/应用密码。MongoDB root 密码只提供给 MongoDB；ZweiBlog 只获得权限受限应用用户的连接 URL。不要提交 `secrets` 目录，也不要手动删除其中的单个文件。

### 3. 启动

```bash
sudo docker compose pull
sudo docker compose up -d
sudo docker compose ps
sudo docker compose logs -f zweiblog
```

默认镜像是 `ghcr.io/x2m7/zweiblog:latest`。如果镜像尚未公开，或需要从当前 checkout 构建：

```bash
sudo docker compose \
  -f docker-compose.yml \
  -f docker-compose.build.yml \
  up -d --build
```

本地测试可打开 `http://localhost:8080/admin` 初始化；公网环境应先配置 README 中的反向代理，并把后台站点 URL 设置为最终的 `https://` 地址。

ZweiBlog 会等待 MongoDB 通过带认证的健康检查后再启动。MongoDB 只加入 `internal: true` 的数据库网络，并且没有宿主机端口映射。

::: warning 已有 MongoDB 4.4 数据

不要直接运行新版编排。MongoDB 主要版本不能从 4.4 跳到 8.0，直接复用旧 `/data/db` 可能导致数据库无法启动或无法回滚。请先按照 [MongoDB 4.4 安全迁移](./mongodb-migration.md) 生成独立的目标目录并核对数据。

:::

::: warning CPU 要求

MongoDB 5.0 及以上在 x86_64 上要求 AVX，在 ARM 上要求 ARMv8.2-A 或更高版本。如果硬件不满足要求，请在兼容主机上运行 MongoDB 8.0，或使用受支持的托管 MongoDB，不要继续部署已经停止支持的 4.4。

:::

常用部署变量、完整备份、升级回滚以及真实访客 IP 配置见仓库根目录 [README](https://github.com/X2M7/zweiblog#readme)。应用环境变量参见 [参考 → 环境变量](../reference/env.md)。
