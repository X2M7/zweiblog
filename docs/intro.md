---
title: 介绍
icon: circle-info
order: 1
---

# ZweiBlog

ZweiBlog 是一个支持完整中英文站点、本地评论与项目化自定义页面的自托管博客系统，包含响应式前台、管理后台、NestJS API 与 MongoDB 数据层。

项目基于 [VanBlog](https://github.com/Mereithhh/vanblog) 修改，保留上游历史并继续使用 GPL-3.0。ZweiBlog 已加入不同的数据字段、接口与交互，不是 VanBlog 官方版本；本分支的问题请提交到 [ZweiBlog Issues](https://github.com/X2M7/zweiblog/issues)。

## 主要增强

- 整站中英文切换，文章、草稿和站点元数据可分别编写英文内容。
- 完全本地的评论、回复、点赞、图片、Markdown 与 TeX，不要求额外部署 Waline。
- 评论可匿名，前台展示近似 IP 归属地和设备信息，后台额外展示 IP。
- 可编辑的中英文友情链接页面，导航和友链支持排序。
- 丰富且风格统一的国内外联系方式类型。
- 单文件和多文件自定义页面支持项目树、重命名、递归删除和完整 ZIP 导出。

## 基础能力

- Markdown、代码高亮、TeX、Mermaid、Emoji、目录与图床。
- 文章、草稿、分类、标签、搜索、时间线、RSS 与 Sitemap。
- 响应式前后台、深色模式、统计、API Token、协作者与备份。
- 自定义导航、CSS、HTML/JavaScript 和流水线。

## 部署

当前发布方式、数据持久化、升级、备份、Nginx/Caddy 反代和真实访客 IP 配置均以仓库根目录的 [README](https://github.com/X2M7/zweiblog#readme) 为准。旧版 VanBlog 的镜像名和一键安装地址不适用于 ZweiBlog。

推荐使用仓库中的 Docker Compose；镜像可选择 `ghcr.io/x2m7/zweiblog:latest`，中国大陆服务器也可使用同时发布的 `ccr.ccs.tencentyun.com/x2m7/zweiblog:latest`。MongoDB 不应映射到公网。首次部署前必须使用仓库提供的脚本生成本地 Docker secrets。

## 隐私与安全

评论会处理 IP、近似归属地、浏览器和操作系统信息。公开部署前应根据所在地法规完善隐私说明、保存期限和删除渠道。

自定义脚本、流水线和第三方 PicGo 插件属于可执行代码。生产环境保持默认安全限制，只在理解风险并审计来源后启用。
