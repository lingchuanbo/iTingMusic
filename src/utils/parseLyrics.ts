import type { LyricLine } from '@/types'

// 歌词解析缓存，避免重复解析
const lyricsCache = new Map<string, LyricLine[]>()
const MAX_CACHE_SIZE = 50

export function parseLyrics(lrc: string): LyricLine[] {
  if (!lrc) return []

  // 检查缓存
  const cacheKey = lrc.slice(0, 100) // 使用前100字符作为key
  if (lyricsCache.has(cacheKey)) {
    return lyricsCache.get(cacheKey)!
  }

  const lines: LyricLine[] = []
  const regex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\](.*)/g
  let match

  while ((match = regex.exec(lrc)) !== null) {
    const mins = parseInt(match[1])
    const secs = parseInt(match[2])
    const ms = match[3] ? parseInt(match[3].padEnd(3, '0')) : 0
    const time = mins * 60 + secs + ms / 1000
    const text = match[4].trim()
    lines.push({ time, text })
  }

  const result = lines.sort((a, b) => a.time - b.time)

  // 缓存结果，限制缓存大小
  if (lyricsCache.size >= MAX_CACHE_SIZE) {
    const firstKey = lyricsCache.keys().next().value
    if (firstKey) lyricsCache.delete(firstKey)
  }
  lyricsCache.set(cacheKey, result)

  return result
}

// 使用二分查找优化歌词索引查找
export function getCurrentLyricIndex(lyrics: LyricLine[], currentTime: number): number {
  if (lyrics.length === 0) return -1

  let left = 0
  let right = lyrics.length - 1
  let result = -1

  while (left <= right) {
    const mid = Math.floor((left + right) / 2)
    if (lyrics[mid].time <= currentTime) {
      result = mid
      left = mid + 1
    } else {
      right = mid - 1
    }
  }

  return result
}
