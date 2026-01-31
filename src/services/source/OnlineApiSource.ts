/**
 * 在线音乐 API 源
 * 封装了搜索、获取歌曲URL、封面、歌词等功能
 * 现在通过 ApiProviders 抽象层支持多个 API 提供商
 */
import type { Track } from '@/types'
import {
  getActiveProvider,
  getActiveProviderId,
  executeTuneHubMethod,
  type MusicPlatform,
  type AudioQuality,
  type SearchResult,
  type ApiProviderType
} from './ApiProviders'

// 重新导出类型供其他模块使用
export type { MusicPlatform as MusicSource, AudioQuality, SearchResult, ApiProviderType }

// ========== 音乐源配置 ==========

const MUSIC_SOURCES_KEY = 'enabled_music_sources'
const defaultEnabledSources: MusicPlatform[] = ['netease', 'qq', 'kuwo']

export function getEnabledSources(): MusicPlatform[] {
  try {
    const data = localStorage.getItem(MUSIC_SOURCES_KEY)
    if (data) return JSON.parse(data)
  } catch { }
  return defaultEnabledSources
}

export function setEnabledSources(sources: MusicPlatform[]): void {
  localStorage.setItem(MUSIC_SOURCES_KEY, JSON.stringify(sources))
}

// ========== API 响应类型 (兼容旧代码) ==========

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
  pic?: string
}

// ========== 核心 API 函数 ==========

// 1. 获取歌曲基本信息 (TuneHub 不直接支持，返回 null)
export async function getSongInfo(source: MusicPlatform, id: string): Promise<SongInfo | null> {
  // TuneHub API 不支持单独获取歌曲信息，需要通过 parse 接口
  // GD Studio 也需要分开调用
  console.log(`[OnlineApiSource] getSongInfo 不支持: ${source}/${id}`)
  return null
}

// 2. 获取音乐文件链接
export function getMusicUrl(source: MusicPlatform, id: string, quality: AudioQuality = '320k'): string {
  return getActiveProvider().getMusicUrl(source, id, quality)
}

// 2.1 获取实际的音频文件URL (GD Studio 需要异步解析JSON)
export async function getActualMusicUrl(
  source: MusicPlatform,
  id: string,
  quality: AudioQuality = '320k'
): Promise<string> {
  return getActiveProvider().getActualMusicUrl(source, id, quality)
}

// 3. 获取专辑封面
export function getCoverUrl(source: MusicPlatform, id: string, picId?: string): string {
  return getActiveProvider().getCoverUrl(source, id, picId)
}

// 3.1 获取实际封面图片URL (GD Studio 需要异步解析JSON)
export async function getActualCoverUrl(source: MusicPlatform, id: string, picId?: string): Promise<string> {
  return getActiveProvider().getActualCoverUrl(source, id, picId)
}

// 4. 获取歌词
export async function getLyrics(source: MusicPlatform, id: string, lyricId?: string): Promise<string> {
  return getActiveProvider().getLyrics(source, id, lyricId)
}

// 5. 搜索歌曲 (单平台)
export async function searchSongs(
  source: MusicPlatform,
  keyword: string,
  limit: number = 20
): Promise<SearchResult[]> {
  return getActiveProvider().search(source, keyword, limit)
}

// 6. 聚合搜索 (多平台)
export async function aggregateSearch(keyword: string): Promise<SearchResult[]> {
  const enabledSources = getEnabledSources()
  const provider = getActiveProvider()

  // 过滤出当前 provider 支持的平台
  const supportedSources = enabledSources.filter(s =>
    provider.supportedPlatforms.includes(s)
  )

  // 按优先级排序
  const sourcePriority: Record<MusicPlatform, number> = {
    qq: 1,
    tencent: 2,
    kuwo: 3,
    netease: 4,
    joox: 5,
    kugou: 6,
    migu: 7
  }

  const sortedSources = [...supportedSources].sort(
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

  // 合并结果
  const merged: SearchResult[] = []
  for (let i = 0; i < sortedSources.length; i++) {
    merged.push(...results[i])
  }

  return merged
}

// 7. 获取歌单详情 (使用 TuneHub v1/methods/playlist API)
export async function getPlaylist(source: MusicPlatform, id: string): Promise<PlaylistInfo | null> {
  if (getActiveProviderId() !== 'sayqz') return null
  try {
    const results = await executeTuneHubMethod(source, 'playlist', { id })
    if (results && results.length > 0) {
      return {
        list: results.map((item: any) => ({
          id: String(item.id),
          name: item.name || '',
          types: []
        })),
        info: { name: '', author: '' }
      }
    }
    return null
  } catch (e) {
    console.error('获取歌单失败:', e)
    return null
  }
}

// 7.1 获取歌单歌曲列表
export async function getPlaylistSongs(source: MusicPlatform, id: string): Promise<SearchResult[]> {
  try {
    const playlist = await getPlaylist(source, id)
    if (playlist && playlist.list) {
      return playlist.list.map(item => ({
        id: item.id,
        name: item.name,
        artist: '',
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

// 8. 获取排行榜列表 (使用 TuneHub v1/methods API)
export async function getToplists(source: MusicPlatform): Promise<ToplistItem[]> {
  if (getActiveProviderId() !== 'sayqz') return []
  try {
    const results = await executeTuneHubMethod(source, 'toplists', {})
    return results.map((item: any) => ({
      id: String(item.id),
      name: item.name || '',
      updateFrequency: item.updateFrequency || '',
      pic: item.pic || item.cover || item.picUrl || ''
    }))
  } catch (e) {
    console.error('获取排行榜列表失败:', e)
    return []
  }
}

// 9. 获取排行榜歌曲 (使用 TuneHub v1/methods API)
export async function getToplistSongs(source: MusicPlatform, id: string): Promise<SearchResult[]> {
  if (getActiveProviderId() !== 'sayqz') return []
  try {
    const results = await executeTuneHubMethod(source, 'toplist', { id })
    return results.map((item: any) => ({
      id: String(item.id),
      name: item.name || '',
      artist: item.artist || '',
      album: item.album || '',
      cover: item.cover || item.pic || item.picUrl || '',
      url: '',
      platform: source
    }))
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
    cover: result.cover || getCoverUrl(result.platform, result.id, result.pic_id),
    url: getMusicUrl(result.platform, result.id, quality),
    source: 'online',
    // 额外存储平台信息用于获取歌词
    _platform: result.platform,
    _songId: result.id,
    _picId: result.pic_id,
    _lyricId: result.lyric_id
  } as Track & { _platform: MusicPlatform; _songId: string; _picId?: string; _lyricId?: string }
}

// 异步版本：正确解析 GD Studio 封面 URL
export async function searchResultToTrackAsync(result: SearchResult, quality: AudioQuality = '320k'): Promise<Track> {
  const [actualCover, lyrics] = await Promise.all([
    result.cover ? Promise.resolve(result.cover) : getActualCoverUrl(result.platform, result.id, result.pic_id),
    getLyrics(result.platform, result.id, result.lyric_id)
  ])

  return {
    id: `${result.platform}-${result.id}`,
    title: result.name,
    artist: result.artist,
    album: result.album,
    cover: actualCover,
    url: getMusicUrl(result.platform, result.id, quality),
    lrc: lyrics,
    source: 'online',
    _platform: result.platform,
    _songId: result.id,
    _picId: result.pic_id,
    _lyricId: result.lyric_id
  } as Track & { _platform: MusicPlatform; _songId: string; _picId?: string; _lyricId?: string }
}

// 搜索并直接返回 Track 数组
export async function searchOnline(keyword: string, quality: AudioQuality = '320k'): Promise<Track[]> {
  const results = await aggregateSearch(keyword)
  return results.map(r => searchResultToTrack(r, quality))
}
