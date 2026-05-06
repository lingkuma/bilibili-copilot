import type { CopilotSettings, PromptTemplate, ResolvedVideo } from '../types'
import type { HistoryEntry } from '../history/types'

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
  error?: {
    message?: string
  }
}

interface ChatCompletionChunk {
  choices?: Array<{
    delta?: {
      content?: string
    }
    message?: {
      content?: string
    }
  }>
  error?: {
    message?: string
  }
}

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '')

const buildMessages = (input: {
  template: PromptTemplate
  video: ResolvedVideo
  subtitleText: string
}) => {
  const { template, video, subtitleText } = input
  return [
    {
      role: 'system',
      content: [
        '你是一个严谨的视频字幕分析助手。回答要清晰、具体、可复查。',
        '请严格使用 Markdown 输出。',
        '时间戳只能使用 [MM:SS]、[HH:MM:SS] 或 [MM:SS-MM:SS] 形式。',
        '时间戳必须对应字幕中真实出现的内容，不要编造不存在的时间点。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `${template.instruction}

视频标题：${video.title}
视频地址：${video.url}

字幕如下：

${subtitleText}`,
    },
  ]
}

const buildQuestionMessages = (input: {
  video: ResolvedVideo
  subtitleText: string
  entries: HistoryEntry[]
  question: string
}) => {
  const { video, subtitleText, entries, question } = input
  return [
    {
      role: 'system',
      content: [
        '你是一个严谨的视频字幕问答助手。必须基于用户提供的字幕、已有总结和对话回答。',
        '如果问题无法从字幕或已有对话确认，请明确说明无法从字幕判断。',
        '请使用 Markdown 输出，可以引用真实时间戳帮助用户定位。',
        '当回答需要画面辅助时，可以单独输出一行图片标签，例如：[<image>@02:18]。',
        '图片标签和时间戳必须对应字幕中真实出现或上下文可定位的片段，不要编造时间点。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `视频标题：${video.title}
视频地址：${video.url}

字幕如下：

${subtitleText}

已有总结和对话：

${renderHistoryEntriesForPrompt(entries)}

用户新问题：
${question}`,
    },
  ]
}

export const summarizeSubtitle = async (input: {
  settings: CopilotSettings
  template: PromptTemplate
  video: ResolvedVideo
  subtitleText: string
}) => {
  const { settings, template, video, subtitleText } = input
  const endpoint = `${trimTrailingSlash(settings.apiBaseUrl)}/chat/completions`

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.2,
      messages: buildMessages({ template, video, subtitleText }),
    }),
  })

  const data = await response.json() as ChatCompletionResponse
  if (!response.ok) {
    throw new Error(data.error?.message ?? `AI request failed: ${response.status}`)
  }

  const content = data.choices?.[0]?.message?.content?.trim()
  if (!content) {
    throw new Error('AI did not return any content.')
  }
  return content
}

export const summarizeSubtitleStream = async (
  input: {
    settings: CopilotSettings
    template: PromptTemplate
    video: ResolvedVideo
    subtitleText: string
    signal?: AbortSignal
  },
  onDelta: (content: string) => void,
) => {
  const { settings, template, video, subtitleText, signal } = input
  const endpoint = `${trimTrailingSlash(settings.apiBaseUrl)}/chat/completions`

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.2,
      stream: true,
      messages: buildMessages({ template, video, subtitleText }),
    }),
    signal,
  })

  if (!response.ok) {
    const message = await readErrorMessage(response)
    throw new Error(message ?? `AI request failed: ${response.status}`)
  }

  if (!response.body) {
    throw new Error('AI response did not include a stream.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullContent = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''

    for (const event of events) {
      const delta = parseStreamEvent(event)
      if (!delta) {
        continue
      }
      fullContent += delta
      onDelta(delta)
    }
  }

  buffer += decoder.decode()
  const remaining = parseStreamEvent(buffer)
  if (remaining) {
    fullContent += remaining
    onDelta(remaining)
  }

  return fullContent.trim()
}

export const answerSubtitleQuestion = async (input: {
  settings: CopilotSettings
  video: ResolvedVideo
  subtitleText: string
  entries: HistoryEntry[]
  question: string
}) => {
  const { settings, video, subtitleText, entries, question } = input
  const endpoint = `${trimTrailingSlash(settings.apiBaseUrl)}/chat/completions`

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.2,
      messages: buildQuestionMessages({
        video,
        subtitleText,
        entries,
        question,
      }),
    }),
  })

  const data = await response.json() as ChatCompletionResponse
  if (!response.ok) {
    throw new Error(data.error?.message ?? `AI request failed: ${response.status}`)
  }

  const content = data.choices?.[0]?.message?.content?.trim()
  if (!content) {
    throw new Error('AI did not return any content.')
  }
  return content
}

const renderHistoryEntriesForPrompt = (entries: HistoryEntry[]) => {
  if (entries.length === 0) {
    return '（暂无）'
  }

  return entries
    .map(entry => {
      if (entry.kind === 'summary') {
        return `总结：\n${entry.content}`
      }

      const role = entry.role === 'user' ? '用户' : 'AI'
      return `${role}：\n${entry.content}`
    })
    .join('\n\n---\n\n')
}

const readErrorMessage = async (response: Response) => {
  const text = await response.text()
  try {
    const data = JSON.parse(text) as ChatCompletionResponse
    return data.error?.message
  } catch {
    return text || undefined
  }
}

const parseStreamEvent = (event: string) => {
  const dataLines = event
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice('data:'.length).trim())

  let content = ''
  for (const dataLine of dataLines) {
    if (!dataLine || dataLine === '[DONE]') {
      continue
    }

    const chunk = JSON.parse(dataLine) as ChatCompletionChunk
    if (chunk.error?.message) {
      throw new Error(chunk.error.message)
    }

    content += chunk.choices?.[0]?.delta?.content
      ?? chunk.choices?.[0]?.message?.content
      ?? ''
  }

  return content
}
