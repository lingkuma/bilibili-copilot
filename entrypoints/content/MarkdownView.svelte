<script lang="ts">
  import { parseConstrainedMarkdown, type InlinePart } from '../../src/lib/markdown/parse'

  type ImageState =
    | {
      status: 'loading'
    }
    | {
      status: 'loaded'
      dataUrl: string
    }
    | {
      status: 'error'
      error: string
    }

  let {
    markdown,
    onSeek,
    onCaptureFrame,
  }: {
    markdown: string
    onSeek: (seconds: number) => void
    onCaptureFrame: (seconds: number) => Promise<string>
  } = $props()

  let blocks = $derived(parseConstrainedMarkdown(markdown))
  let imageStates = $state<Record<string, ImageState>>({})

  const captureFrame = async (key: string, seconds: number) => {
    imageStates[key] = {
      status: 'loading',
    }

    try {
      imageStates[key] = {
        status: 'loaded',
        dataUrl: await onCaptureFrame(seconds),
      }
    } catch (error) {
      imageStates[key] = {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
</script>

{#snippet inline(parts: InlinePart[])}
  {#each parts as part, index (index)}
    {#if part.type === 'timestamp'}
      <button
        class="timestamp"
        type="button"
        title={part.endSeconds === undefined ? '跳转到该时间' : '跳转到该片段起点'}
        onclick={() => { onSeek(part.startSeconds) }}
      >
        {part.label}
      </button>
    {:else if part.type === 'strong'}
      <strong>{part.text}</strong>
    {:else}
      {part.text}
    {/if}
  {/each}
{/snippet}

<div class="markdown">
  {#each blocks as block, index (index)}
    {#if block.type === 'heading'}
      {#if block.level === 1}
        <h1>{@render inline(block.parts)}</h1>
      {:else if block.level === 2}
        <h2>{@render inline(block.parts)}</h2>
      {:else}
        <h3>{@render inline(block.parts)}</h3>
      {/if}
    {:else if block.type === 'list'}
      <ul>
        {#each block.items as item, itemIndex (itemIndex)}
          <li>{@render inline(item)}</li>
        {/each}
      </ul>
    {:else if block.type === 'image'}
      {@const image = imageStates[block.label]}
      <figure class="frame-block">
        <figcaption>
          <button
            class="timestamp"
            type="button"
            title="跳转到该时间"
            onclick={() => { onSeek(block.seconds) }}
          >
            {block.label}
          </button>
          {#if image?.status === 'loaded'}
            <span>视频画面</span>
          {:else}
            <button
              class="frame-action"
              type="button"
              disabled={image?.status === 'loading'}
              onclick={() => { void captureFrame(block.label, block.seconds) }}
            >
              {image?.status === 'loading' ? '获取中...' : '获取画面'}
            </button>
          {/if}
        </figcaption>

        {#if image?.status === 'loaded'}
          <img src={image.dataUrl} alt={`视频 ${block.label} 画面`} />
        {:else if image?.status === 'error'}
          <p class="frame-error">{image.error}</p>
        {/if}
      </figure>
    {:else}
      <p>{@render inline(block.parts)}</p>
    {/if}
  {/each}
</div>
