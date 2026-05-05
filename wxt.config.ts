import { defineConfig } from 'wxt'

export default defineConfig({
  modules: ['@wxt-dev/module-svelte'],
  manifest: {
    default_locale: 'en',
    name: '__MSG_extensionName__',
    description: '__MSG_extensionDescription__',
    icons: {
      16: 'icons/icon16.png',
      32: 'icons/icon32.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    },
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
      default_icon: {
        16: 'icons/action16.png',
        24: 'icons/action24.png',
        32: 'icons/action32.png',
      },
    },
  },
})
