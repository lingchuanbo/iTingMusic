import type { Track } from '@/types'

// 开发环境使用代理，生产环境直接请求
const API_BASE = import.meta.env.DEV ? '/api' : 'https://music-dl.sayqz.com/api'

export type MusicSource = 'netease' | 'kuwo' | 'kugou' | 'qq' | 'migu'
export type AudioQuality = '128k' | '320k' | 'flac' | 'flac24bit'

// API 响应类型
export interface ApiResponse<T> {
  code: number
  message: string
  data: T
  timestamp: string
}

export interface SongInfo {
  name: string
  artist: string
  album: string
  url: string
  pic: string
  lrc: string
}

export interface SearchResult {
  id: string
  name: string
  artist: string
  album?: string
  url: string
  platform: MusicSource
}

export interface SearchData {
  keyword: string
  total?: number
  results: SearchResult[]
}

export interface PlaylistInfo {
  list: { id: string; name: string; types: string[] }[]
  info: { name: string; author: string }
}

export interface ToplistItem {
  id: string
  name: string
  updateFrequency?: string
}

// 1. 获取歌曲基本信息
export async function getSongInfo(source: MusicSource, id: string): Promise<SongInfo | null> {
  try {
    const res = await fetch(`${API_BASE}/?source=${source}&id=${id}&type=info`)
    const json: ApiResponse<SongInfo> = await res.json()
    if (json.code === 200) return json.data
    return null
  } catch (e) {
    console.error('获取歌曲信息失败:', e)
    return null
  }
}

// 2. 获取音乐文件链接 (直接返回API端点URL)
export function getMusicUrl(source: MusicSource, id: string, quality: AudioQuality = '320k'): string {
  return `${API_BASE}/?source=${source}&id=${id}&type=url&br=${quality}`
}

// 2.1 获取实际的音频文件URL（解析重定向）
export async function getActualMusicUrl(source: MusicSource, id: string, quality: AudioQuality = '320k'): Promise<string> {
  // 直接返回 API URL，让播放器自己处理重定向
  // 这样可以避免 CORS 问题
  return getMusicUrl(source, id, quality)
}

// 3. 获取专辑封面
export function getCoverUrl(source: MusicSource, id: string): string {
  return `${API_BASE}/?source=${source}&id=${id}&type=pic`
}

// 4. 获取歌词
export async function getLyrics(source: MusicSource, id: string): Promise<string> {
  try {
    const res = await fetch(`${API_BASE}/?source=${source}&id=${id}&type=lrc`)
    return await res.text()
  } catch (e) {
    console.error('获取歌词失败:', e)
    return ''
  }
}

// 5. 搜索歌曲 (单平台)
export async function searchSongs(
  source: MusicSource,
  keyword: string,
  limit: number = 20
): Promise<SearchResult[]> {
  try {
    const res = await fetch(
      `${API_BASE}/?source=${source}&type=search&keyword=${encodeURIComponent(keyword)}&limit=${limit}`
    )
    const json: ApiResponse<SearchData> = await res.json()
    if (json.code === 200) return json.data.results
    return []
  } catch (e) {
    console.error('搜索失败:', e)
    return []
  }
}

// 6. 聚合搜索 (多平台)
export async function aggregateSearch(keyword: string): Promise<SearchResult[]> {
  try {
    const res = await fetch(
      `${API_BASE}/?type=aggregateSearch&keyword=${encodeURIComponent(keyword)}`
    )
    const json: ApiResponse<SearchData> = await res.json()
    if (json.code === 200) return json.data.results
    return []
  } catch (e) {
    console.error('聚合搜索失败:', e)
    return []
  }
}

// 7. 获取歌单详情
export async function getPlaylist(source: MusicSource, id: string): Promise<PlaylistInfo | null> {
  try {
    const res = await fetch(`${API_BASE}/?source=${source}&id=${id}&type=playlist`)
    const json: ApiResponse<PlaylistInfo> = await res.json()
    if (json.code === 200) return json.data
    return null
  } catch (e) {
    console.error('获取歌单失败:', e)
    return null
  }
}

// 8. 获取排行榜列表
export async function getToplists(source: MusicSource): Promise<ToplistItem[]> {
  try {
    const res = await fetch(`${API_BASE}/?source=${source}&type=toplists`)
    const json: ApiResponse<{ list: ToplistItem[] }> = await res.json()
    if (json.code === 200) return json.data.list
    return []
  } catch (e) {
    console.error('获取排行榜列表失败:', e)
    return []
  }
}

// 9. 获取排行榜歌曲
export async function getToplistSongs(source: MusicSource, id: string): Promise<SearchResult[]> {
  try {
    const res = await fetch(`${API_BASE}/?source=${source}&id=${id}&type=toplist`)
    const json: ApiResponse<{ list: SearchResult[]; source: string }> = await res.json()
    if (json.code === 200) {
      return json.data.list.map(item => ({ ...item, platform: source }))
    }
    return []
  } catch (e) {
    console.error('获取排行榜歌曲失败:', e)
    return []
  }
}

// ========== 便捷方法：转换为 Track 类型 ==========

export function searchResultToTrack(result: SearchResult, quality: AudioQuality = '320k'): Track {
  return {
    id: `${result.platform}-${result.id}`,
    title: result.name,
    artist: result.artist,
    album: result.album,
    cover: getCoverUrl(result.platform, result.id),
    url: getMusicUrl(result.platform, result.id, quality),
    source: 'online',
    // 额外存储平台信息用于获取歌词
    _platform: result.platform,
    _songId: result.id
  } as Track & { _platform: MusicSource; _songId: string }
}

// 搜索并直接返回 Track 数组
export async function searchOnline(keyword: string, quality: AudioQuality = '320k'): Promise<Track[]> {
  const results = await aggregateSearch(keyword)
  return results.map(r => searchResultToTrack(r, quality))
}
