---
title: API 参考
icon: plug
order: 6
---

目前还没写专门的 API 参考，但是可以用生成的 `swagger` 做为参考。其中 `public` 标签下的都是不需要鉴权的。

## API 文档入口

你可以在后台的 `系统设置/Token 管理` 中点击 `API 文档` 进入此 Zweiblog 对应的 API 文档。

![](https://pic.mereith.com/img/d78409dcfb170ea71289ac38d9430165.clipboard-2023-03-17.png)

::: note

- swagger 路径： `/swagger`
- 在自己的站点访问 `/swagger`（生产环境需显式设置 `ZWEI_BLOG_ENABLE_SWAGGER=true`，使用后建议关闭）。

:::

举个例子，你可以通过 `GET /api/public/article/:id` ，获取置顶文章的 JSON 内容。

部署后可在自己的域名下访问对应公开接口，例如 `/api/public/article/1`。

## 鉴权

所有需要鉴权的接口是通过 `请求头` 中 `token` 字段鉴权的，你可以在后台的 `系统设置/Token 管理` 中进行管理。
