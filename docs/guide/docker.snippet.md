### 1. 安装依赖

服务器需要 Docker Engine 和 Docker Compose v2。MongoDB 已包含在编排中，不要再把 27017 端口暴露到公网。

### 2. 准备编排和数据库凭据

部署这份 zweiblog 源码时，请复制整个项目并保持 `Dockerfile`、`packages` 与 `docker-compose` 的相对目录结构；不要只复制编排目录，否则无法构建本项目镜像。`docker-compose` 目录必须同时包含：

- `docker-compose.yml`
- `mongo-init.js`
- `mongo-healthcheck.js`
- `setup-mongo-secrets.sh`
- `setup-mongo-secrets.ps1`

修改 `docker-compose.yml` 中的邮箱和 HTTP/HTTPS 宿主机端口，然后执行：

```bash
cd docker-compose
sudo sh ./setup-mongo-secrets.sh .
sudo docker compose config --quiet
```

Windows PowerShell 使用：

```powershell
Set-Location docker-compose
.\setup-mongo-secrets.ps1 .
docker compose config --quiet
```

凭据生成器会创建 256 位随机 root/应用密码。MongoDB root 密码只提供给 MongoDB；ZweiBlog 只获得权限受限应用用户的连接 URL。不要把 `secrets` 目录提交到 Git，也不要手动删除其中的单个文件。

### 3. 启动

```bash
sudo docker compose up -d --build
sudo docker compose ps
```

Windows 本机项目可直接执行：

```powershell
Set-Location E:\zweiblog\docker-compose
.\setup-mongo-secrets.ps1 .
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

该编排生成并启动 `zweiblog:local`，不会拉取不含本项目修改的上游 ZweiBlog 镜像。

ZweiBlog 会等待 MongoDB 通过带认证的健康检查后再启动。MongoDB 只加入 `internal: true` 的数据库网络，并且没有宿主机端口映射。

::: warning 已有 MongoDB 4.4 数据

不要直接运行新版编排。MongoDB 主要版本不能从 4.4 跳到 8.0，直接复用旧 `/data/db` 可能导致数据库无法启动或无法回滚。请先按照 [MongoDB 4.4 安全迁移](./mongodb-migration.md) 生成独立的目标目录并核对数据。

:::

::: warning CPU 要求

MongoDB 5.0 及以上在 x86_64 上要求 AVX，在 ARM 上要求 ARMv8.2-A 或更高版本。如果硬件不满足要求，请在兼容主机上运行 MongoDB 8.0，或使用受支持的托管 MongoDB，不要继续部署已经停止支持的 4.4。

:::

所有可用的 ZweiBlog 环境变量参见 [参考 → 环境变量](../reference/env.md)。
