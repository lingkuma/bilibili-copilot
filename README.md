# bilibili-copilot

<p align="center">
  <img src="public/icons/icon128.png" alt="bilibili-copilot icon" width="128" height="128">
</p>

bilibili AI 视频总结助手，一个面向 Bilibili 视频页的浏览器扩展。它会读取当前视频字幕，并调用兼容 OpenAI Chat Completions 接口的模型生成结构化 Markdown 总结。

English version: [README.en.md](README.en.md)

## 核心功能

- **AI 流式总结字幕**：支持配置 API Base URL、API Key 和模型名称，按字幕内容生成实时流式输出的 Markdown 总结。
- **持续对话，历史记录**：总结后支持持续多轮对话，历史记录。
- **OpenAI 兼容配置**：支持配置 API Base URL、API Key、模型名称、字幕语言偏好和总结模板。
- **时间戳交互**：AI 输出中的时间戳会渲染成可点击按钮，点击后可直接跳转到视频对应时间点。
- **关键画面插图**：支持 AI 在总结中标记代表画面，也可以手动为章节插入截图，并对截图时间点进行微调、重新获取或删除。
- **本地导出**：支持将 Markdown 和截图资源打包为 ZIP 导出。
- **在线分享**：内置 Cloudinary 图床上传流程，可将总结发布到 Telegraph。

## 环境要求

- Node.js
- npm
- 用于本地测试扩展的 Chromium 系浏览器
- 有可访问字幕的 Bilibili 视频
- 兼容 OpenAI Chat Completions 的 API Key 和接口地址

## 开发

安装依赖：

```bash
npm install
```

启动开发模式：

```bash
npm run dev
```

构建 Chrome MV3 扩展：

```bash
npm run build
```

运行类型和 Svelte 检查：

```bash
npm run check
```

生成可发布的 ZIP：

```bash
npm run zip
```

## 加载扩展

1. 运行 `npm run build`。
2. 打开 `chrome://extensions`。
3. 开启「开发者模式」。
4. 点击「加载已解压的扩展程序」。
5. 选择 `.output/chrome-mv3`。

## 使用方式

1. 打开一个 Bilibili 视频页面。
2. 打开 Bilibili Copilot 的浮层或 popup。
3. 配置 AI 服务商参数。
4. 获取字幕并生成总结。
5. 将总结导出到本地，或分享到 Telegraph。

## 局限

- 仅支持有字幕的视频。
- 如果总结中包含截图，分享到 Telegraph 时需要配置 Cloudinary 凭证。

## 技术栈

- WXT
- Svelte
- TypeScript
- Chrome Extension Manifest V3
