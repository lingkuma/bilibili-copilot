import { browser } from 'wxt/browser'
import type { AIProviderConfig, CopilotSettings } from '../types'

const SETTINGS_KEY = 'bilibili-copilot-settings'
export const DEFAULT_TELEGRAPH_AUTHOR_URL = 'https://bilibili-copilot.lingkuma.org'
const DEFAULT_AI_PROVIDER_ID = 'openai-default'

const createDefaultAIProvider = (): AIProviderConfig => ({
  id: DEFAULT_AI_PROVIDER_ID,
  name: 'OpenAI',
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-5.5',
})

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
  aiProviders: [createDefaultAIProvider()],
  selectedAiProviderId: DEFAULT_AI_PROVIDER_ID,
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
  const settings = normalizeSettings({
    ...defaultSettings,
    ...storedSettings,
    aiProviders: stored?.aiProviders ?? [],
    selectedAiProviderId: stored?.selectedAiProviderId ?? '',
    selectedTemplateId: stored?.selectedTemplateId ?? legacyTemplateId ?? defaultSettings.selectedTemplateId,
  })
  if (!stored || hasMissingDefaults(stored)) {
    await saveSettings(settings)
  }
  return settings
}

export const saveSettings = async (settings: CopilotSettings) => {
  const normalizedSettings = normalizeSettings(settings)
  await browser.storage.local.set({
    [SETTINGS_KEY]: normalizedSettings,
  })
}

export const isAIConfigured = (settings: CopilotSettings) => {
  const provider = getActiveAIProvider(settings)
  return provider.apiBaseUrl.trim().length > 0
    && provider.apiKey.trim().length > 0
    && provider.model.trim().length > 0
}

const hasMissingDefaults = (settings: Partial<CopilotSettings>) => {
  return (Object.keys(defaultSettings) as Array<keyof CopilotSettings>)
    .some(key => !(key in settings))
}

export const getActiveAIProvider = (settings: CopilotSettings): AIProviderConfig => {
  return settings.aiProviders.find(provider => provider.id === settings.selectedAiProviderId)
    ?? settings.aiProviders[0]
    ?? createDefaultAIProvider()
}

const normalizeSettings = (settings: CopilotSettings): CopilotSettings => {
  const aiProviders = normalizeAIProviders(settings)
  const fallbackProvider = aiProviders[0] ?? createDefaultAIProvider()
  const selectedAiProviderId = aiProviders.some(provider => provider.id === settings.selectedAiProviderId)
    ? settings.selectedAiProviderId
    : fallbackProvider.id
  const activeProvider = aiProviders.find(provider => provider.id === selectedAiProviderId) ?? fallbackProvider

  return {
    ...settings,
    aiProviders,
    selectedAiProviderId,
    apiBaseUrl: activeProvider.apiBaseUrl,
    apiKey: activeProvider.apiKey,
    model: activeProvider.model,
  }
}

const normalizeAIProviders = (settings: CopilotSettings) => {
  const storedProviders = Array.isArray(settings.aiProviders) ? settings.aiProviders : []
  const providers = storedProviders
    .map((provider, index) => normalizeAIProvider(provider, index))
    .filter((provider): provider is AIProviderConfig => provider !== null)

  if (providers.length > 0) {
    return dedupeProviderIds(providers)
  }

  return [
    {
      id: DEFAULT_AI_PROVIDER_ID,
      name: 'OpenAI',
      apiBaseUrl: settings.apiBaseUrl || defaultSettings.apiBaseUrl,
      apiKey: settings.apiKey || defaultSettings.apiKey,
      model: settings.model || defaultSettings.model,
    },
  ]
}

const normalizeAIProvider = (
  provider: Partial<AIProviderConfig> | undefined,
  index: number,
): AIProviderConfig | null => {
  if (!provider) {
    return null
  }

  return {
    id: provider.id?.trim() || createProviderId(index),
    name: (provider.name || `Provider ${index + 1}`).trim(),
    apiBaseUrl: provider.apiBaseUrl ?? '',
    apiKey: provider.apiKey ?? '',
    model: provider.model ?? '',
  }
}

const dedupeProviderIds = (providers: AIProviderConfig[]) => {
  const seen = new Set<string>()
  return providers.map((provider, index) => {
    if (!seen.has(provider.id)) {
      seen.add(provider.id)
      return provider
    }

    const id = createProviderId(index)
    seen.add(id)
    return {
      ...provider,
      id,
    }
  })
}

const createProviderId = (index: number) => `provider-${Date.now().toString(36)}-${index}`
