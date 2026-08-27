# 墨舟

墨舟是一款面向微信公众号的 AI 创作与排版工作台，覆盖选题、大纲、正文、配图、质量检查和人工发布交付包。它不会连接微信公众号后台，也不会代替用户上传或群发。

## 在线体验

[打开公开版墨舟](https://mozhou-wechat-ai.johnnylu828.chatgpt.site)

无需 OpenAI 登录即可访问。GitHub 仓库中的版本化 `mozhou-source-v*.zip` 包含对应版本的完整、已验证源码；解压到仓库根目录后即可安装和运行。

## 核心能力

- 根据创作简报生成三个差异化选题角度
- 支持自主选题、参考改写，以及从社会热点榜选择选题
- 参考改写可一次粘贴最多 5 篇公开文章链接自动读取，兼容公众号、微博、今日头条和普通 Blog，也可补充粘贴全文；单篇失败不会影响其他文章导入
- 预计篇幅最低可选 `400–600 字`，发布检查会阻止不足 400 字的正文导出
- 生成可编辑的大纲与结构化正文
- 生成封面图和正文插图，并保留 `IMG-01` 等位置映射
- 内置模型设置中心，写作可选择 OpenAI、DeepSeek、Kimi 或自定义 OpenAI 兼容 API，配图可独立选择 OpenAI、自定义接口或免费本地生成
- 在手机宽度和 HTML 模式下预览排版
- 检查标题、摘要、正文、图片、来源与 AI 声明
- 复制富文本，或导出包含 HTML、Markdown、图片和清单的 ZIP 发布包
- 使用 D1 保存文章、R2 保存图片；数据按登录用户隔离

社会热点聚合微博热搜与今日头条热榜，并交替展示两个平台的话题。单一来源暂不可用时，另一来源仍可继续提供选题；热点仅作为线索，事实、版权与发布判断仍由用户人工确认。

链接导入接受公网 HTTP/HTTPS 文章，并针对公众号正文、网页结构化文章数据与常见 Blog 正文容器做提取，同时兼容微博和今日头条中服务端可读取的公开内容。系统提取标题、作者或站点名称、正文和原链接，加入当前创作的临时参考材料；这不是长期模型训练，也不会把文章变成可复用的个人知识库。本机、内网、异常端口及指向内网的跳转会被拒绝。受登录墙、平台反爬、脚本加载或删除限制的文章会标记为读取失败，仍可改用手动粘贴正文。

## 模型与 API 设置

从侧栏打开“AI 模型设置”即可分别配置文字和图片服务：

- 文字：OpenAI / ChatGPT API、DeepSeek、Kimi、自定义 OpenAI 兼容接口
- 图片：OpenAI `gpt-image-2`、自定义 OpenAI 图片兼容接口、本地排版图
- 内置连接测试；服务不可用时文字回退演示生成，图片回退本地生成
- API Key 不写入文章数据库、参考资料或发布包。默认只保留在当前浏览器会话；仅在用户主动勾选时保存到此设备的浏览器存储

“ChatGPT API”在界面中指 OpenAI API，需要单独创建 API Key，并不复用 ChatGPT 网页版登录或订阅。自定义 API 地址必须使用公网 HTTPS，已知服务商会校验官方域名。

## 本地运行

需要 Node.js `>=22.13.0`。

```bash
npm install
npm run dev
```

访问 `http://localhost:3000`。未配置 OpenAI 密钥时，应用会使用内置演示生成器，完整工作流仍可操作。

## 环境变量

复制 `.env.example` 为 `.env`，按需填写：

```bash
OPENAI_API_KEY=
OPENAI_TEXT_MODEL=gpt-5.4
OPENAI_IMAGE_MODEL=gpt-image-2
DEEPSEEK_API_KEY=
DEEPSEEK_TEXT_MODEL=deepseek-v4-flash
KIMI_API_KEY=
KIMI_TEXT_MODEL=kimi-k3
```

## 验证与数据库

```bash
npm run db:generate
npm test
npm run lint
```

Cloudflare 资源绑定定义在 `.openai/hosting.json`：D1 使用 `DB`，R2 使用 `UPLOADS`。数据库迁移位于 `drizzle/`。

产品需求文档位于 `outputs/墨舟-微信公众号AI创作排版软件-PRD-V1.1.md`。
