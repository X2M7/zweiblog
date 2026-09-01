---
title: 自定义页面
icon: file
---

ZweiBlog 支持自定义页面，但首先请您明确自己的需求。

## 自定义带有默认布局的页面

如果要自定义带有布局的页面，通俗的理解就是替换掉文章页面中文章卡片的内容。您可以通过以下操作实现：

- 新建文章，在文章内可直接写 html 代码
- 设置文章为隐藏
- 在后台布局设置中开启 `通过 URL 访问隐藏文章`
- 在后台自定义导航栏中添加这篇文章
- 或者在定制化中，嵌入自己的代码把这篇文章的 URL 嵌入到合适的位置

## 完整的自定义页面

不带有已有布局，完全自定义的页面。

分为两种：单文件页面、多文件页面。

前者可直接通过后台内置编辑器编辑其 HTML 内容，比较省事、后者需要上传相关的文件，适合复杂页面。

在后台的 `站点管理/自定义页面` 中可以找到功能入口：

![自定义页面](https://pic.mereith.com/img/125f158afebb4fd85d5aa81b5d8c6bd7.clipboard-2023-02-01.png)

### 新建页面

您可以新建自定义页面：

![新建页面](https://pic.mereith.com/img/0540fdf061d9106f11470cf5ed65e9d2.clipboard-2023-02-01.png)

PS：路径必须以 `/` 开头，实际的访问路径会在前面加上 `/c`。比如我定义了自定义页面路径为 `/door`，实际我可以通过 `/c/door` 来访问此页面。

### 运行模式

每个自定义页面都可以选择运行模式：

- **隔离模式（推荐）**：页面可以运行脚本、提交表单、弹窗和下载，但使用隔离来源，不能读取 ZweiBlog 同域的 Cookie、`localStorage` 或后台凭据。普通展示页和第三方代码应保持此模式。
- **可信兼容模式**：在其余沙箱限制仍然生效的前提下允许同源能力，适合必须使用同项目 ES Module、Worker、同域存储或 API 的站长自编页面。它还允许用户主动操作后的顶层跳转，以及用 `object`/`embed` 显示同源 PDF；任意外站插件对象和无用户操作的顶层跳转仍会被阻止。它能够接触当前域名下的浏览器数据，只能用于您完全理解并自行维护的代码。

旧页面缺少该配置时按隔离模式处理。运行模式不会解除路径检查或内容安全策略，也不会开启整站“定制化”脚本、流水线或 PicGo 插件开关。

### 在文章中嵌入自定义页面

文章允许用 `iframe` 嵌入本站 `/c/` 下的自定义页面，例如：

```html
<iframe
  src="/c/latex"
  style="width:100%; height:520px; border:0; border-radius:10px; overflow:hidden;"
></iframe>
```

推荐让 `src` 使用以 `/c/` 开头的站内根相对路径。为了兼容已有文章，也可以使用与“站点设置 → 网站 URL（`baseUrl`）”完全同源的 `http(s)` 绝对 `/c/...` 地址；渲染器会先把它规范化为根相对路径。`www` 子域、协议或实际端口不同都不属于同源，即使指向同一台服务器也会被移除；外部地址、协议相对地址、路径穿越和百分号编码路径同样会被移除。

文章中的 `iframe` 会被强制附加隔离沙箱；即使目标页面选择了可信兼容模式，嵌入文章时也不能获得同源存储或后台凭据。需要同源能力时应让访客直接打开 `/c/...` 页面，而不是在文章中嵌入。

ZweiBlog 不附带、拉取或启动 LaTeX 渲染器，也不需要在博客域名配置 `/svg/` 反代。需要通过图片展示公式时，直接复用已有的独立服务：`https://tex.xumin.net/svg/<URL 编码后的 TeX>`。文章和后台预览会在暗色主题下自动添加 `c=eaeaea`，让默认黑色公式变为浅色，同时保留 SVG 的透明背景和显式颜色；切回亮色主题时会自动恢复无颜色参数的地址。该逻辑只匹配 `tex.xumin.net` 的 `/svg/` 与 `/svgb/`，不会修改普通图片。

自定义页面在独立沙箱中运行，页面自己的公式预览应直接生成同一个外部地址，不要使用博客域名的 `/svg/`：

```js
const RENDER_BASE = 'https://tex.xumin.net/svg/';
const DARK_COLOR = 'eaeaea';
const darkMedia = window.matchMedia('(prefers-color-scheme: dark)');

function isDark() {
  const theme = document.documentElement.dataset.theme || 'auto';
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  const hour = new Date().getHours();
  return hour > 18 || hour < 8 || darkMedia.matches;
}

function buildUrl(tex) {
  return RENDER_BASE + encodeURIComponent((tex || '').trim());
}

function buildPreviewUrl(tex) {
  const url = new URL(buildUrl(tex));
  if (isDark()) url.searchParams.set('c', DARK_COLOR);
  return url.toString();
}

function update() {
  const canonical = buildUrl(texEl.value);
  urlEl.value = canonical;
  imgEl.src = buildPreviewUrl(texEl.value);
}

darkMedia.addEventListener?.('change', update);
new MutationObserver(update).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-theme'],
});
```

这里假设页面中已有 `texEl`、`urlEl` 与 `imgEl`。预览容器不要固定为白色背景，应使用页面的主题背景变量，例如 `background: var(--input-bg)`。自定义页面保存的是数据库内容，升级镜像不会覆盖现有页面；旧页面仍使用 `//xumin.net/svg/` 时，需要在后台编辑一次并替换为上面的地址。

升级后，如果“系统设置 → 自定义设置 → 自定义脚本”中还保留旧的 `Upmath SVG 自动适配深色模式` 代码块，请只删除该代码块，保留其他自定义脚本。文章与后台预览现在已经内置同样的精确适配，继续保留旧代码会产生两个重复的监听器。

### 编辑页面

创建完毕后，点击列表页的 `编辑内容` 或 `文件管理` ，即可跳转到代码（文件）编辑器进行编辑。

#### 多文件页面的编辑器

![页面编辑](https://pic.mereith.com/img/6d3daf7daf9a093d42e9ed34a77f0ed3.clipboard-2023-02-01.png)

首次使用，需要先上传文件或文件夹。

- 当前目录：左侧文件列表中，如果有选中的文件/文件夹，当前目录就是选中的文件所在目录，或者所选文件夹的目录。如果未选中，就是根目录。
- 上传文件夹会上传文件夹内所有文件到当前目录，保留层级关系。
- 上传文件会上传所选文件到当前目录。
- 操作菜单中的“查看”会直接打开多文件项目的目录入口。

多文件页面的上传接口不设应用层单文件字节上限，文件会先流式写入 ZweiBlog 持久化磁盘，而不是完整缓存在进程内存中。实际可上传大小仍取决于服务器可用磁盘、文件系统、浏览器、外层代理/CDN/面板的请求体限制和连接超时。官方 Nginx 模板仅对精确的 `/api/admin/customPage/upload` 路由设置 `client_max_body_size 0` 与 `proxy_request_buffering off`；自建反代也需要保留该精确规则。

#### 静态 Web App 兼容性

- 项目根目录应包含 `index.html`，子目录也可以用各自的 `index.html` 作为入口。
- 从项目入口打开时，HTML 可以使用 `./bundle.js`、`./css/app.css` 等项目相对路径。启用 SPA 深链时，浏览器会按当前深链计算相对地址；应把构建工具的 `base`/`publicPath` 设为实际的 `/c/<项目路径>/`，或在入口中设置同值的 `<base href="/c/<项目路径>/">`。以 `/assets/...` 开头的地址会访问整个站点根目录，不会自动改写到当前项目。
- 对明确接受 HTML、且最后一段不带扩展名的浏览器导航，ZweiBlog 会回退到项目根 `index.html`，因此常见的前端 SPA 深链刷新可以工作。缺失的 `.js`、`.css`、`.json`、图片和 PDF 等资源仍返回 404，不会错误返回 HTML。
- PDF、音视频和其他大文件支持 HTTP Range。隔离模式请使用链接或 `iframe`；可信兼容模式还允许从同源路径用 `object`/`embed` 展示 PDF。
- `isolated` 页面没有同源存储和凭据能力；确实依赖 `localStorage`、IndexedDB、Service Worker 或带凭据同域 API 的自编项目，应改为 `trusted` 并直接打开 `/c/...`，不要把它作为文章中的隔离 iframe 运行。

例如我上传了一整个番茄钟项目文件夹：

![上传文件夹](https://pic.mereith.com/img/34a75bdd21513d1a234807efc979bef4.clipboard-2023-02-01.png)

![上传结果](https://pic.mereith.com/img/42fea40c53a918deea6bac25d2b75ecf.clipboard-2023-02-01.png)

上传完毕后，我可以点击左侧文件列表中的某些文件，在右面的编辑器修改它们，并点击 `操作/保存` 以保存更改。

![修改文件](https://pic.mereith.com/img/b28a1b636bc952b0e90ef8f0963a4fee.clipboard-2023-02-01.png)

效果如图：

![设置效果](https://pic.mereith.com/img/bc999b2826d07e0e8e22183243c38c4c.clipboard-2023-02-01.png)

#### 单文件页面的代码编辑器

![单文件编辑](https://pic.mereith.com/img/25cc8ff491606f819cc50ecedbc7018c.clipboard-2023-02-01.png)

效果如图:

![设置效果](https://pic.mereith.com/img/3797fa90700decd37cab3983c8eac867.clipboard-2023-02-01.png)

可以在编辑器修改它们，并点击 `操作/保存` 以保存更改。

单文件页面不是文件上传接口，其 HTML 通过 JSON 保存到 MongoDB，仍受 5 MiB JSON 请求体和 MongoDB 单文档容量限制。需要保存大型二进制资源或体积较大的完整项目时，请使用多文件页面。

### 导出限制

单文件页面和多文件页面都可以导出项目。多文件页面的 ZIP 导出保留独立的资源保护：单个文件最多 256 MiB、项目未压缩总量最多 512 MiB、最多 10,000 个文件/条目、目录深度最多 64 层，同时最多执行 2 个导出。上传成功不代表一定满足导出预算；超出预算的大型项目应直接备份持久化目录中的 `data/static/customPage/`。
