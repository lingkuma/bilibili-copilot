export type InlinePart =
  | {
    type: 'text'
    text: string
  }
  | {
    type: 'strong'
    text: string
  }
  | {
    type: 'timestamp'
    label: string
    startSeconds: number
    endSeconds?: number
  }

export type MarkdownBlock =
  | {
    type: 'heading'
    level: 1 | 2 | 3
    parts: InlinePart[]
  }
  | {
    type: 'image'
    label: string
    seconds: number
  }
  | {
    type: 'paragraph'
    parts: InlinePart[]
  }
  | {
    type: 'list'
    items: InlinePart[][]
  }

const tokenPattern = /(\[(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*-\s*(\d{1,2}:\d{2}(?::\d{2})?))?\]|\*\*([^*]+)\*\*)/g
const imagePattern = /^\[<image>@(\d{1,2}:\d{2}(?::\d{2})?)\]$/i

export const parseConstrainedMarkdown = (markdown: string): MarkdownBlock[] => {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''
    const trimmed = line.trim()

    if (!trimmed) {
      index++
      continue
    }

    const imageMatch = imagePattern.exec(trimmed)
    if (imageMatch?.[1]) {
      const seconds = parseTimestamp(imageMatch[1])
      if (seconds !== null) {
        blocks.push({
          type: 'image',
          label: imageMatch[1],
          seconds,
        })
      } else {
        blocks.push({
          type: 'paragraph',
          parts: parseInlineParts(trimmed),
        })
      }
      index++
      continue
    }

    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(trimmed)
    if (headingMatch?.[1] && headingMatch[2]) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length as 1 | 2 | 3,
        parts: parseInlineParts(headingMatch[2]),
      })
      index++
      continue
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: InlinePart[][] = []
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index] ?? '')) {
        items.push(parseInlineParts((lines[index] ?? '').replace(/^\s*[-*]\s+/, '').trim()))
        index++
      }
      blocks.push({
        type: 'list',
        items,
      })
      continue
    }

    const paragraphLines: string[] = []
    while (
      index < lines.length
      && (lines[index] ?? '').trim()
      && !/^(#{1,3})\s+/.test((lines[index] ?? '').trim())
      && !/^\s*[-*]\s+/.test(lines[index] ?? '')
      && !imagePattern.test((lines[index] ?? '').trim())
    ) {
      paragraphLines.push((lines[index] ?? '').trim())
      index++
    }

    blocks.push({
      type: 'paragraph',
      parts: parseInlineParts(paragraphLines.join(' ')),
    })
  }

  return blocks
}

export const parseInlineParts = (text: string): InlinePart[] => {
  const parts: InlinePart[] = []
  let lastIndex = 0

  for (const match of text.matchAll(tokenPattern)) {
    const index = match.index ?? 0
    if (index > lastIndex) {
      parts.push({
        type: 'text',
        text: text.slice(lastIndex, index),
      })
    }

    const label = match[0] ?? ''
    const start = match[2]
    const end = match[3]
    const strong = match[4]
    if (start) {
      const startSeconds = parseTimestamp(start)
      const endSeconds = end ? parseTimestamp(end) : undefined
      if (startSeconds !== null) {
        parts.push({
          type: 'timestamp',
          label: formatTimestampLabel(start, end),
          startSeconds,
          ...(endSeconds === undefined || endSeconds === null ? {} : { endSeconds }),
        })
      } else {
        parts.push({
          type: 'text',
          text: label,
        })
      }
    } else if (strong) {
      parts.push({
        type: 'strong',
        text: strong,
      })
    }

    lastIndex = index + label.length
  }

  if (lastIndex < text.length) {
    parts.push({
      type: 'text',
      text: text.slice(lastIndex),
    })
  }

  return parts
}

const formatTimestampLabel = (start: string, end?: string) => {
  return end ? `${start}-${end}` : start
}

export const parseTimestamp = (timestamp: string) => {
  const parts = timestamp.split(':').map(value => Number(value))
  if (
    parts.length < 2
    || parts.length > 3
    || parts.some(value => !Number.isInteger(value) || value < 0)
  ) {
    return null
  }

  const [first = 0, second = 0, third] = parts
  const hours = third === undefined ? 0 : first
  const minutes = third === undefined ? first : second
  const seconds = third === undefined ? second : third

  if (minutes >= 60 || seconds >= 60) {
    return null
  }

  return hours * 3600 + minutes * 60 + seconds
}
