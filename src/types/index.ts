export interface Track {
  id: string
  title: string
  artist: string
  album?: string
  cover?: string
  url: string
  duration?: number
  lrc?: string
  source: 'local' | 'webdav' | 'online'
  // 在线歌曲额外信息
  _platform?: string
  _songId?: string
}

export interface LyricLine {
  time: number
  text: string
}

export type PlayMode = 'sequence' | 'loop' | 'shuffle' | 'single'

export type SourceType = 'local' | 'webdav' | 'online'

// 自定义歌单
export interface Playlist {
  id: string
  name: string
  cover?: string
  trackIds: string[]
  createdAt: number
  updatedAt: number
}
