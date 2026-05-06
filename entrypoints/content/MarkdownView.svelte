<script lang="ts">
  import { untrack } from 'svelte'
  import {
    createManualBlockImageKey,
    createManualListItemImageKey,
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

  type ImageSnapshot = {
    images: Record<string, ImageState>
    deletedImageKeys: Record<string, true>
  }

  type CaptureTarget = {
    key: string
    seconds: number
    label: string
    source: ImageSource
    status: ImageState['status']
  }

  let {
    markdown,
    autoCaptureAiImages = false,
    onSeek,
    onCaptureFrame,
    onGetCurrentSeconds,
    onImagesChange,
    initialImages,
  }: {
    markdown: string
    autoCaptureAiImages?: boolean
    onSeek: (seconds: number) => void
    onCaptureFrame: (seconds: number) => Promise<string>
    onGetCurrentSeconds: () => number
    onImagesChange?: (snapshot: ImageSnapshot) => void
    initialImages?: ImageSnapshot
  } = $props()

  let blocks = $derived(parseConstrainedMarkdown(markdown))
  const initialImageSnapshot = untrack(() => initialImages)
  let imageStates = $state<Record<string, ImageState>>(initialImageSnapshot?.images ?? {})
  let deletedImageKeys = $state<Record<string, true>>(initialImageSnapshot?.deletedImageKeys ?? {})

  $effect(() => {
    onImagesChange?.({
      images: $state.snapshot(imageStates),
      deletedImageKeys: $state.snapshot(deletedImageKeys),
    })
  })

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

  const insertCurrentImage = (key: string) => {
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

    try {
      const seconds = Math.max(0, onGetCurrentSeconds())
      void captureFrame(key, seconds, formatTimestamp(seconds), 'manual')
    } catch (error) {
      imageStates[key] = {
        status: 'error',
        source: 'manual',
        seconds: 0,
        label: formatTimestamp(0),
        error: error instanceof Error ? error.message : String(error),
      }
    }
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

  const adjustFrameSeconds = (
    key: string,
    delta: number,
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
    const parsedSeconds = parseTimestamp(current.label.trim())
    const nextSeconds = Math.max(0, (parsedSeconds ?? current.seconds ?? fallbackSeconds) + delta)

    imageStates[key] = {
      ...current,
      seconds: nextSeconds,
      label: formatTimestamp(nextSeconds),
      error: undefined,
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

  const getRecapturableFrames = () => {
    const targets = new Map<string, CaptureTarget>()
    const addTarget = (
      key: string,
      seconds: number,
      label: string,
      source: ImageSource,
      status: ImageState['status'],
    ) => {
      if (!key || deletedImageKeys[key]) {
        return
      }

      const current = imageStates[key]
      targets.set(key, {
        key,
        seconds: current?.seconds ?? seconds,
        label: current?.label ?? label,
        source: current?.source ?? source,
        status: current?.status ?? status,
      })
    }

    blocks.forEach((block, index) => {
      if (block.type === 'image') {
        addTarget(createImageKeyForBlock(index), block.seconds, block.label, 'ai', 'idle')
        return
      }

      if (block.type === 'heading' && block.level > 1) {
        const key = createHeadingImageKey(block.parts)
        const timestamp = firstTimestamp(block.parts)
        if (key && timestamp && imageStates[key] && !hasFollowingImageBlock(index, key)) {
          addTarget(key, timestamp.startSeconds, formatTimestamp(timestamp.startSeconds), 'manual', 'idle')
        }
      }
    })

    Object.entries(imageStates).forEach(([key, image]) => {
      addTarget(key, image.seconds, image.label, image.source, image.status)
    })

    return Array.from(targets.values())
  }

  let recapturableFrames = $derived(getRecapturableFrames())
  let isRecapturingAll = $derived(recapturableFrames.some(image => image.status === 'loading'))

  const recaptureAllFrames = () => {
    getRecapturableFrames().forEach(image => {
      if (image.status === 'loading') {
        return
      }

      const seconds = parseTimestamp(image.label.trim())
      if (seconds === null) {
        imageStates[image.key] = {
          status: 'error',
          source: image.source,
          seconds: image.seconds,
          label: image.label,
          error: '请输入 MM:SS 或 HH:MM:SS 格式的时间戳。',
        }
        return
      }

      void captureFrame(image.key, seconds, image.label.trim(), image.source)
    })
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

{#snippet lineInsert(key: string)}
  <button
    class="line-insert"
    type="button"
    title="在这行下面插入当前画面"
    aria-label="在这行下面插入当前画面"
    onclick={() => { insertCurrentImage(key) }}
  >
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      focusable="false"
    >
      <circle cx="8" cy="8" r="7" />
      <path d="M8 4.75v6.5M4.75 8h6.5" />
    </svg>
  </button>
{/snippet}

{#snippet manualFrame(key: string)}
  {#if imageStates[key] && !deletedImageKeys[key]}
    {@const image = imageStates[key]}
    {@render frameBlock(key, image.seconds, image.label, 'manual')}
  {/if}
{/snippet}

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
        <button
          class="frame-step"
          type="button"
          aria-label="时间戳减少 1 秒"
          onclick={() => { adjustFrameSeconds(key, -1, seconds, label, source) }}
        >
          -1s
        </button>
        <input
          class="frame-time"
          value={image.label}
          aria-label="截图时间戳"
          oninput={(event) => {
            updateFrameLabel(key, event.currentTarget.value, seconds, source)
          }}
        />
        <button
          class="frame-step"
          type="button"
          aria-label="时间戳增加 1 秒"
          onclick={() => { adjustFrameSeconds(key, 1, seconds, label, source) }}
        >
          +1s
        </button>
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

{#if recapturableFrames.length > 0}
  <div class="frame-toolbar">
    <button
      class="frame-refresh-all"
      type="button"
      disabled={isRecapturingAll}
      onclick={recaptureAllFrames}
    >
      {isRecapturingAll ? '正在重新获取图片...' : '重新获取所有图片'}
    </button>
  </div>
{/if}

<div class="markdown">
  {#each blocks as block, index (index)}
      {#if block.type === 'heading'}
      {@const lineImageKey = createManualBlockImageKey(index)}
      {#if block.level === 1}
        <div class="markdown-line heading-line level-1">
          <h1>{@render inline(block.parts)}</h1>
          {@render lineInsert(lineImageKey)}
        </div>
        {@render manualFrame(lineImageKey)}
      {:else if block.level === 2}
        {@const imageKey = createHeadingImageKey(block.parts)}
        <div class="markdown-line heading-line level-2">
          <h2>{@render inline(block.parts, imageKey)}</h2>
          {@render lineInsert(lineImageKey)}
        </div>
        {#if imageKey && imageStates[imageKey] && !deletedImageKeys[imageKey] && !hasFollowingImageBlock(index, imageKey)}
          {@const timestamp = firstTimestamp(block.parts)}
          {#if timestamp}
            {@render frameBlock(imageKey, timestamp.startSeconds, formatTimestamp(timestamp.startSeconds), 'manual')}
          {/if}
        {/if}
        {@render manualFrame(lineImageKey)}
      {:else}
        {@const imageKey = createHeadingImageKey(block.parts)}
        <div class="markdown-line heading-line level-3">
          <h3>{@render inline(block.parts, imageKey)}</h3>
          {@render lineInsert(lineImageKey)}
        </div>
        {#if imageKey && imageStates[imageKey] && !deletedImageKeys[imageKey] && !hasFollowingImageBlock(index, imageKey)}
          {@const timestamp = firstTimestamp(block.parts)}
          {#if timestamp}
            {@render frameBlock(imageKey, timestamp.startSeconds, formatTimestamp(timestamp.startSeconds), 'manual')}
          {/if}
        {/if}
        {@render manualFrame(lineImageKey)}
      {/if}
    {:else if block.type === 'list'}
      <ul>
        {#each block.items as item, itemIndex (itemIndex)}
          {@const lineImageKey = createManualListItemImageKey(index, itemIndex)}
          <li>
            <div class="markdown-line list-line">
              <span>{@render inline(item)}</span>
              {@render lineInsert(lineImageKey)}
            </div>
            {@render manualFrame(lineImageKey)}
          </li>
        {/each}
      </ul>
    {:else if block.type === 'image'}
      {@const imageKey = createImageKeyForBlock(index)}
      {#if !deletedImageKeys[imageKey]}
        {@render frameBlock(imageKey, block.seconds, block.label, 'ai')}
      {/if}
    {:else}
      {@const lineImageKey = createManualBlockImageKey(index)}
      <div class="markdown-line paragraph-line">
        <p>{@render inline(block.parts)}</p>
        {@render lineInsert(lineImageKey)}
      </div>
      {@render manualFrame(lineImageKey)}
    {/if}
  {/each}
</div>
