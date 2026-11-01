# ZweiBlog 后台管理面板

后台使用 Umi。以下命令均在仓库根目录执行：

```bash
pnpm install --frozen-lockfile
pnpm dev:admin
```

开发页面为 `http://localhost:3002/admin/`，使用 HTTP。开发代理将 `/api/` 和 `/static/` 请求转发至 `http://localhost:3000`，需先按根目录说明启动后端。

构建与测试：

```bash
pnpm build:admin
pnpm --filter @zweiblog/admin test
```

生产部署使用仓库根目录的 [Dockerfile](../../Dockerfile)，步骤见 [README](../../README.md)。
