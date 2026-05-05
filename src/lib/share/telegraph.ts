import { parseConstrainedMarkdown, type InlinePart, type MarkdownBlock } from '../markdown/parse'
import type { ResolvedVideo } from '../types'

export type ShareImageState = {
  status: 'idle' | 'loading' | 'loaded' | 'error'
  source: 'ai' | 'manual'
  seconds: number
  label: string
  dataUrl?: string
  error?: string
}

export type ShareImageSnapshot = {
  images: Record<string, ShareImageState>
  deletedImageKeys: Record<string, true>
}

export type TelegraphNode = string | {
  tag: string
  attrs?: Record<string, string>
  children?: TelegraphNode[]
}

export type ShareImageEntry = {
  key: string
  label: string
  dataUrl: string
}

export const collectShareImageEntries = (
  markdown: string,
  snapshot: ShareImageSnapshot,
) => {
  const blocks = parseConstrainedMarkdown(markdown)
  const entries: ShareImageEntry[] = []
  const missingLabels: string[] = []
  const seenKeys = new Set<string>()

  blocks.forEach((block, index) => {
    if (block.type === 'heading') {
      const key = createHeadingImageKey(block.parts)
      if (!key || hasFollowingImageBlock(blocks, index, key)) {
        return
      }
      collectImageEntry(key, '', false, snapshot, entries, missingLabels, seenKeys)
      return
    }

    if (block.type === 'image') {
      collectImageEntry(createImageKeyForBlock(blocks, index), block.label, true, snapshot, entries, missingLabels, seenKeys)
    }
  })

  if (missingLabels.length > 0) {
    throw new Error(`Still waiting for ${missingLabels.length} image(s): ${missingLabels.slice(0, 3).join(', ')}`)
  }

  return entries
}

export const buildTelegraphContent = (input: {
  markdown: string
  video: ResolvedVideo
  imageUrls: Record<string, string>
}) => {
  const blocks = parseConstrainedMarkdown(input.markdown)
  const nodes: TelegraphNode[] = [
    {
      tag: 'p',
      children: [
        'Source: ',
        {
          tag: 'a',
          attrs: {
            href: input.video.url,
          },
          children: [input.video.title],
        },
      ],
    },
  ]

  blocks.forEach((block, index) => {
    if (block.type === 'heading') {
      const children = renderInlineParts(block.parts, input.video)
      if (children.length > 0) {
        nodes.push({
          tag: block.level >= 3 ? 'h4' : 'h3',
          children,
        })
      }

      const key = createHeadingImageKey(block.parts)
      const imageUrl = key && !hasFollowingImageBlock(blocks, index, key) ? input.imageUrls[key] : undefined
      if (imageUrl) {
        nodes.push(createFigureNode(imageUrl, imageCaptionFromParts(block.parts)))
      }
      return
    }

    if (block.type === 'list') {
      nodes.push({
        tag: 'ul',
        children: block.items.map(item => ({
          tag: 'li',
          children: renderInlineParts(item, input.video),
        })),
      })
      return
    }

    if (block.type === 'image') {
      const key = createImageKeyForBlock(blocks, index)
      const imageUrl = input.imageUrls[key]
      if (imageUrl) {
        nodes.push(createFigureNode(imageUrl, block.label))
      }
      return
    }

    const children = renderInlineParts(block.parts, input.video)
    if (children.length > 0) {
      nodes.push({
        tag: 'p',
        children,
      })
    }
  })

  return nodes
}

const collectImageEntry = (
  key: string,
  fallbackLabel: string,
  required: boolean,
  snapshot: ShareImageSnapshot,
  entries: ShareImageEntry[],
  missingLabels: string[],
  seenKeys: Set<string>,
) => {
  if (!key || seenKeys.has(key) || snapshot.deletedImageKeys[key]) {
    return
  }

  seenKeys.add(key)
  const image = snapshot.images[key]
  if (image?.status === 'loaded' && image.dataUrl) {
    entries.push({
      key,
      label: image.label || fallbackLabel || key,
      dataUrl: image.dataUrl,
    })
    return
  }

  if (required || (image && image.status !== 'idle')) {
    missingLabels.push((image?.label || fallbackLabel || key))
  }
}

const createFigureNode = (src: string, caption: string): TelegraphNode => ({
  tag: 'figure',
  children: [
    {
      tag: 'img',
      attrs: {
        src,
      },
    },
    ...(caption
      ? [{
          tag: 'figcaption',
          children: [caption],
        }]
      : []),
  ],
})

const renderInlineParts = (parts: InlinePart[], video: ResolvedVideo): TelegraphNode[] => {
  return parts.flatMap<TelegraphNode>(part => {
    if (part.type === 'strong') {
      return [{
        tag: 'b',
        children: [part.text],
      }] as TelegraphNode[]
    }

    if (part.type === 'timestamp') {
      return [{
        tag: 'a',
        attrs: {
          href: withTimestamp(video.url, part.startSeconds),
        },
        children: [`[${part.label}]`],
      }] as TelegraphNode[]
    }

    return [part.text]
  })
}

const imageCaptionFromParts = (parts: InlinePart[]) => {
  const timestamp = parts.find(part => part.type === 'timestamp')
  return timestamp ? timestamp.label : ''
}

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

const createImageKeyForBlock = (blocks: MarkdownBlock[], index: number) => {
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

const hasFollowingImageBlock = (blocks: MarkdownBlock[], index: number, key: string) => {
  const nextBlock = blocks[index + 1]
  return nextBlock?.type === 'image' && createImageKeyForBlock(blocks, index + 1) === key
}

const withTimestamp = (url: string, seconds: number) => {
  try {
    const target = new URL(url)
    target.searchParams.set('t', String(Math.floor(seconds)))
    return target.toString()
  } catch {
    return url
  }
}
