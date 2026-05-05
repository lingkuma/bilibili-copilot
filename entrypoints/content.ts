import { mount, unmount } from 'svelte'
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root'
import App from './content/App.svelte'
import styles from './content/style.css?inline'

export default defineContentScript({
  matches: ['https://www.bilibili.com/video/*'],
  runAt: 'document_idle',
  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: 'bilibili-copilot-overlay',
      position: 'overlay',
      alignment: 'bottom-right',
      zIndex: 2147483647,
      css: styles,
      isolateEvents: true,
      onMount: container => mount(App, {
        target: container,
      }),
      onRemove: app => {
        if (app) {
          void unmount(app)
        }
      },
    })

    ui.mount()
  },
})
