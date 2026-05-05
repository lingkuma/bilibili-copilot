import type { ResolvedVideo, SubtitleForAI, SubtitleInfo, SubtitleItem } from '../types'

interface BilibiliApiResponse<T> {
  code: number
  message?: string
  data?: T
}

interface PlayerApiData {
  subtitle?: {
    subtitles?: SubtitleInfo[]
  }
}

interface SubtitleResponse {
  body?: SubtitleItem[]
}

const normalizeSubtitleUrl = (subtitleUrl: string) => {
  if (subtitleUrl.startsWith('//')) {
    return `https:${subtitleUrl}`
  }
  return subtitleUrl
}

const formatSeconds = (seconds: number) => {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = Math.floor(seconds % 60)

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

export const getSubtitleList = async (aid: number, cid: number) => {
  const response = await fetch(`https://api.bilibili.com/x/player/wbi/v2?aid=${aid}&cid=${cid}`, {
    credentials: 'include',
  })
  const json = await response.json() as BilibiliApiResponse<PlayerApiData>
  if (!response.ok || json.code !== 0) {
    throw new Error(json.message ?? '无法读取字幕列表。')
  }

  return json.data?.subtitle?.subtitles ?? []
}

export const getSubtitleBody = async (subtitleUrl: string) => {
  const response = await fetch(normalizeSubtitleUrl(subtitleUrl), {
    credentials: 'include',
  })
  const json = await response.json() as SubtitleResponse
  if (!response.ok || !Array.isArray(json.body)) {
    throw new Error('无法读取字幕内容。')
  }

  return json.body
}

const selectSubtitle = (subtitles: SubtitleInfo[], language?: string) => {
  return subtitles.find(item => item.lan === language)
    ?? subtitles.find(item => item.lan === 'zh-CN')
    ?? subtitles.find(item => item.lan.startsWith('zh'))
    ?? subtitles.find(item => item.lan.startsWith('ai-zh'))
    ?? subtitles[0]
}

export const getSubtitleForAI = async (
  video: ResolvedVideo,
  options: {
    language?: string
    includeTimestamps?: boolean
  } = {},
): Promise<SubtitleForAI> => {
  const subtitles = await getSubtitleList(video.aid, video.cid)
  if (subtitles.length === 0) {
    return {
      available: false,
      reason: '当前视频没有可用字幕。',
      subtitles: [],
      selected: null,
      body: [],
      text: '',
    }
  }

  const selected = selectSubtitle(subtitles, options.language)
  if (!selected) {
    return {
      available: false,
      reason: '没有找到可用字幕。',
      subtitles,
      selected: null,
      body: [],
      text: '',
    }
  }

  const body = await getSubtitleBody(selected.subtitle_url)
  const text = body
    .map(item => options.includeTimestamps === false
      ? item.content
      : `[${formatSeconds(item.from)} - ${formatSeconds(item.to)}] ${item.content}`)
    .join('\n')

  return {
    available: true,
    reason: '',
    subtitles,
    selected,
    body,
    text,
  }
}
