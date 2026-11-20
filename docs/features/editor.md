---
title: 编辑器
icon: keyboard
order: 3
---

ZweiBlog 后台内置了 [bytemd](https://github.com/bytedance/bytemd)（掘金同款） 作为 `Markdown` 编辑器：

![编辑器](https://www.mereith.com/static/img/e0ce4ddda865c9b7827983a219468599.clipboard-2022-09-06.png)

编辑器支持:

- Emoji

  ![Emoji 按钮](https://www.mereith.com/static/img/42353fbbc0660940e238c4da9b8017cf.clipboard-2022-09-08.png)

- 自定义容器

  ![自定义容器](https://www.mereith.com/static/img/9880f893a308699193671ff3b74f246c.clipboard-2022-09-07.png)

- 数学公式

  ::: info 数学公式语法速查

  - [使用 Markdown 输出 LaTex 数学公式](https://zhuanlan.zhihu.com/p/59412540)

  :::

- Mermaid 图表

  ::: info 图表语法速查

  - [Mermaid 从入门到入土——Markdown 进阶语法](https://zhuanlan.zhihu.com/p/355997933)

  :::

- 上传图片到图床

  编辑器支持两种方式上传到图床：

  - 剪切板快捷上传
  - 从文件上传

  点击编辑器工具栏按钮后，后在当前焦点处插入上传后的图片并复制图片链接到剪切板，如果没有焦点就会上传到最上面。

  另外图床支持添加水印，可以在上传的时候自动添加文字水印。请参考：[分类管理](./tag.md#分类管理)

  ![上传图片](https://pic.mereith.com/img/0a54a1e4fe8ac47cea8fa7aea89964ca.clipboard-2022-08-29.png)

- 一键插入 `more` 标记

  `more` 标记是下面代码的简写，会被用来分割文章摘要。

  ```md
  <!-- more -->
  ```

  你可以点击工具栏最后第一个按钮快速在当前焦点插入 more 标记。

  ![一键插入 more 标记](https://pic.mereith.com/img/59550a500ed84dea504f897dbe12ed07.clipboard-2022-08-29.png)

  ![文章摘要](https://pic.mereith.com/img/b613474a616f7e2b714735cb79aeff6a.clipboard-2022-08-15.png)

  ::: note 文章摘要是博客前台预览卡片中`阅读全文`之前的内容。

  :::

- 自动保存

  编辑文章时会自动实时保存内容到本地缓存，此功能默认关闭，可在编辑器右上角下拉菜单中的 `偏好设置` 中开启。

  即使没有点击保存按钮就退出了编辑器，下次进入后也会自动恢复上次的状态。

  ![自动保存](https://pic.mereith.com/img/85fa1dc72226c92b7b176cc40690999d.clipboard-2022-08-31.png)

![开启自动保存](https://pic.mereith.com/img/83e5a9815d0538447ef2fa97fe9c875d.clipboard-2023-06-27.webp)

- 快捷键

  点击编辑器帮助按钮会显示 Markdown 语法与快捷键信息：

  ![快捷键提示](https://pic.mereith.com/img/cabe5cdfddeedbd6e592f7aaea2f4afc.clipboard-2022-08-29.png)

## 嵌入 Bilibili 视频

在文章、关于页或友情链接页的 Markdown 正文中粘贴下面这行 HTML，不要用代码块包裹：

```html
<iframe src="https://player.bilibili.com/player.html?bvid=BV1B7411m7LV" title="视频标题"></iframe>
```

将示例中的 `BV1B7411m7LV` 换成目标视频链接里的 BV 号，并填写视频标题。也可以粘贴 Bilibili「分享 → 嵌入代码」提供的 `player.bilibili.com/player.html` iframe；以 `//` 开头的播放器地址会自动转换为 HTTPS。普通视频页链接或 `b23.tv` 短链接不能直接作为 iframe 地址。

后台预览与博客前台都会显示宽度自适应、比例为 16:9 的播放器。默认显示封面，点击播放器中的播放按钮开始播放，并支持全屏；即使原始嵌入代码设置了自动播放，ZweiBlog 也会关闭它。播放器使用懒加载，进入可视区域附近时可能提前请求 Bilibili，不代表点击前完全不加载。

多 P 视频可添加 `&p=2` 指定第二集；有 `cid` 时以 `cid` 为准。还支持 `aid`、`cid`、`t`（起始秒数）和 `danmaku=0`（关闭弹幕）。参数含义见 [Bilibili 官方外链播放器文档](https://player.bilibili.com/)。播放可用性与清晰度由 Bilibili 决定。

例如，可以在播放器下面加一个普通链接，便于读者打开原视频：

```markdown
[在 Bilibili 打开视频](https://www.bilibili.com/video/BV1B7411m7LV/)
```

此功能需重新构建、部署 website 和 admin 后生效。文章中嵌入的站内 `/c/` 自定义页面继续使用原有隔离规则；评论不支持 iframe，RSS 不嵌入播放器。

## HTML 样式白名单

文章、关于页和友情链接页中的内嵌 HTML 可以使用下列行内样式，后台预览与前台使用相同规则。评论仍按 Markdown 格式处理，不开放原生 HTML。iframe 保持单独的尺寸和边框规则。

| 用途 | 支持的属性和值示例 |
| --- | --- |
| 颜色和纯色背景 | `color`、`background-color`、纯色 `background`；标准命名颜色、`transparent`、`currentColor`、3/4/6/8 位十六进制、数字形式的 `rgb()/rgba()/hsl()/hsla()` |
| 字体和行距 | `font-size`、`font-weight`、`font-style`、`font-variant:small-caps`、`line-height`、`letter-spacing`、`word-spacing`；`font-family` 支持通用字体族及 Arial、Helvetica、Verdana、Georgia、Tahoma，可用逗号组合 |
| 文字排版 | `text-align`、`text-indent`、`text-decoration` 及其 line/style/color/thickness 子属性、`text-transform`、`vertical-align`、`white-space`、`overflow-wrap`、`word-break`、`hyphens`、`text-overflow` |
| 边框和圆角 | `border:1px solid #ddd`、四边的 border 子属性、`border-color/style/width`、`border-radius` 及四个角的圆角；边框简写按宽度、线型、颜色的顺序书写 |
| 尺寸和间距 | width/height、inline-size/block-size 及 min/max 变体；margin/padding 和四边、逻辑方向变体；`box-sizing`、`overflow`、`aspect-ratio` |
| Flex 布局 | `display:flex/inline-flex`、`flex`、`flex-basis/grow/shrink/direction/wrap/flow`、`order`、justify/align 的 content/items/self 属性、gap/row-gap/column-gap |
| Grid 布局 | `display:grid/inline-grid`、`grid-template-columns/rows`、`grid-auto-columns/rows/flow`、`grid-column/row` 及 start/end；支持数字 fr、`minmax()` 和 1–12 次的 `repeat()`，每个模板最多 12 项，不支持嵌套或自动重复 |
| 图片、列表和表格 | `object-fit/position`、`float`、`clear`、`list-style-type/position`、`table-layout`、`border-collapse/spacing`、`caption-side`、`empty-cells` |
| 公式箭头 | `transform:rotate(90deg)` 等 0/90/180/270/360 度旋转，支持对应负角度 |

例如，使用两列卡片和文字强调：

```html
<div style="display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:1rem;">
  <div style="background-color:#eef6ff; border:1px solid #93c5fd; border-radius:8px; padding:1rem;">
    <strong style="color:navy; font-size:1.25rem;">第一张卡片</strong>
    <p style="line-height:1.8;">正常排版的正文。</p>
  </div>
  <div style="background-color:rgb(240 253 244); border:1px solid seagreen; padding:1rem;">
    <mark style="background-color:#fef08a; color:#333;">重点内容</mark>
    <u style="text-decoration-color:teal;">带颜色的下划线</u>
  </div>
</div>
```

这些样式也适用于 `strong`、`em`、`mark`、`u`、`small`、`sub`、`sup` 等正文标签。一般长度使用非负值，可用 px、rem、em、%、vw、vh、vmin、vmax、ch、ex；边框宽度和字间距等属性不接受百分比。数字最多 4 位整数、3 位小数；每个 style 属性最多 4096 字符、64 条声明。

任意一条声明不符合规则时，会移除该元素的整个 style 属性。URL、背景图片、CSS 变量、`calc()`、`!important`、CSS 注释和转义、定位及 z-index、动画、缩放和平移均不在本白名单内。RGB/HSL 只接受直接数字和百分比，不接受相对颜色或嵌套表达式。需要完整网页布局时，可使用隔离的自定义页面。

颜色语法可参考 [MDN 命名颜色](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/named-color)和 [RGB 颜色](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/color_value/rgb)，Grid 数值写法可参考 [MDN 网格列定义](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/grid-template-columns)。本文列出的子集才是 ZweiBlog 实际支持的范围。

## 更多功能

### 导入

点击右上角操作按钮，选择 `导入内容`，选中需要导入的 Markdown 文件即可。

![导入 Markdown](https://pic.mereith.com/img/4218768fe6d1c8d69433bde3fd98c01b.clipboard-2022-08-30.png)

### 导出

点击右上角操作按钮，选择 `导出`，即可导出为 Markdown 文件，相关数据会自动放置到 FrontMatter 中。

![导出 Markdown](https://www.mereith.com/static/img/52495adf0928d2034159a398cbc7e050.clipboard-2022-09-06.png)

### 修改信息

点击右上角操作按钮，选择 `修改信息`，即可对当前编辑的 `文章/草稿` 的信息就行修改。

![修改信息](https://www.mereith.com/static/img/52495adf0928d2034159a398cbc7e050.clipboard-2022-09-06.png)

### 保存快捷键

<kbd>Ctrl</kbd> + <kbd>S</kbd> 可以保存文章/草稿

## 偏好设置

编辑器现在支持偏好设置，未来将支持更多选项：

![偏好设置](https://www.mereith.com/static/img/52495adf0928d2034159a398cbc7e050.clipboard-2022-09-06.png)

![偏好设置](https://pic.mereith.com/img/83e5a9815d0538447ef2fa97fe9c875d.clipboard-2023-06-27.webp)

::: note

此设置保存在浏览器的 `LocalStorage` 中，切换设备需重新设置。

:::
