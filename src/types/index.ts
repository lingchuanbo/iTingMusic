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
  _cached?: boolean
  // GD Studio API 专用字段
  _picId?: string
  _lyricId?: string
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

// ========== 推荐系统类型 ==========

// 用户行为类型
export type BehaviorType =
  | 'play_start'        // 开始播放
  | 'play_complete'     // 完整播放（>90%）
  | 'skip'              // 跳过（<30秒）
  | 'loop'              // 单曲循环
  | 'favorite'          // 收藏
  | 'unfavorite'        // 取消收藏
  | 'add_playlist'      // 添加到歌单
  | 'search'            // 搜索
  | 'feedback_positive' // 推荐反馈：喜欢
  | 'feedback_negative' // 推荐反馈：不喜欢

// 上下文时间段
export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night'

// 用户行为记录
export interface UserBehavior {
  id: string
  type: BehaviorType
  trackId?: string
  trackMeta?: {
    title: string
    artist: string
    platform?: string
  }
  keyword?: string           // 搜索关键词
  playlistId?: string
  context: {
    timeOfDay: TimeOfDay
    dayOfWeek: number        // 0-6
  }
  metrics?: {
    listenDuration?: number   // 播放时长(ms)
    completionRate?: number   // 完播率(0-1)
  }
  timestamp: number
}

// 歌曲统计信息
export interface TrackStats {
  trackId: string
  artist: string
  platform?: string
  playCount: number
  completeCount: number      // 完整播放次数
  skipCount: number
  totalDuration: number      // 总播放时长
  lastPlayedAt: number
  avgCompletionRate: number  // 平均完播率
}

// 用户画像
export interface UserProfile {
  favoriteArtists: { name: string; count: number }[]
  favoritePlatforms: { name: string; count: number }[]
  preferredTimeOfDay: TimeOfDay
  totalPlayCount: number
  avgCompletionRate: number
}

// 推荐项目
export interface RecommendItem {
  track: Track
  score: number              // 推荐分数
  reason?: string            // AI生成的推荐理由
  type: 'hot' | 'similar' | 'explore'
}
