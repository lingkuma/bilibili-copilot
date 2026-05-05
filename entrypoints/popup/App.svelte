<script lang="ts">
  import { onMount } from 'svelte'
  import { browser } from 'wxt/browser'
  import type { RuntimeResponse } from '../../src/lib/messages'
  import type { ResolvedVideo } from '../../src/lib/types'

  let video = $state<ResolvedVideo | null>(null)
  let error = $state('')

  onMount(() => {
    void loadCurrentVideo()
  })

  const loadCurrentVideo = async () => {
    try {
      const response = await browser.runtime.sendMessage({
        type: 'GET_CURRENT_VIDEO',
      }) as RuntimeResponse<ResolvedVideo>
      if (!response.ok) {
        throw new Error(response.error ?? '未检测到视频。')
      }
      video = response.data ?? null
    } catch (currentError) {
      error = currentError instanceof Error ? currentError.message : String(currentError)
    }
  }

  const sendToActiveTab = async (type: 'OPEN_FLOATING_PANEL' | 'OPEN_FLOATING_SETTINGS') => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
    if (tab?.id !== undefined) {
      await browser.tabs.sendMessage(tab.id, { type })
      window.close()
    }
  }
</script>

<main class="popup">
  <header>
    <p>Bilibili Copilot</p>
    <h1>视频字幕助手</h1>
  </header>

  {#if video}
    <section class="status">
      <span class="dot"></span>
      <div>
        <strong>{video.title}</strong>
        <p>已识别当前视频</p>
      </div>
    </section>
  {:else}
    <section class="status muted">
      <span class="dot"></span>
      <div>
        <strong>未识别到视频</strong>
        <p>{error || '请切换到 Bilibili 视频页。'}</p>
      </div>
    </section>
  {/if}

  <div class="actions">
    <button class="primary" type="button" onclick={() => void sendToActiveTab('OPEN_FLOATING_PANEL')}>打开浮窗</button>
    <button class="secondary" type="button" onclick={() => void sendToActiveTab('OPEN_FLOATING_SETTINGS')}>设置</button>
  </div>
</main>
