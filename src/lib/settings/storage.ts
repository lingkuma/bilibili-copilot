import { browser } from 'wxt/browser'
import type { CopilotSettings } from '../types'

const SETTINGS_KEY = 'bilibili-copilot-settings'
export const DEFAULT_TELEGRAPH_AUTHOR_URL = 'https://bilibili-copilot.lingkuma.org'

type StoredCopilotSettings = Partial<CopilotSettings> & {
  defaultTemplateId?: string
}

const decodeBase64Setting = (value: string) => {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new TextDecoder().decode(bytes)
}

export const defaultSettings: CopilotSettings = {
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-5.5',
  language: 'zh-CN',
  selectedTemplateId: 'brief-outline',
  customPromptTemplates: [],
  includeTimestamps: true,
  autoSummaryEnabled: false,
  autoCaptureAiImages: false,
  cloudinaryCloudName: decodeBase64Setting('ZGt4ODN4MGJj'),
  cloudinaryApiKey: decodeBase64Setting('ODUyNzM0OTk1MzQ3MzM3'),
  cloudinaryApiSecret: decodeBase64Setting('bWVULXYtV3V5TU1rdEJNMHBLRm5XNUlrNDBR'),
  telegraphAccessToken: '',
  telegraphShortName: 'bilibili-copilot',
  telegraphAuthorName: 'Bilibili Copilot',
  telegraphAuthorUrl: DEFAULT_TELEGRAPH_AUTHOR_URL,
  telegraphAutoOpenAfterShare: true,
  telegraphOpenInBackground: false,
  telegramAutoSendEnabled: false,
  telegramBotToken: '',
  telegramChatId: '',
}

export const loadSettings = async () => {
  const result = await browser.storage.local.get(SETTINGS_KEY)
  const stored = result[SETTINGS_KEY] as StoredCopilotSettings | undefined
  const { defaultTemplateId: legacyTemplateId, ...storedSettings } = stored ?? {}
  const settings: CopilotSettings = {
    ...defaultSettings,
    ...storedSettings,
    selectedTemplateId: stored?.selectedTemplateId ?? legacyTemplateId ?? defaultSettings.selectedTemplateId,
  }
  if (!stored || hasMissingDefaults(stored)) {
    await saveSettings(settings)
  }
  return settings
}

export const saveSettings = async (settings: CopilotSettings) => {
  await browser.storage.local.set({
    [SETTINGS_KEY]: settings,
  })
}

export const isAIConfigured = (settings: CopilotSettings) => {
  return settings.apiBaseUrl.trim().length > 0
    && settings.apiKey.trim().length > 0
    && settings.model.trim().length > 0
}

const hasMissingDefaults = (settings: Partial<CopilotSettings>) => {
  return (Object.keys(defaultSettings) as Array<keyof CopilotSettings>)
    .some(key => !(key in settings))
}
