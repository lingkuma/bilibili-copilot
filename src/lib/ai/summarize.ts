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

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '')

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
      messages: [
        {
          role: 'system',
          content: '你是一个严谨的视频字幕分析助手。回答要清晰、具体、可复查。',
        },
        {
          role: 'user',
          content: `${template.instruction}

视频标题：${video.title}
视频地址：${video.url}

字幕如下：

${subtitleText}`,
        },
      ],
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
