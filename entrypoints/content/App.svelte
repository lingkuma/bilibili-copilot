<script lang="ts">
  import { onMount } from 'svelte'
  import { browser } from 'wxt/browser'
  import { defaultTemplates } from '../../src/lib/ai/prompts'
  import { extractBvidFromUrl, extractPageFromUrl, stripBilibiliTitleSuffix } from '../../src/lib/bilibili/video'
  import type { RuntimeMessage, RuntimeResponse } from '../../src/lib/messages'
  import { defaultSettings, loadSettings, saveSettings } from '../../src/lib/settings/storage'
  import type { CopilotSettings, DetectedVideo, ResolvedVideo, SubtitleForAI } from '../../src/lib/types'

  interface SubtitlePayload {
    video: ResolvedVideo
    subtitle: SubtitleForAI
  }

  interface SummaryPayload extends SubtitlePayload {
    summary: string
  }

  let expanded = $state(false)
  let settingsOpen = $state(false)
  let video = $state<ResolvedVideo | null>(null)
  let subtitle = $state<SubtitleForAI | null>(null)
  let summary = $state('')
  let selectedTemplateId = $state('summary')
  let loading = $state(false)
  let saving = $state(false)
  let saved = $state(false)
  let error = $state('')
  let settings = $state<CopilotSettings>({ ...defaultSettings })

  let lastUrl = ''
  let intervalId: number | undefined

  onMount(() => {
    void initialize()
    const messageListener = (message: RuntimeMessage) => {
      if (message.type === 'OPEN_FLOATING_PANEL') {
        expanded = true
        settingsOpen = false
        void refreshSubtitle()
      }

      if (message.type === 'OPEN_FLOATING_SETTINGS') {
        expanded = true
        settingsOpen = true
      }
    }
    browser.runtime.onMessage.addListener(messageListener)

    intervalId = window.setInterval(() => {
      if (location.href !== lastUrl) {
        handleUrlChange()
      }
    }, 800)

    return () => {
      if (intervalId !== undefined) {
        window.clearInterval(intervalId)
      }
      browser.runtime.onMessage.removeListener(messageListener)
    }
  })

  const initialize = async () => {
    settings = await loadSettings()
    selectedTemplateId = settings.defaultTemplateId
    handleUrlChange()
  }

  const handleUrlChange = () => {
    lastUrl = location.href
    video = null
    subtitle = null
    summary = ''
    error = ''

    const detected = detectVideo()
    if (detected.bvid) {
      void browser.runtime.sendMessage({
        type: 'VIDEO_DETECTED',
        video: detected,
      })
    }

    if (expanded && detected.bvid && !settingsOpen) {
      void refreshSubtitle()
    }
  }

  const detectVideo = (): DetectedVideo => ({
    bvid: extractBvidFromUrl(location.href),
    page: extractPageFromUrl(location.href),
    title: stripBilibiliTitleSuffix(document.title),
    url: location.href,
  })

  const unwrap = <T,>(response: RuntimeResponse<T>) => {
    if (!response.ok) {
      throw new Error(response.error ?? '操作失败。')
    }
    return response.data as T
  }

  const openPanel = () => {
    expanded = true
    settingsOpen = false
    if (!video && !subtitle) {
      void refreshSubtitle()
    }
  }

  const refreshSubtitle = async () => {
    loading = true
    error = ''
    try {
      const detected = detectVideo()
      if (!detected.bvid) {
        throw new Error('当前页面不是可识别的 Bilibili 视频页。')
      }

      const response = await browser.runtime.sendMessage({
        type: 'GET_SUBTITLE_FOR_VIDEO',
        video: detected,
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
      const detected = detectVideo()
      if (!detected.bvid) {
        throw new Error('当前页面不是可识别的 Bilibili 视频页。')
      }

      const response = await browser.runtime.sendMessage({
        type: 'SUMMARIZE_VIDEO',
        video: detected,
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

  const persistSettings = async () => {
    saving = true
    saved = false
    error = ''
    try {
      await saveSettings($state.snapshot(settings))
      selectedTemplateId = settings.defaultTemplateId
      saved = true
      window.setTimeout(() => {
        saved = false
      }, 1600)
    } catch (currentError) {
      error = currentError instanceof Error ? currentError.message : String(currentError)
    } finally {
      saving = false
    }
  }
</script>

{#if expanded}
  <main class="window">
    <header class="header">
      <div>
        <p class="eyebrow">Bilibili Copilot</p>
        <h1>{settingsOpen ? '设置' : '字幕总结'}</h1>
      </div>
      <div class="header-actions">
        <button class="ghost" type="button" onclick={() => { settingsOpen = !settingsOpen }}>
          {settingsOpen ? '返回' : '设置'}
        </button>
        <button class="close" type="button" aria-label="收起" onclick={() => { expanded = false }}>×</button>
      </div>
    </header>

    {#if settingsOpen}
      <form class="content settings" onsubmit={(event) => { event.preventDefault(); void persistSettings() }}>
        <label>
          <span>API Base URL</span>
          <input bind:value={settings.apiBaseUrl} placeholder="https://api.openai.com/v1" />
        </label>

        <label>
          <span>API Key</span>
          <input bind:value={settings.apiKey} type="password" placeholder="sk-..." />
        </label>

        <label>
          <span>模型</span>
          <input bind:value={settings.model} placeholder="gpt-4.1-mini" />
        </label>

        <label>
          <span>默认字幕语言</span>
          <input bind:value={settings.language} placeholder="zh-CN" />
        </label>

        <label>
          <span>默认模板</span>
          <select bind:value={settings.defaultTemplateId}>
            {#each defaultTemplates as template (template.id)}
              <option value={template.id}>{template.name}</option>
            {/each}
          </select>
        </label>

        <label class="check">
          <input bind:checked={settings.includeTimestamps} type="checkbox" />
          <span>发送字幕时保留时间戳</span>
        </label>

        <label class="check">
          <input bind:checked={settings.autoSummaryEnabled} type="checkbox" />
          <span>自动总结新打开的视频</span>
        </label>

        {#if saved}
          <p class="saved">设置已保存。</p>
        {/if}

        <button class="primary" type="submit" disabled={saving}>
          {saving ? '保存中...' : '保存设置'}
        </button>
      </form>
    {:else}
      <section class="content">
        {#if video}
          <div class="video-block">
            <p class="label">当前视频</p>
            <h2>{video.title}</h2>
            <p class="meta">BV: {video.bvid} · P{video.page} · CID: {video.cid}</p>
          </div>
        {:else}
          <div class="empty">
            <h2>当前视频</h2>
            <p>{loading ? '正在读取字幕...' : '点击刷新读取当前页面字幕。'}</p>
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

        <button class="primary" type="button" onclick={summarize} disabled={loading}>
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
    {/if}
  </main>
{:else}
  <button class="launcher" type="button" onclick={openPanel}>
    <span class="mark"></span>
    <span>总结</span>
  </button>
{/if}
