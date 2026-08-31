管理脚本仅作为纯 Linux 环境下的辅助方式；生产部署优先使用仓库根目录 README 中可审计的 Docker Compose 步骤。先下载并检查脚本来源，再以 root 权限运行：

```bash
curl -fsSL https://raw.githubusercontent.com/X2M7/zweiblog/main/scripts/zweiblog.sh -o zweiblog.sh
grep -E 'ZWEIBLOG_SCRIPT_VERSION|github.com/X2M7/zweiblog' zweiblog.sh
chmod +x zweiblog.sh
sudo ./zweiblog.sh
```

如果未来需要再次运行脚本，可直接运行：

```bash
sudo ./zweiblog.sh
```

如果菜单显示 `VanBlog`、`github.com/mereithhh/van-blog` 或 `/var/vanblog`，你运行的仍是旧脚本；退出它并重新下载上面的 `zweiblog.sh`。停止旧 VanBlog 后无需立即删除，保留旧数据更便于迁移和回滚。

启动完毕后，请 [完成初始化](./init.md)。

::: tip

1. 脚本默认使用 `/var/zweiblog`，不会处理旧 `/var/vanblog`；不要把两者的数据目录混用。
1. 卸载会永久删除数据库、图片、评论、密钥和证书，必须先完成并验证备份。
1. MongoDB 不应开放到公网。反代只需指向映射的 HTTP 端口，详见 [反代配置](../reference/reverse-proxy.md)。

:::
