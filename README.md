# 墨舟

墨舟是一款面向微信公众号的 AI 创作与排版工作台，覆盖选题、大纲、正文、配图、质量检查和人工发布交付包。它不会连接微信公众号后台，也不会代替用户上传或群发。

## 核心能力

- 根据创作简报生成三个差异化选题角度
- 生成可编辑的大纲与结构化正文
- 生成封面图和正文插图，并保留 `IMG-01` 等位置映射
- 在手机宽度和 HTML 模式下预览排版
- 检查标题、摘要、正文、图片、来源与 AI 声明
- 复制富文本，或导出包含 HTML、Markdown、图片和清单的 ZIP 发布包
- 使用 D1 保存文章、R2 保存图片；数据按登录用户隔离

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
```

## 验证与数据库

```bash
npm run db:generate
npm test
npm run lint
```

Cloudflare 资源绑定定义在 `.openai/hosting.json`：D1 使用 `DB`，R2 使用 `UPLOADS`。数据库迁移位于 `drizzle/`。

产品需求文档位于 `outputs/墨舟-微信公众号AI创作排版软件-PRD-V1.1.md`。
