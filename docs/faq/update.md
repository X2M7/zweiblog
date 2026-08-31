---
title: 升级常见问题
icon: cloud-arrow-up
order: 3
---

## 如何回滚

镜像标签和数据库状态必须匹配。请恢复升级前记录的 Compose 文件、镜像标签和完整数据备份；不要使用 `docker compose down -v`，也不要只回退镜像后继续使用已经迁移的数据。完整流程见根目录 README 的 [升级与回滚](https://github.com/X2M7/zweiblog#升级与回滚)。

## docker 镜像拉取慢

您可以 [设置 docker 镜像加速器](https://www.runoob.com/docker/docker-mirror-acceleration.html)。

## 升级后访问文章地址时出现 404 错误

容器启动后会重新准备前台服务。先等待健康检查完成，再查看 `docker compose ps` 和 `docker compose logs --tail=200 zweiblog`；不要通过反复删除容器或数据目录处理 404。

## 升级后后台报错或持续加载

请清空浏览器缓存再重新加载。大部分浏览器可以使用 <kbd>Ctrl</kbd> + <kbd>F5</kbd> 强制刷新以忽略缓存。

::: details 其他方案

如果是 `Chrome` 浏览器，您可以按 `F12` 打开开发者工具。在网络选项卡中勾选`停用缓存`，然后再刷新页面即可（刷新时开发者工具窗口不要关），正常后记得取消勾选`停用缓存`。

其他浏览器可以自行百度。

![Chrome 停用缓存](https://www.mereith.com/static/img/5efb32214a31c1003df5eeba217a5586.clipboard-2022-09-03.png)

:::

## 容器无限重启

先保存日志并核对 Compose 文件与镜像版本是否配套。使用内置 HTTPS 时，还要确认重建命令仍带有 `docker-compose.https.yml`。随后按升级前的完整备份执行回滚，并向 [ZweiBlog Issues](https://github.com/X2M7/zweiblog/issues/new/choose) 反馈脱敏后的日志。
