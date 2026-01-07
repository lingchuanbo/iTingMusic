import type { Track } from '@/types'
import { Capacitor } from '@capacitor/core'
import { CapacitorHttp, type HttpResponse } from '@capacitor/core'

// 开发环境使用代理，生产环境直接请求
const API_BASE = import.meta.env.DEV ? '/api' : 'https://music-dl.sayqz.com/api'

// 封装 fetch，在原生平台使用 CapacitorHttp 绕过 CORS
async function nativeFetch(url: string): Promise<Response> {
  if (Capacitor.isNativePlatform()) {
    try {
      const response: HttpResponse = await CapacitorHttp.get({ url })
      return new Response(JSON.stringify(response.data), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' }
      })
    } catch (e) {
      console.error('CapacitorHttp 请求失败:', e)
      throw e
    }
  }
  return fetch(url)
}

// 获取文本内容
async function nativeFetchText(url: string): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    try {
      const response: HttpResponse = await CapacitorHttp.get({ url })
      return typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
    } catch (e) {
      console.error('CapacitorHttp 请求失败:', e)
      throw e
    }
  }
  const res = await fetch(url)
  return res.text()
}

export type MusicSource = 'netease' | 'kuwo' | 'kugou' | 'qq' | 'migu'
export type AudioQuality = '128k' | '320k' | 'flac' | 'flac24bit'

// 获取启用的音乐源
const MUSIC_SOURCES_KEY = 'enabled_music_sources'
const defaultEnabledSources: MusicSource[] = ['netease', 'qq']

export function getEnabledSources(): MusicSource[] {
  try {
    const data = localStorage.getItem(MUSIC_SOURCES_KEY)
    if (data) return JSON.parse(data)
  } catch { }
  return defaultEnabledSources
}

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
    const res = await nativeFetch(`${API_BASE}/?source=${source}&id=${id}&type=info`)
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
export async function getActualMusicUrl(
  source: MusicSource,
  id: string,
  quality: AudioQuality = '320k'
): Promise<string> {
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
    return await nativeFetchText(`${API_BASE}/?source=${source}&id=${id}&type=lrc`)
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
    const url = `${API_BASE}/?source=${source}&type=search&keyword=${encodeURIComponent(keyword)}&limit=${limit}`
    const res = await nativeFetch(url)
    const json: ApiResponse<SearchData> = await res.json()
    if (json.code === 200 && json.data?.results) {
      // 确保每个结果都有正确的 platform 字段
      return json.data.results.map(r => ({
        ...r,
        platform: r.platform || source
      }))
    }
    return []
  } catch (e) {
    console.error(`[${source}] 搜索失败:`, e)
    return []
  }
}

// 6. 聚合搜索 (多平台) - 改用并行单平台搜索，确保QQ源优先
export async function aggregateSearch(keyword: string): Promise<SearchResult[]> {
  const enabledSources = getEnabledSources()

  // 按优先级排序：QQ > 网易云 > 其他
  const sourcePriority: Record<MusicSource, number> = {
    qq: 0,
    netease: 1,
    kugou: 2,
    kuwo: 3,
    migu: 4
  }

  const sortedSources = [...enabledSources].sort(
    (a, b) => (sourcePriority[a] ?? 99) - (sourcePriority[b] ?? 99)
  )

  // 并行搜索所有启用的平台
  const searchPromises = sortedSources.map(source =>
    searchSongs(source, keyword, 10).catch(e => {
      console.error(`[${source}] 搜索出错:`, e)
      return [] as SearchResult[]
    })
  )

  const results = await Promise.all(searchPromises)

  // 按平台优先级顺序合并结果
  const merged: SearchResult[] = []
  for (let i = 0; i < sortedSources.length; i++) {
    const platformResults = results[i]
    merged.push(...platformResults)
  }

  return merged
}

// 7. 获取歌单详情
export async function getPlaylist(source: MusicSource, id: string): Promise<PlaylistInfo | null> {
  try {
    const res = await nativeFetch(`${API_BASE}/?source=${source}&id=${id}&type=playlist`)
    const json: ApiResponse<PlaylistInfo> = await res.json()
    if (json.code === 200) return json.data
    return null
  } catch (e) {
    console.error('获取歌单失败:', e)
    return null
  }
}

// 7.1 获取歌单歌曲列表
export async function getPlaylistSongs(source: MusicSource, id: string): Promise<SearchResult[]> {
  try {
    const playlist = await getPlaylist(source, id)
    if (playlist && playlist.list) {
      return playlist.list.map(item => ({
        id: item.id,
        name: item.name,
        artist: '', // 歌单 API 可能不返回艺人信息
        url: '',
        platform: source
      }))
    }
    return []
  } catch (e) {
    console.error('获取歌单歌曲失败:', e)
    return []
  }
}

// 8. 获取排行榜列表
export async function getToplists(source: MusicSource): Promise<ToplistItem[]> {
  try {
    const res = await nativeFetch(`${API_BASE}/?source=${source}&type=toplists`)
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
    const res = await nativeFetch(`${API_BASE}/?source=${source}&id=${id}&type=toplist`)
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
