import type { PromptTemplate } from '../types'

export const defaultTemplates: PromptTemplate[] = [
  {
    id: 'summary',
    name: '总结视频',
    description: '提炼核心观点、结构和结论。',
    instruction: `请根据下面的 Bilibili 视频字幕生成结构化总结。

要求：
1. 用中文回答。
2. 先给出 3-6 条核心结论。
3. 再按时间顺序整理主要内容。
4. 最后列出适合复习的关键词。`,
  },
  {
    id: 'questions',
    name: '生成问题',
    description: '根据字幕创建理解题和讨论题。',
    instruction: `请根据下面的 Bilibili 视频字幕生成问题。

要求：
1. 生成 8 个理解题。
2. 生成 5 个适合深入讨论的问题。
3. 每个问题尽量对应字幕中的具体内容。`,
  },
  {
    id: 'outline',
    name: '章节大纲',
    description: '按时间线整理视频章节。',
    instruction: `请根据下面的 Bilibili 视频字幕生成章节大纲。

要求：
1. 按时间顺序划分章节。
2. 每个章节包含时间范围、标题和一句话说明。
3. 保留关键术语。`,
  },
]

export const findTemplate = (id: string) => {
  const template = defaultTemplates.find(item => item.id === id) ?? defaultTemplates[0]
  if (!template) {
    throw new Error('No prompt templates are configured.')
  }
  return template
}
