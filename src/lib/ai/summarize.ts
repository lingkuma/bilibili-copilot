import type { CopilotSettings, PromptTemplate, ResolvedVideo } from '../types'

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
