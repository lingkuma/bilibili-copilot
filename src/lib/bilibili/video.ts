import type { DetectedVideo, ResolvedVideo } from '../types'

interface BilibiliApiResponse<T> {
  code: number
  message?: string
  data?: T
}

interface ViewApiData {
  aid: number
  bvid: string
  cid: number
  title: string
  pages?: Array<{
    cid: number
    page: number
    part: string
  }>
}

export const extractBvidFromUrl = (url: string) => {
  const match = /\/video\/(BV[a-zA-Z0-9]+)/.exec(url)
  return match?.[1]
}

export const extractPageFromUrl = (url: string) => {
  const page = new URL(url).searchParams.get('p')
  const parsed = page ? Number(page) : 1
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

export const stripBilibiliTitleSuffix = (title: string) => {
  return title
    .replace(/_哔哩哔哩_bilibili$/u, '')
    .replace(/-哔哩哔哩$/u, '')
    .trim()
}

export const resolveVideo = async (detected: DetectedVideo): Promise<ResolvedVideo> => {
  if (detected.aid && detected.cid && detected.bvid) {
    return {
      aid: detected.aid,
      bvid: detected.bvid,
      cid: detected.cid,
      page: detected.page ?? 1,
      title: detected.title || detected.bvid,
      url: detected.url,
    }
  }

  const bvid = detected.bvid ?? extractBvidFromUrl(detected.url)
  if (!bvid) {
    throw new Error('当前页面不是可识别的 Bilibili 视频页。')
  }

  const response = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
    credentials: 'include',
  })
  const json = await response.json() as BilibiliApiResponse<ViewApiData>
  if (!response.ok || json.code !== 0 || !json.data) {
    throw new Error(json.message ?? '无法读取 Bilibili 视频信息。')
  }

  const page = detected.page ?? extractPageFromUrl(detected.url)
  const pageInfo = json.data.pages?.find(item => item.page === page)

  return {
    aid: json.data.aid,
    bvid: json.data.bvid,
    cid: pageInfo?.cid ?? detected.cid ?? json.data.cid,
    page,
    title: detected.title || json.data.title,
    url: detected.url,
  }
}
