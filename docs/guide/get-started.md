---
title: 快速上手
icon: lightbulb
order: 1
---

欢迎使用 ZweiBlog。推荐通过仓库自带的 Docker Compose 编排部署，应用、MongoDB、静态文件和评论数据均由自己的服务器管理。

<!-- more -->

::: tip 发布说明

部署、升级、备份和反向代理配置以仓库根目录的 [README](https://github.com/X2M7/zweiblog#readme) 为准。升级前应先备份数据库和全部持久化目录，不要仅凭后台提示直接覆盖生产环境。

:::

## 介绍

<!-- @include: @/info.snippet.md -->

## 配置要求

服务器需要 Docker Engine、Docker Compose v2，以及 MongoDB 8.0 支持的 64 位处理器。镜像运行内存会随文章数量、并发和图片处理任务变化；源码构建还需要额外的 CPU、内存和磁盘空间。

公网部署建议准备已解析到服务器的域名，并由宿主机 Nginx/Caddy 负责 TLS。MongoDB 无需开放宿主机端口，更不能暴露到公网。

## 部署方式

<!-- @include: ./docker.snippet.md -->

初始化完成后，请继续参考 README 中的 [Nginx/Caddy 反向代理](https://github.com/X2M7/zweiblog#反向代理部署)、真实访客 IP、备份与升级章节。
