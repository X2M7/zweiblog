---
title: 开发指南
icon: signs-post
order: 7
---

::: info 提示

本项目处于早期开发阶段 (Early WIP)，如有 bug 请多担待。

:::

本项目使用了 `JavaScript` 和 `TypeScript` 实现。

如果你想参与 ZweiBlog 开发，可以进群哦：

- [ZweiBlog 开发群](https://jq.qq.com/?_wv=1027&k=mf2CguM8)

## 准备知识

### 整体架构

Zweiblog 分为以下几个部分，构建后将整合到一个 `docker` 容器内：

> website: Zweiblog 默认的主题，使用了 `nextjs` 框架，有运行时。
>
> server: Zweiblog 的后端服务，有运行时。
>
> comment: Server 内置的本地评论模块，数据保存在 MongoDB。
>
> admin: Zweiblog 后台面板，打包后为静态页面，无运行时。
>
> caddy: 作为容器内路径路由器反代上述服务；生产默认由宿主机反向代理管理 TLS，也可显式启用容器内按需 HTTPS。

### 进程依赖和启动关系

打包后，启动关系如图：

```text
浏览器 → Caddy → Website / Admin / Server → MongoDB
                                └─ 原生评论模块（Server 内）
```

### 路径结构

本项目采用了 `pnpm` 作为包管理器，项目使用 `monorepo(pnpm workspace)` 组织和管理。

精简版目录结构：

```bash
├── docker-compose  # docker-compose 编排
├── Dockerfile  # Dockerfile
├── docs # 项目文档的代码
├── entrypoint.sh # 容器入口文件
├── LICENSE # 开源协议
├── package.json
├── packages # 代码主体
|  ├── admin # 后台前端代码
|  ├── server # API、后台能力与本地评论系统
|  └── website # 前台前端代码
├── README.md
└── pnpm-workspace.yaml # pnpm workspace 文件
```

### 技术栈

只列出大体上框架级别的，一些细节就直接看代码吧。

- 前台： [next.js](https://nextjs.org/)、[react.js](https://reactjs.org/)、[tailwind-css](https://tailwindcss.com/)
- 后台： [ant design pro](https://pro.ant.design/zh-CN/)、[ant design](https://ant.design/)
- 后端： [nest.js](https://nestjs.com/)、[mongoDB](https://www.mongodb.com/)
- CI： [docker](https://www.docker.com/)、[nginx](https://www.nginx.com/)、[github-actions](https://docs.github.com/cn/actions)
- 文档： [vuepress](https://vuejs.press/zh/)、[vuepress-theme-hope](https://theme-hope.vuejs.press/zh/)

## 本地开发

### 环境准备

#### 准备数据库

开发之前，要有一个 `mongodb` 数据库。推荐用 `docker` 起一个：

```bash
docker run --name mongodb-zweiblog -d --restart unless-stopped \
  -p 27017:27017 mongo
```

#### node 要求

- nodejs 18
- pnpm v7+

#### 克隆项目并安装依赖

```bash
git clone https://github.com/X2M7/zweiblog.git
cd zweiblog
pnpm i
```

### 添加 server 配置文件

在 `packages/server` 下，创建 `config.yaml` 文件，内容如下：

```yaml
database:
  # 数据库连接
  url: mongodb://localhost:27017/zweiBlog?authSource=admin
static:
  # 图床等静态文件保存的位置
  path: /var/zweiblog-dev/static
# 是否开启演示站模式，会限制很多权限
demo: 'false'
# 旧 Waline 数据库名，仅在执行显式评论迁移时使用
legacyWaline:
  db: waline
# 日志位置
log: /var/zweiblog-dev/logs
```

### 开发相关命令

#### 开发全部

在根目录下：

```bash
# 开发全部（前台、后台、server）
pnpm dev
# 前台为 3001 端口
# server 为 3000 端口
# 后台为 3002 端口
```

::: info ZweiBlog开发后台如果用到复制到剪切板相关的功能，可能需要开启 `https`，请在 `packages/admin/config/config.js` 中的 `https` 改成 `true`，再重启开发进程。

```js
 devServer: { https: true, port: 3002 },
```

:::

#### 单独开发前后台（前端）

必须要先启动 server：

```bash
# 端口 3000
pnpm dev:server
```

然后在启动前台后者后台

```bash
# 启动前台 端口 3001
pnpm dev:website
# 启动后台 端口 3002
pnpm dev:admin
```

### 文档开发

根目录下：

```bash
pnpm docs:dev
```

端口号为: `8080`

## 镜像构建

根目录的 `Dockerfile` 可直接构建完整镜像：

```bash
docker build -t zweiblog:local .
```

Docker Compose 的预构建镜像和源码构建方法、数据目录、升级及反向代理配置，请以仓库根目录的 [README](https://github.com/X2M7/zweiblog#readme) 为准。

## Release

本项目使用 [standard-version](https://github.com/conventional-changelog/standard-version) 管理版本。推送 `v*` 标签后，GitHub Actions 会在测试通过后构建多架构镜像并创建 GitHub Release。

```bash
pnpm release
git push --follow-tags origin main
```
