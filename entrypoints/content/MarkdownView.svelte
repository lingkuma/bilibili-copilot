<script lang="ts">
  import {
    parseConstrainedMarkdown,
    parseTimestamp,
    type InlinePart,
  } from '../../src/lib/markdown/parse'

  type ImageSource = 'ai' | 'manual'

  type ImageState = {
    status: 'idle' | 'loading' | 'loaded' | 'error'
    source: ImageSource
    seconds: number
    label: string
    dataUrl?: string
    error?: string
  }

  let {
    markdown,
    autoCaptureAiImages = false,
    onSeek,
    onCaptureFrame,
  }: {
    markdown: string
    autoCaptureAiImages?: boolean
    onSeek: (seconds: number) => void
    onCaptureFrame: (seconds: number) => Promise<string>
  } = $props()

  let blocks = $derived(parseConstrainedMarkdown(markdown))
  let imageStates = $state<Record<string, ImageState>>({})
  let deletedImageKeys = $state<Record<string, true>>({})

  $effect(() => {
    if (!autoCaptureAiImages) {
      return
    }

    blocks.forEach((block, index) => {
      if (block.type !== 'image') {
        return
      }

      const key = createImageKeyForBlock(index)
      const image = imageStates[key]
      if (deletedImageKeys[key] || (image && image.status !== 'idle')) {
        return
      }

      void captureFrame(key, block.seconds, block.label, 'ai')
    })
  })

  const createHeadingImageKey = (parts: InlinePart[]) => {
    const timestamp = parts.find(part => part.type === 'timestamp')
    const heading = parts
      .map(part => {
        if (part.type === 'timestamp') {
          return part.label
        }
        return part.text
      })
      .join('')
      .trim()

    return timestamp ? `section:${timestamp.startSeconds}:${heading}` : ''
  }

  const createImageKeyForBlock = (index: number) => {
    for (let currentIndex = index - 1; currentIndex >= 0; currentIndex--) {
      const block = blocks[currentIndex]
      if (block?.type === 'heading') {
        const key = createHeadingImageKey(block.parts)
        if (key) {
          return key
        }
      }
    }

    const block = blocks[index]
    return block?.type === 'image' ? `image:${index}:${block.label}` : `image:${index}`
  }

  const hasFollowingImageBlock = (index: number, key: string) => {
    const nextBlock = blocks[index + 1]
    return nextBlock?.type === 'image' && createImageKeyForBlock(index + 1) === key
  }

  const getDisplayImage = (
    key: string,
    seconds: number,
    label: string,
    source: ImageSource,
  ): ImageState => {
    return imageStates[key] ?? {
      status: 'idle',
      source,
      seconds,
      label,
    }
  }

  const captureFrame = async (
    key: string,
    seconds: number,
    label: string,
    source: ImageSource,
  ) => {
    imageStates[key] = {
      status: 'loading',
      source,
      seconds,
      label,
    }

    try {
      imageStates[key] = {
        status: 'loaded',
        source,
        seconds,
        label,
        dataUrl: await onCaptureFrame(seconds),
      }
    } catch (error) {
      imageStates[key] = {
        status: 'error',
        source,
        seconds,
        label,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  const insertImage = (key: string, seconds: number) => {
    if (!key) {
      return
    }

    if (deletedImageKeys[key]) {
      const nextDeleted = {
        ...deletedImageKeys,
      }
      delete nextDeleted[key]
      deletedImageKeys = nextDeleted
    }

    if (imageStates[key]?.status === 'loading') {
      return
    }

    void captureFrame(key, seconds, formatTimestamp(seconds), 'manual')
  }

  const updateFrameLabel = (
    key: string,
    value: string,
    seconds: number,
    source: ImageSource,
  ) => {
    const current = imageStates[key] ?? {
      status: 'idle' as const,
      source,
      seconds,
      label: formatTimestamp(seconds),
    }

    imageStates[key] = {
      ...current,
      label: value,
    }
  }

  const recaptureFrame = (
    key: string,
    fallbackSeconds: number,
    fallbackLabel: string,
    source: ImageSource,
  ) => {
    const current = imageStates[key] ?? {
      status: 'idle' as const,
      source,
      seconds: fallbackSeconds,
      label: fallbackLabel,
    }
    const seconds = parseTimestamp(current.label.trim())
    if (seconds === null) {
      imageStates[key] = {
        ...current,
        status: 'error',
        error: '请输入 MM:SS 或 HH:MM:SS 格式的时间戳。',
      }
      return
    }

    void captureFrame(key, seconds, current.label.trim(), source)
  }

  const deleteFrame = (key: string) => {
    const nextImages = {
      ...imageStates,
    }
    delete nextImages[key]
    imageStates = nextImages
    deletedImageKeys = {
      ...deletedImageKeys,
      [key]: true,
    }
  }

  const firstTimestamp = (parts: InlinePart[]) => {
    return parts.find(part => part.type === 'timestamp')
  }

  const formatTimestamp = (seconds: number) => {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const rest = Math.floor(seconds % 60)

    if (hours > 0) {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    }

    return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
  }
</script>

{#snippet inline(parts: InlinePart[], imageKey = '')}
  {#each parts as part, index (index)}
    {#if part.type === 'timestamp'}
      <span class="timestamp-wrap">
        <button
          class="timestamp"
          type="button"
          title={part.endSeconds === undefined ? '跳转到该时间' : '跳转到该片段起点'}
          onclick={() => { onSeek(part.startSeconds) }}
        >
          {part.label}
        </button>
        {#if imageKey}
          <button
            class="timestamp-insert"
            type="button"
            title="为该章节插入图片"
            onclick={() => { insertImage(imageKey, part.startSeconds) }}
          >
            插图
          </button>
        {/if}
      </span>
    {:else if part.type === 'strong'}
      <strong>{part.text}</strong>
    {:else}
      {part.text}
    {/if}
  {/each}
{/snippet}

{#snippet frameBlock(key: string, seconds: number, label: string, source: ImageSource)}
  {@const image = getDisplayImage(key, seconds, label, source)}
  <figure class="frame-block">
    <figcaption>
      <div class="frame-meta">
        <span>视频画面</span>
        <input
          class="frame-time"
          value={image.label}
          aria-label="截图时间戳"
          oninput={(event) => {
            updateFrameLabel(key, event.currentTarget.value, seconds, source)
          }}
        />
      </div>
      <div class="frame-actions">
        <button
          class="frame-action"
          type="button"
          onclick={() => { onSeek(image.seconds) }}
        >
          跳转
        </button>
        <button
          class="frame-action"
          type="button"
          disabled={image.status === 'loading'}
          onclick={() => { recaptureFrame(key, seconds, label, source) }}
        >
          {image.status === 'loading' ? '获取中...' : image.status === 'loaded' ? '重新获取' : '获取画面'}
        </button>
        <button
          class="frame-action danger"
          type="button"
          onclick={() => { deleteFrame(key) }}
        >
          删除
        </button>
      </div>
    </figcaption>

    {#if image.status === 'loaded' && image.dataUrl}
      <img src={image.dataUrl} alt={`视频 ${image.label} 画面`} />
    {:else if image.status === 'error'}
      <p class="frame-error">{image.error}</p>
    {/if}
  </figure>
{/snippet}

<div class="markdown">
  {#each blocks as block, index (index)}
      {#if block.type === 'heading'}
      {#if block.level === 1}
        <h1>{@render inline(block.parts)}</h1>
      {:else if block.level === 2}
        {@const imageKey = createHeadingImageKey(block.parts)}
        <h2>{@render inline(block.parts, imageKey)}</h2>
        {#if imageKey && imageStates[imageKey] && !deletedImageKeys[imageKey] && !hasFollowingImageBlock(index, imageKey)}
          {@const timestamp = firstTimestamp(block.parts)}
          {#if timestamp}
            {@render frameBlock(imageKey, timestamp.startSeconds, formatTimestamp(timestamp.startSeconds), 'manual')}
          {/if}
        {/if}
      {:else}
        {@const imageKey = createHeadingImageKey(block.parts)}
        <h3>{@render inline(block.parts, imageKey)}</h3>
        {#if imageKey && imageStates[imageKey] && !deletedImageKeys[imageKey] && !hasFollowingImageBlock(index, imageKey)}
          {@const timestamp = firstTimestamp(block.parts)}
          {#if timestamp}
            {@render frameBlock(imageKey, timestamp.startSeconds, formatTimestamp(timestamp.startSeconds), 'manual')}
          {/if}
        {/if}
      {/if}
    {:else if block.type === 'list'}
      <ul>
        {#each block.items as item, itemIndex (itemIndex)}
          <li>{@render inline(item)}</li>
        {/each}
      </ul>
    {:else if block.type === 'image'}
      {@const imageKey = createImageKeyForBlock(index)}
      {#if !deletedImageKeys[imageKey]}
        {@render frameBlock(imageKey, block.seconds, block.label, 'ai')}
      {/if}
    {:else}
      <p>{@render inline(block.parts)}</p>
    {/if}
  {/each}
</div>
