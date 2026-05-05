import { browser } from 'wxt/browser'
import type { CopilotSettings } from '../types'

const SETTINGS_KEY = 'bilibili-copilot-settings'

export const defaultSettings: CopilotSettings = {
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4.1-mini',
  language: 'zh-CN',
  defaultTemplateId: 'summary',
  includeTimestamps: true,
  autoSummaryEnabled: false,
}

export const loadSettings = async () => {
  const result = await browser.storage.local.get(SETTINGS_KEY)
  return {
    ...defaultSettings,
    ...(result[SETTINGS_KEY] as Partial<CopilotSettings> | undefined),
  }
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
