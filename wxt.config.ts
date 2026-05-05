import { defineConfig } from 'wxt'

export default defineConfig({
  modules: ['@wxt-dev/module-svelte'],
  manifest: {
    default_locale: 'en',
    name: '__MSG_extensionName__',
    description: '__MSG_extensionDescription__',
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
      default_title: '__MSG_extensionName__',
    },
  },
})
