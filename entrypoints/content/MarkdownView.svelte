<script lang="ts">
  import { parseConstrainedMarkdown, type InlinePart } from '../../src/lib/markdown/parse'

  let {
    markdown,
    onSeek,
  }: {
    markdown: string
    onSeek: (seconds: number) => void
  } = $props()

  let blocks = $derived(parseConstrainedMarkdown(markdown))
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
    {:else}
      <p>{@render inline(block.parts)}</p>
    {/if}
  {/each}
</div>
