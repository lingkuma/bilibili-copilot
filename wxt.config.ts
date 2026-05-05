import { defineConfig } from 'wxt'

export default defineConfig({
  modules: ['@wxt-dev/module-svelte'],
  manifest: {
    name: 'Bilibili Copilot',
    description: 'Summarize Bilibili videos from subtitles with your AI provider.',
    permissions: ['storage', 'tabs'],
    host_permissions: [
      'https://www.bilibili.com/*',
      'https://api.bilibili.com/*',
      'https://*.hdslb.com/*',
      'https://api.openai.com/*',
      'https://api.telegra.ph/*',
      'https://api.cloudinary.com/*',
    ],
    action: {
      default_title: 'Bilibili Copilot',
    },
  },
})
