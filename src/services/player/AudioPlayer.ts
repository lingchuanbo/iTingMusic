import { Howl } from 'howler'
import { Capacitor } from '@capacitor/core'
import { usePlayerStore } from '@/store/player'
import { audioCache } from '@/services/cache/AudioCache'
import { backgroundMode } from '@/services/player/BackgroundMode'
import { getActualMusicUrl, type MusicSource } from '@/services/source/OnlineApiSource'
import type { Track } from '@/types'

// 扩展 Track 类型
interface OnlineTrack extends Track {
  _platform?: MusicSource
  _songId?: string
}

class AudioPlayer {
  private howl: Howl | null = null
  private rafId: number | null = null

  /**
   * 检查是否在原生平台
   */
  private isNative(): boolean {
    return Capacitor.isNativePlatform()
  }

  /**
   * 播放音频，优先使用缓存
   */
  async play(url: string, track?: Track) {
    this.destroy()
    const store = usePlayerStore()

    let playUrl = url
    const onlineTrack = track as OnlineTrack

    // 在线歌曲尝试使用缓存
    if (track?.source === 'online' && track.id) {
      try {
        // 先检查缓存
        const cachedUrl = await audioCache.get(track.id)
        if (cachedUrl) {
          playUrl = cachedUrl
          console.log('使用缓存播放:', track.title)
        } else {
          // Android 原生平台需要先解析实际 URL
          if (this.isNative() && onlineTrack._platform && onlineTrack._songId) {
            console.log('Android: 解析实际音频URL...')
            const actualUrl = await getActualMusicUrl(onlineTrack._platform, onlineTrack._songId)
            if (actualUrl) {
              playUrl = actualUrl
              console.log('实际音频URL:', actualUrl)
            }
          }
          // 后台缓存（不阻塞播放）
          this.cacheInBackground(track.id, playUrl, track)
        }
      } catch (e) {
        console.warn('缓存检查失败:', e)
      }
    }

    console.log('开始播放:', playUrl)

    // Android 原生平台需要特殊处理
    const isAndroid = this.isNative() && Capacitor.getPlatform() === 'android'

    this.howl = new Howl({
      src: [playUrl],
      html5: true,
      volume: store.volume,
      format: ['mp3', 'flac', 'wav', 'ogg', 'm4a'],
      xhr: isAndroid
        ? {
            withCredentials: false
          }
        : undefined,
      onplay: () => {
        console.log('播放开始')
        store.isPlaying = true
        this.startProgress()
        if (store.backgroundPlayEnabled) {
          backgroundMode.enable()
        }
      },
      onpause: () => {
        store.isPlaying = false
      },
      onend: () => {
        if (store.playMode === 'single') {
          this.howl?.play()
        } else {
          store.nextTrack()
        }
      },
      onload: () => {
        console.log('音频加载完成')
        store.setDuration(this.howl?.duration() || 0)
      },
      onloaderror: (_id, error) => {
        console.error('音频加载失败:', error, playUrl)
        store.isPlaying = false
        if (track?.source === 'online') {
          console.log('尝试播放下一首...')
          setTimeout(() => store.nextTrack(), 1000)
        }
      },
      onplayerror: (_id, error) => {
        console.error('音频播放失败:', error)
        store.isPlaying = false
        if (this.howl) {
          this.howl.once('unlock', () => {
            console.log('音频上下文已解锁，重试播放')
            this.howl?.play()
          })
        }
      }
    })
    this.howl.play()
  }

  /**
   * 后台缓存音频和封面
   */
  private async cacheInBackground(id: string, url: string, track: Track) {
    try {
      await audioCache.cache(id, url, {
        title: track.title,
        artist: track.artist
      })
      console.log('已缓存音频:', track.title)

      if (track.cover) {
        await audioCache.cacheCover(id, track.cover)
        console.log('已缓存封面:', track.title)
      }
    } catch (e) {
      console.warn('后台缓存失败:', e)
    }
  }

  toggle() {
    if (!this.howl) return
    if (this.howl.playing()) {
      this.howl.pause()
    } else {
      this.howl.play()
    }
  }

  seek(time: number) {
    this.howl?.seek(time)
  }

  setVolume(v: number) {
    this.howl?.volume(v)
  }

  private startProgress() {
    const store = usePlayerStore()
    const update = () => {
      if (this.howl?.playing()) {
        store.setCurrentTime(this.howl.seek() as number)
        this.rafId = requestAnimationFrame(update)
      }
    }
    update()
  }

  destroy() {
    if (this.rafId) cancelAnimationFrame(this.rafId)
    this.howl?.unload()
    this.howl = null
    backgroundMode.disable()
  }

  /**
   * 设置后台播放状态
   */
  setBackgroundPlay(enabled: boolean) {
    const store = usePlayerStore()
    store.backgroundPlayEnabled = enabled
    if (enabled && this.howl?.playing()) {
      backgroundMode.enable()
    } else {
      backgroundMode.disable()
    }
  }
}

export const audioPlayer = new AudioPlayer()
