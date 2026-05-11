import {
  createManualBlockImageKey,
  createManualListItemImageKey,
  parseConstrainedMarkdown,
  type InlinePart,
  type MarkdownBlock,
} from '../markdown/parse'
import type { ResolvedVideo } from '../types'

const TELEGRAPH_CONTENT_TARGET_BYTES = 56 * 1024

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

export type ShareImageTarget = {
  key: string
  label: string
  seconds: number
  source: 'ai' | 'manual'
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
      if (key && !hasFollowingImageBlock(blocks, index, key)) {
        collectImageEntry(key, '', false, snapshot, entries, missingLabels, seenKeys)
      }
      collectImageEntry(createManualBlockImageKey(index), '', false, snapshot, entries, missingLabels, seenKeys)
      return
    }

    if (block.type === 'list') {
      block.items.forEach((_, itemIndex) => {
        collectImageEntry(createManualListItemImageKey(index, itemIndex), '', false, snapshot, entries, missingLabels, seenKeys)
      })
      return
    }

    if (block.type === 'image') {
      collectImageEntry(createImageKeyForBlock(blocks, index), block.label, true, snapshot, entries, missingLabels, seenKeys)
      return
    }

    collectImageEntry(createManualBlockImageKey(index), '', false, snapshot, entries, missingLabels, seenKeys)
  })

  if (missingLabels.length > 0) {
    throw new Error(`Still waiting for ${missingLabels.length} image(s): ${missingLabels.slice(0, 3).join(', ')}`)
  }

  return entries
}

export const collectPendingShareImageTargets = (
  markdown: string,
  snapshot: ShareImageSnapshot,
) => {
  const targets: ShareImageTarget[] = []
  const seenKeys = new Set<string>()

  walkShareImageCandidates(markdown, (candidate) => {
    if (!candidate.key || seenKeys.has(candidate.key) || snapshot.deletedImageKeys[candidate.key]) {
      return
    }

    seenKeys.add(candidate.key)
    const image = snapshot.images[candidate.key]
    if (image?.status === 'loaded' && image.dataUrl) {
      return
    }

    if (!candidate.required && (!image || image.status === 'idle')) {
      return
    }

    targets.push({
      key: candidate.key,
      label: image?.label || candidate.label,
      seconds: image?.seconds ?? candidate.seconds,
      source: image?.source ?? candidate.source,
    })
  })

  return targets
}

export const buildTelegraphContent = (input: {
  markdown: string
  video: ResolvedVideo
  imageUrls: Record<string, string>
  imageLabels?: Record<string, string>
  includeSource?: boolean
}) => {
  const blocks = parseConstrainedMarkdown(input.markdown)
  const nodes: TelegraphNode[] = []

  if (input.includeSource !== false) {
    nodes.push({
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
    })
  }

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
      pushManualImageNode(nodes, createManualBlockImageKey(index), input)
      return
    }

    if (block.type === 'list') {
      let listItems: TelegraphNode[] = []
      const flushList = () => {
        if (listItems.length === 0) {
          return
        }

        nodes.push({
          tag: 'ul',
          children: listItems,
        })
        listItems = []
      }

      block.items.forEach((item, itemIndex) => {
        const itemNode: TelegraphNode = {
          tag: 'li',
          children: renderInlineParts(item, input.video),
        }
        const imageNodes = createManualImageNodes(createManualListItemImageKey(index, itemIndex), input)

        if (imageNodes.length > 0) {
          flushList()
          nodes.push({
            tag: 'ul',
            children: [itemNode],
          })
          nodes.push(...imageNodes)
          return
        }

        listItems.push(itemNode)
      })

      flushList()
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
    pushManualImageNode(nodes, createManualBlockImageKey(index), input)
  })

  return nodes
}

export const paginateTelegraphContent = (content: TelegraphNode[]) => {
  if (getTelegraphContentBytes(content) <= TELEGRAPH_CONTENT_TARGET_BYTES) {
    return [content]
  }

  const pages: TelegraphNode[][] = []
  let currentPage: TelegraphNode[] = []

  const flushPage = () => {
    if (currentPage.length === 0) {
      return
    }

    pages.push(currentPage)
    currentPage = []
  }

  splitTelegraphNodes(content).forEach(node => {
    const nextPage = [...currentPage, node]
    if (currentPage.length > 0 && getTelegraphContentBytes(nextPage) > TELEGRAPH_CONTENT_TARGET_BYTES) {
      flushPage()
    }
    currentPage.push(node)
  })

  flushPage()
  return pages.length > 0 ? pages : [[]]
}

export const withTelegraphPageNavigation = (
  content: TelegraphNode[],
  urls: string[],
  currentIndex: number,
) => {
  if (urls.length <= 1) {
    return content
  }

  const navigation = createPageNavigation(urls, currentIndex)
  return [
    navigation,
    ...content,
    navigation,
  ]
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

const walkShareImageCandidates = (
  markdown: string,
  visit: (candidate: ShareImageTarget & { required: boolean }) => void,
) => {
  const blocks = parseConstrainedMarkdown(markdown)

  blocks.forEach((block, index) => {
    if (block.type === 'heading') {
      const key = createHeadingImageKey(block.parts)
      const timestamp = block.parts.find(part => part.type === 'timestamp')
      if (key && timestamp && !hasFollowingImageBlock(blocks, index, key)) {
        visit({
          key,
          label: timestamp.label,
          seconds: timestamp.startSeconds,
          source: 'manual',
          required: false,
        })
      }
      visit({
        key: createManualBlockImageKey(index),
        label: timestamp?.label ?? '',
        seconds: timestamp?.startSeconds ?? 0,
        source: 'manual',
        required: false,
      })
      return
    }

    if (block.type === 'list') {
      block.items.forEach((item, itemIndex) => {
        const timestamp = item.find(part => part.type === 'timestamp')
        visit({
          key: createManualListItemImageKey(index, itemIndex),
          label: timestamp?.label ?? '',
          seconds: timestamp?.startSeconds ?? 0,
          source: 'manual',
          required: false,
        })
      })
      return
    }

    if (block.type === 'image') {
      visit({
        key: createImageKeyForBlock(blocks, index),
        label: block.label,
        seconds: block.seconds,
        source: 'ai',
        required: true,
      })
      return
    }

    const timestamp = block.parts.find(part => part.type === 'timestamp')
    visit({
      key: createManualBlockImageKey(index),
      label: timestamp?.label ?? '',
      seconds: timestamp?.startSeconds ?? 0,
      source: 'manual',
      required: false,
    })
  })
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

const pushManualImageNode = (
  nodes: TelegraphNode[],
  key: string,
  input: {
    imageUrls: Record<string, string>
    imageLabels?: Record<string, string>
  },
) => {
  nodes.push(...createManualImageNodes(key, input))
}

const createManualImageNodes = (
  key: string,
  input: {
    imageUrls: Record<string, string>
    imageLabels?: Record<string, string>
  },
) => {
  const imageUrl = input.imageUrls[key]
  return imageUrl ? [createFigureNode(imageUrl, input.imageLabels?.[key] ?? '')] : []
}

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

const getTelegraphContentBytes = (content: TelegraphNode[]) => {
  return new TextEncoder().encode(JSON.stringify(content)).length
}

const splitTelegraphNodes = (nodes: TelegraphNode[]) => {
  return nodes.flatMap(node => splitTelegraphNode(node))
}

const splitTelegraphNode = (node: TelegraphNode): TelegraphNode[] => {
  if (typeof node === 'string') {
    return splitTextByBytes(node, TELEGRAPH_CONTENT_TARGET_BYTES)
  }

  if (getTelegraphContentBytes([node]) <= TELEGRAPH_CONTENT_TARGET_BYTES) {
    return [node]
  }

  if (!node.children || node.children.length === 0) {
    return [node]
  }

  if (node.tag === 'ul') {
    return splitChildrenIntoNodes(node, node.children)
  }

  if (node.tag === 'figure') {
    return [node]
  }

  const children = node.children.flatMap(child => splitTelegraphNode(child))
  return splitChildrenIntoNodes(node, children)
}

const splitChildrenIntoNodes = (
  node: Exclude<TelegraphNode, string>,
  children: TelegraphNode[],
) => {
  const nodes: TelegraphNode[] = []
  let currentChildren: TelegraphNode[] = []

  const createNode = (nextChildren: TelegraphNode[]): TelegraphNode => ({
    tag: node.tag,
    ...(node.attrs ? { attrs: node.attrs } : {}),
    children: nextChildren,
  })

  const flushNode = () => {
    if (currentChildren.length === 0) {
      return
    }

    nodes.push(createNode(currentChildren))
    currentChildren = []
  }

  children.forEach(child => {
    const nextChildren = [...currentChildren, child]
    if (
      currentChildren.length > 0
      && getTelegraphContentBytes([createNode(nextChildren)]) > TELEGRAPH_CONTENT_TARGET_BYTES
    ) {
      flushNode()
    }
    currentChildren.push(child)
  })

  flushNode()
  return nodes.length > 0 ? nodes : [node]
}

const splitTextByBytes = (text: string, maxBytes: number) => {
  const chunks: string[] = []
  let chunk = ''

  Array.from(text).forEach(character => {
    const nextChunk = `${chunk}${character}`
    if (chunk && new TextEncoder().encode(nextChunk).length > maxBytes) {
      chunks.push(chunk)
      chunk = character
      return
    }

    chunk = nextChunk
  })

  if (chunk) {
    chunks.push(chunk)
  }

  return chunks
}

const createPageNavigation = (urls: string[], currentIndex: number): TelegraphNode => {
  const children: TelegraphNode[] = ['目录：']

  urls.forEach((url, index) => {
    if (index > 0) {
      children.push(' | ')
    }

    const label = String(index + 1)
    children.push(index === currentIndex
      ? label
      : {
          tag: 'a',
          attrs: {
            href: url,
          },
          children: [label],
        })
  })

  return {
    tag: 'p',
    children,
  }
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
