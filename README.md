# bilibili-copilot

bilibili AI 视频总结助手，一个面向 Bilibili 视频页的浏览器扩展。它会读取当前视频字幕，并调用兼容 OpenAI Chat Completions 接口的模型生成结构化 Markdown 总结。

## 核心功能
- **AI 流式总结字幕**：支持配置 API Base URL、API Key 和模型名称，按字幕内容生成实时流式输出的 Markdown 总结。
- **时间戳交互**：AI 输出中的时间戳会渲染成可点击按钮，点击后可直接跳转到视频对应时间点。
- **关键画面插图**：支持 AI 在总结中标记代表画面，也可以手动为章节插入截图，并对截图时间点进行微调、重新获取或删除。
- **本地+在线导出**：本地asset+md导出。内置cloudinary图床，可导出到Telegraph。
## 局限
- 仅支持有字幕的视频
- 目前无法持续对话