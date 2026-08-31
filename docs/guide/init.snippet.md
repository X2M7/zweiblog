默认部署只在宿主机 `127.0.0.1:8080` 提供 HTTP 上游。公网使用时先配置宿主机 Nginx/Caddy 和证书，再通过最终地址 `https://<你的域名>/admin/init` 完成初始化。具体设置项可以参考 [站点配置](/features/config.md)。

你也可以直接访问博客地址，并点击导航栏右上角管理员按钮进入后台初始化页面。

::: tip

本机测试可访问 `http://localhost:8080/admin/init`。仅当显式启用内置 HTTPS 模式并开放 80/443 后，才由容器内 Caddy 申请证书；详见 [HTTPS](/advanced/https.md)。外部反代配置见 [反代](/reference/reverse-proxy.md)。

:::
