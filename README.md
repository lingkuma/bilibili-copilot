# [bilibili-copilot](https://github.com/lingkuma/bilibili-copilot)

<p align="center">
  <img src="public/icons/icon128.png" alt="bilibili-copilot icon" width="128" height="128">
</p>

bilibili AI 视频总结助手，一个面向 Bilibili 视频页的浏览器扩展。它会读取当前视频字幕，并调用兼容 OpenAI Chat Completions 接口的模型生成结构化 Markdown 总结。


<p align="center">
  <img src="site/assets/demo.png" alt="bilibili-copilot demo" >
</p>


English version: [README.en.md](README.en.md)


## 核心功能

- **AI 总结，持续对话，**
- **时间戳交互**
- **关键画面插图**
- **本地导出**
- **Telegraph/tg bot 分享**



## 邀请奖励，帮助项目持续开发
本项目使用 [0-0 AI-API 中转平台](https://0-0.pro/register?ref=75RRBBR3) 完成，Gemini/Claude/GPT 最高0.1折优惠。
点击链接注册，或使用邀请码：75RRBBR3，首充双方获得25%返利，感谢助力开发。
(本项目和该平台无任何关系，仅作邀请奖励，支撑开发消费)

## 🙏 致谢

感谢真诚、友善、团结、专业的 Linuxdo 社区，让我学到那么多有关ai相关知识。

<p>
  <a href="https://linux.do">
    <img src="https://img.shields.io/badge/LinuxDo-community-1f6feb" alt="LinuxDo">
  </a>
</p>

- [LinuxDo](https://linux.do) 学 ai, 上 L 站!


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
