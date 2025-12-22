/**
 * 歌曲数据存储服务
 * 独立存储所有歌曲的完整数据，供歌单、喜欢等功能使用
 * 不依赖播放列表
 */
import type { Track } from '@/types'

const STORAGE_KEY = 'zen_tracks_data'

class TrackStorage {
  private tracks: Map<string, Track> = new Map()
  private loaded = false

  private load() {
    if (this.loaded) return
    try {
      const data = localStorage.getItem(STORAGE_KEY)
      if (data) {
        const arr: Track[] = JSON.parse(data)
        arr.forEach(t => this.tracks.set(t.id, t))
      }
    } catch (e) {
      console.error('加载歌曲数据失败:', e)
    }
    this.loaded = true
  }

  private save() {
    try {
      const arr = Array.from(this.tracks.values())
      localStorage.setItem(STORAGE_KEY, JSON.stringify(arr))
    } catch (e) {
      console.error('保存歌曲数据失败:', e)
    }
  }

  /** 保存歌曲（如果不存在则添加，存在则更新） */
  saveTrack(track: Track) {
    this.load()
    // 过滤掉 blob URL（无法持久化）
    if (track.url.startsWith('blob:')) return
    this.tracks.set(track.id, { ...track })
    this.save()
  }

  /** 批量保存歌曲 */
  saveTracks(tracks: Track[]) {
    this.load()
    tracks.forEach(track => {
      if (!track.url.startsWith('blob:')) {
        this.tracks.set(track.id, { ...track })
      }
    })
    this.save()
  }

  /** 获取歌曲 */
  getTrack(id: string): Track | undefined {
    this.load()
    return this.tracks.get(id)
  }

  /** 批量获取歌曲 */
  getTracks(ids: string[]): Track[] {
    this.load()
    return ids.map(id => this.tracks.get(id)).filter(Boolean) as Track[]
  }

  /** 获取所有歌曲 */
  getAllTracks(): Track[] {
    this.load()
    return Array.from(this.tracks.values())
  }

  /** 删除歌曲 */
  removeTrack(id: string) {
    this.load()
    this.tracks.delete(id)
    this.save()
  }

  /** 检查歌曲是否存在 */
  hasTrack(id: string): boolean {
    this.load()
    return this.tracks.has(id)
  }
}

export const trackStorage = new TrackStorage()
