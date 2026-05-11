export interface DetectedVideo {
  aid?: number
  bvid?: string
  cid?: number
  page?: number
  title?: string
  url: string
}

export interface ResolvedVideo {
  aid: number
  bvid: string
  cid: number
  page: number
  title: string
  url: string
}

export interface SubtitleInfo {
  id: number
  id_str: string
  lan: string
  lan_doc: string
  is_lock: boolean
  subtitle_url: string
  type: number
  ai_type: number
  ai_status: number
}

export interface SubtitleItem {
  from: number
  to: number
  location: number
  content: string
}

export interface SubtitleForAI {
  available: boolean
  reason: string
  subtitles: SubtitleInfo[]
  selected: SubtitleInfo | null
  body: SubtitleItem[]
  text: string
}

export interface AIProviderConfig {
  id: string
  name: string
  apiBaseUrl: string
  apiKey: string
  model: string
}

export interface CopilotSettings {
  apiBaseUrl: string
  apiKey: string
  model: string
  aiProviders: AIProviderConfig[]
  selectedAiProviderId: string
  language: string
  selectedTemplateId: string
  customPromptTemplates: PromptTemplate[]
  includeTimestamps: boolean
  autoSummaryEnabled: boolean
  autoCaptureAiImages: boolean
  cloudinaryCloudName: string
  cloudinaryApiKey: string
  cloudinaryApiSecret: string
  telegraphAccessToken: string
  telegraphShortName: string
  telegraphAuthorName: string
  telegraphAuthorUrl: string
  telegraphAutoOpenAfterShare: boolean
  telegraphOpenInBackground: boolean
  telegramAutoSendEnabled: boolean
  telegramBotToken: string
  telegramChatId: string
}

export interface PromptTemplate {
  id: string
  name: string
  description: string
  instruction: string
}
