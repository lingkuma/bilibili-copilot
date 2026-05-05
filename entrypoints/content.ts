import { browser } from 'wxt/browser'
import { extractBvidFromUrl, extractPageFromUrl, stripBilibiliTitleSuffix } from '../src/lib/bilibili/video'
import type { RuntimeMessage } from '../src/lib/messages'
import type { DetectedVideo } from '../src/lib/types'

let lastUrl = ''
let host: HTMLDivElement | null = null

export default defineContentScript({
  matches: ['https://www.bilibili.com/video/*'],
  runAt: 'document_idle',
  main() {
    detectAndReport()
    window.setInterval(() => {
      if (location.href !== lastUrl) {
        detectAndReport()
      }
    }, 1000)
  },
})

const detectAndReport = () => {
  lastUrl = location.href
  const video = detectVideo()
  if (!video.bvid) {
    host?.remove()
    host = null
    return
  }

  ensureFloatingButton()
  void browser.runtime.sendMessage({
    type: 'VIDEO_DETECTED',
    video,
  } satisfies RuntimeMessage)
}

const detectVideo = (): DetectedVideo => ({
  bvid: extractBvidFromUrl(location.href),
  page: extractPageFromUrl(location.href),
  title: stripBilibiliTitleSuffix(document.title),
  url: location.href,
})

const ensureFloatingButton = () => {
  if (host) {
    return
  }

  host = document.createElement('div')
  host.id = 'bilibili-copilot-entry'
  const shadow = host.attachShadow({ mode: 'closed' })

  const style = document.createElement('style')
  style.textContent = `
    :host {
      all: initial;
    }

    .entry {
      position: fixed;
      right: 24px;
      bottom: 96px;
      z-index: 2147483647;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      height: 40px;
      padding: 0 14px;
      border: 1px solid #e6dfd8;
      border-radius: 999px;
      background: #faf9f5;
      color: #141413;
      box-shadow: 0 8px 24px rgba(20, 20, 19, 0.14);
      font: 500 14px/1 Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      cursor: pointer;
    }

    .entry:hover {
      background: #efe9de;
    }

    .mark {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #cc785c;
    }
  `

  const button = document.createElement('button')
  button.className = 'entry'
  button.type = 'button'
  button.innerHTML = '<span class="mark"></span><span>总结</span>'
  button.addEventListener('click', () => {
    void browser.runtime.sendMessage({
      type: 'OPEN_SIDE_PANEL',
    } satisfies RuntimeMessage)
  })

  shadow.append(style, button)
  document.documentElement.append(host)
}
