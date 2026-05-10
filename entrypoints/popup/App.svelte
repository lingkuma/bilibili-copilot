<script lang="ts">
  import { onMount } from 'svelte'
  import { browser } from 'wxt/browser'
  import type { RuntimeResponse } from '../../src/lib/messages'
  import type { ResolvedVideo } from '../../src/lib/types'

  let video = $state<ResolvedVideo | null>(null)
  let error = $state('')

  const links = [
    {
      label: '官网',
      description: '查看功能介绍与使用入口',
      href: 'https://bilibili-copilot.lingkuma.org/',
    },
    {
      label: 'GitHub',
      description: '查看源码、版本和 issue',
      href: 'https://github.com/lingkuma/bilibili-copilot',
    },
    {
      label: '官方群',
      description: '加入 Telegram 群交流反馈',
      href: 'https://t.me/LingFishing',
    },
  ]

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
</script>

<main class="popup">
  <header>
    <p>Bilibili Copilot</p>
    <h1>在视频页右下角触发插件</h1>
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

  <nav class="links" aria-label="项目链接">
    {#each links as link}
      <a href={link.href} target="_blank" rel="noreferrer">
        <span>{link.label}</span>
        <small>{link.description}</small>
      </a>
    {/each}
  </nav>
</main>
