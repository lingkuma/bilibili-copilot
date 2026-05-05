<script lang="ts">
  import { onMount } from 'svelte'
  import { defaultTemplates } from '../../src/lib/ai/prompts'
  import { defaultSettings, loadSettings, saveSettings } from '../../src/lib/settings/storage'
  import type { CopilotSettings } from '../../src/lib/types'

  let settings = $state<CopilotSettings>({ ...defaultSettings })
  let saved = $state(false)
  let error = $state('')

  onMount(async () => {
    settings = await loadSettings()
  })

  const persist = async () => {
    saved = false
    error = ''
    try {
      await saveSettings(settings)
      saved = true
      window.setTimeout(() => {
        saved = false
      }, 1800)
    } catch (currentError) {
      error = currentError instanceof Error ? currentError.message : String(currentError)
    }
  }
</script>

<main class="page">
  <header>
    <p>Bilibili Copilot</p>
    <h1>设置</h1>
  </header>

  <form onsubmit={(event) => { event.preventDefault(); void persist() }}>
    <fieldset>
      <legend>AI 配置</legend>

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
    </fieldset>

    <fieldset>
      <legend>总结偏好</legend>

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
    </fieldset>

    {#if error}
      <p class="error">{error}</p>
    {/if}

    {#if saved}
      <p class="saved">设置已保存。</p>
    {/if}

    <button type="submit">保存设置</button>
  </form>
</main>
