<script lang="ts">
  import { onMount } from 'svelte'
  import { browser } from 'wxt/browser'
  import { defaultTemplates } from '../../src/lib/ai/prompts'
  import type { RuntimeResponse } from '../../src/lib/messages'
  import type { ResolvedVideo, SubtitleForAI } from '../../src/lib/types'

  interface SubtitlePayload {
    video: ResolvedVideo
    subtitle: SubtitleForAI
  }

  interface SummaryPayload extends SubtitlePayload {
    summary: string
  }

  let video = $state<ResolvedVideo | null>(null)
  let subtitle = $state<SubtitleForAI | null>(null)
  let summary = $state('')
  let selectedTemplateId = $state('summary')
  let loading = $state(false)
  let error = $state('')

  onMount(() => {
    void refreshSubtitle()
  })

  const unwrap = <T,>(response: RuntimeResponse<T>) => {
    if (!response.ok) {
      throw new Error(response.error ?? '操作失败。')
    }
    return response.data as T
  }

  const refreshSubtitle = async () => {
    loading = true
    error = ''
    try {
      const response = await browser.runtime.sendMessage({
        type: 'GET_SUBTITLE_CURRENT_VIDEO',
      }) as RuntimeResponse<SubtitlePayload>
      const payload = unwrap(response)
      video = payload.video
      subtitle = payload.subtitle
    } catch (currentError) {
      error = currentError instanceof Error ? currentError.message : String(currentError)
    } finally {
      loading = false
    }
  }

  const summarize = async () => {
    loading = true
    error = ''
    summary = ''
    try {
      const response = await browser.runtime.sendMessage({
        type: 'SUMMARIZE_CURRENT_VIDEO',
        templateId: selectedTemplateId,
      }) as RuntimeResponse<SummaryPayload>
      const payload = unwrap(response)
      video = payload.video
      subtitle = payload.subtitle
      summary = payload.summary
    } catch (currentError) {
      error = currentError instanceof Error ? currentError.message : String(currentError)
    } finally {
      loading = false
    }
  }

  const openOptions = () => {
    void browser.runtime.openOptionsPage()
  }
</script>

<main class="panel">
  <header class="header">
    <div>
      <p class="eyebrow">Bilibili Copilot</p>
      <h1>字幕总结</h1>
    </div>
    <button class="icon-button" type="button" title="设置" onclick={openOptions}>设置</button>
  </header>

  <section class="content">
    {#if video}
      <div class="video-block">
        <p class="label">当前视频</p>
        <h2>{video.title}</h2>
        <p class="meta">BV: {video.bvid} · P{video.page} · CID: {video.cid}</p>
      </div>
    {:else}
      <div class="empty">
        <h2>未检测到视频</h2>
        <p>请在 Bilibili 视频页打开侧边栏，或点击页面中的“总结”入口。</p>
      </div>
    {/if}

    {#if subtitle?.available}
      <div class="subtitle-status">
        <div>
          <p class="label">字幕</p>
          <strong>{subtitle.selected?.lan_doc ?? subtitle.selected?.lan}</strong>
        </div>
        <span>{subtitle.body.length} 条</span>
      </div>
    {:else if subtitle}
      <div class="notice">{subtitle.reason}</div>
    {/if}

    <div class="toolbar">
      <select bind:value={selectedTemplateId} aria-label="选择模板">
        {#each defaultTemplates as template (template.id)}
          <option value={template.id}>{template.name}</option>
        {/each}
      </select>
      <button class="secondary" type="button" onclick={refreshSubtitle} disabled={loading}>刷新</button>
    </div>

    <button class="primary" type="button" onclick={summarize} disabled={loading || !video}>
      {loading ? '处理中...' : '开始总结'}
    </button>

    {#if error}
      <div class="error">{error}</div>
    {/if}

    {#if summary}
      <article class="summary">
        <p class="label">AI 输出</p>
        <div>{summary}</div>
      </article>
    {/if}
  </section>
</main>
