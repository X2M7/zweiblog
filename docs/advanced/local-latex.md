---
title: 本地 LaTeX 渲染
icon: square-root-variable
---

# 本地 LaTeX / Upmath 渲染器

某些自定义页面会把公式地址生成为同站的 `/svg/<经过 URL 编码的 TeX>`。ZweiBlog 本身不编译 TeX；如果这个请求落入默认的 `location /`，它会被转发到博客前台并返回 Next.js 404。

仓库提供了一个完全可选的 [`docker-compose.upmath.yml`](../../docker-compose/docker-compose.upmath.yml)。它使用经过固定摘要的 `ghcr.io/x2m7/i.upmath.me` 镜像，只把渲染器发布到宿主机 `127.0.0.1:8081`。默认的 `docker compose up -d` 不会读取这个文件，因此不改变 ZweiBlog、MongoDB 或内置 Caddy 的启动方式。

当前渲染镜像仅提供 `linux/amd64`，压缩镜像约 1.6 GB，拉取并解压时应为 Docker 数据目录预留数 GB 空间；ARM64 主机不能直接运行它。镜像中的 TeX 缓存、失败缓存、临时文件和内部日志都放在有容量上限的 `tmpfs` 中，容器重启后会清空，避免公开公式接口持续占满宿主机磁盘；容器网络也禁止主动访问公网。

## 启动渲染器

在服务器的 `zweiblog/docker-compose` 目录执行：

```bash
sudo docker compose -p zweiblog-upmath \
  -f docker-compose.upmath.yml \
  config --quiet
sudo docker compose -p zweiblog-upmath \
  -f docker-compose.upmath.yml \
  pull upmath
sudo docker compose -p zweiblog-upmath \
  -f docker-compose.upmath.yml \
  up -d upmath
sudo docker compose -p zweiblog-upmath \
  -f docker-compose.upmath.yml \
  ps upmath
```

使用单独的 Compose 项目名可以避免 ZweiBlog 日常升级时的 `--remove-orphans` 误删渲染器。今后管理这个渲染器也应始终带上 `-p zweiblog-upmath -f docker-compose.upmath.yml`。

`.env.example` 中的 `ZWEIBLOG_UPMATH_*` 变量可以调整镜像、端口、资源预算和各个临时文件系统的容量。除非宿主机 Nginx 位于另一台机器，不要把 `ZWEIBLOG_UPMATH_BIND` 改成 `0.0.0.0`。复杂 TikZ 确实超过默认资源预算时，应按服务器容量逐步提高限制，而不是取消所有限制。若要升级镜像，应先审核新版本并把 `ZWEIBLOG_UPMATH_IMAGE` 改为新的固定摘要，不建议改回可变的 `latest`。

先直接验证内部服务；首次公式渲染可能需要数秒：

```bash
curl --compressed -fsS \
  -o /tmp/zweiblog-upmath-test.svg \
  -w 'HTTP %{http_code}  %{content_type}\n' \
  'http://127.0.0.1:8081/svg/x%5E2'
grep -q '<svg' /tmp/zweiblog-upmath-test.svg && echo 'Upmath SVG 正常'
```

预期为 HTTP 200、`image/svg+xml`，并打印 `Upmath SVG 正常`。失败时查看：

```bash
sudo docker compose -p zweiblog-upmath \
  -f docker-compose.upmath.yml \
  logs --tail=200 upmath
```

## 在宿主机 Nginx 中精确代理 `/svg/`

渲染器会编译访问者提供的 TeX，不应把它的整个站点或宿主机端口直接暴露到公网。只在博客域名的 HTTPS `server` 中添加所需路径，并保留温和的请求速率限制。

Debian/Ubuntu 的 `/etc/nginx/nginx.conf` 通常会在 `http {}` 内加载 `/etc/nginx/conf.d/*.conf`。新建 `/etc/nginx/conf.d/zweiblog-upmath-limit.conf`，内容如下：

```nginx
limit_req_zone $binary_remote_addr zone=zweiblog_upmath:10m rate=10r/s;
```

然后编辑实际生效的站点文件，例如 `/etc/nginx/sites-enabled/xumin`。在 `server_name xumin.net www.xumin.net;` 所在的 HTTPS `server` 内、通用的 `location /` 之前加入：

```nginx
location ^~ /svg/ {
    # GET 已包含 HEAD；拒绝向 TeX 服务转发写入类方法。
    limit_except GET {
        deny all;
    }

    # 足以承受一个页面并发加载许多公式，同时限制持续滥用。
    limit_req zone=zweiblog_upmath burst=60 nodelay;
    limit_req_status 429;

    # 末尾不能加 /，否则 Nginx 会剥掉上游需要的 /svg/ 前缀。
    proxy_pass http://127.0.0.1:8081;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host i.upmath.me;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 5s;
    # 首次生成字体缓存或复杂 TikZ 可能较慢；与 Upmath 内部上游保持一致。
    proxy_read_timeout 300s;
    proxy_send_timeout 30s;

    add_header X-Content-Type-Options nosniff always;
}
```

不要删除原来的 `location /`，也不需要修改 ZweiBlog 容器内的 Caddy。检查并平滑加载配置：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

再从公开域名验证，响应不能是 HTML 或 Next.js 404：

```bash
curl --compressed -fsS \
  -o /tmp/zweiblog-public-latex.svg \
  -w 'HTTP %{http_code}  %{content_type}\n' \
  'https://xumin.net/svg/x%5E2'
grep -q '<svg' /tmp/zweiblog-public-latex.svg && echo '公开 SVG 路由正常'
```

最后刷新 `/c/latex`。自定义页面里的公式地址应使用站内根相对路径，例如：

```js
const url = '/svg/' + encodeURIComponent(tex.trim());
```

不应再硬编码另一台服务器或另一个域名。

## 不要开放未使用的兼容路径

当前 `latex.html` 只请求 `/svg/`，只配置上面的精确位置即可。不要顺手开放 `/svgb/`、`/pngb/`、`/jpgb/` 等压缩公式入口；当前上游实现没有对解压后的公式长度设置独立上限。也不要代理渲染器的整个 `/`。确实需要其他输出格式时，应先在上游增加对应的输入长度、解压长度和资源测试，再逐条开放精确路径。

`/latex.js` 不是当前页面所必需。该上游脚本的某些构建版本会把图片域名写死为公共 `i.upmath.me`，直接反代脚本并不能保证“完全本地”。只有在检查或重新构建脚本、确认它生成本站 `/svg/` 地址后，才应为它添加精确的 `location = /latex.js`。

## 停用

该服务没有写入 ZweiBlog 数据库。停用不会删除文章或自定义页面：

```bash
sudo docker compose -p zweiblog-upmath \
  -f docker-compose.upmath.yml \
  stop upmath
```

停用后还应删除 Nginx 中的 `/svg/` 位置和对应的 `limit_req_zone` 文件，随后再次执行 `sudo nginx -t` 并重载。
