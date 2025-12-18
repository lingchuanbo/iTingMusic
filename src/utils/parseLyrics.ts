import type { LyricLine } from '@/types'

export function parseLyrics(lrc: string): LyricLine[] {
  if (!lrc) return []
  
  const lines: LyricLine[] = []
  const regex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\](.*)/g
  let match

  while ((match = regex.exec(lrc)) !== null) {
    const mins = parseInt(match[1])
    const secs = parseInt(match[2])
    const ms = match[3] ? parseInt(match[3].padEnd(3, '0')) : 0
    const time = mins * 60 + secs + ms / 1000
    const text = match[4].trim()
    
    if (text) {
      lines.push({ time, text })
    }
  }

  return lines.sort((a, b) => a.time - b.time)
}

export function getCurrentLyricIndex(lyrics: LyricLine[], currentTime: number): number {
  for (let i = lyrics.length - 1; i >= 0; i--) {
    if (currentTime >= lyrics[i].time) return i
  }
  return -1
}
