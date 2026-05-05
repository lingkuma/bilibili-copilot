import type { PromptTemplate } from '../types'

export const defaultTemplates: PromptTemplate[] = [
  {
    id: 'summary',
    name: '总结视频',
    description: '提炼核心观点、结构和结论。',
    instruction: `请根据下面的 Bilibili 视频字幕生成结构化 Markdown 总结。

要求：
1. 用中文回答。
2. 必须使用下面的结构：
   # 视频总结
   ## 核心结论
   ## 时间线大纲
   ## 关键概念
   ## 可追问问题
3. 时间线大纲必须从头到尾组织成章节，每个章节标题必须以时间戳开头，例如：### [02:15] 标题。
4. 所有时间点必须使用 [MM:SS] 或 [HH:MM:SS] 格式；时间范围可使用 [MM:SS-MM:SS]。
5. 如果某个章节适合展示关键画面，可在该章节标题下方单独输出一行图片标签，例如：[<image>@02:18]。
6. 图片标签必须独占一行，每个章节最多 1 个，全文最多 4 个。
7. 不要输出 JSON，不要使用表格。`,
  },
  {
    id: 'questions',
    name: '生成问题',
    description: '根据字幕创建理解题和讨论题。',
    instruction: `请根据下面的 Bilibili 视频字幕生成 Markdown 格式的问题清单。

要求：
1. 必须使用下面的结构：
   # 视频问题
   ## 理解题
   ## 深入讨论
   ## 对应片段
2. 每个问题尽量带上对应时间点，例如：[03:20] 问题内容。
3. 所有时间点必须使用 [MM:SS] 或 [HH:MM:SS] 格式；时间范围可使用 [MM:SS-MM:SS]。
4. 如果某个问题需要参考画面，可在问题下方单独输出一行图片标签，例如：[<image>@03:20]。
5. 图片标签必须独占一行，全文最多 3 个。
6. 不要输出 JSON，不要使用表格。`,
  },
  {
    id: 'outline',
    name: '章节大纲',
    description: '按时间线整理视频章节。',
    instruction: `请根据下面的 Bilibili 视频字幕生成 Markdown 章节大纲。

要求：
1. 必须使用下面的结构：
   # 章节大纲
   ## 时间线
   ## 关键概念
2. 时间线中的每个小节必须按顺序使用三级标题，例如：### [00:42] 标题。
3. 每个章节包含时间点或时间范围、标题和一句话说明。
4. 所有时间点必须使用 [MM:SS] 或 [HH:MM:SS] 格式；时间范围可使用 [MM:SS-MM:SS]。
5. 如果某个章节适合展示关键画面，可在该章节标题下方单独输出一行图片标签，例如：[<image>@00:42]。
6. 图片标签必须独占一行，每个章节最多 1 个，全文最多 5 个。
7. 不要输出 JSON，不要使用表格。`,
  },
]

export const findTemplate = (id: string) => {
  const template = defaultTemplates.find(item => item.id === id) ?? defaultTemplates[0]
  if (!template) {
    throw new Error('No prompt templates are configured.')
  }
  return template
}
