import { Howl } from 'howler'
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
  private audio: HTMLAudioElement | null = null
  private rafId: number | null = null
  private useNativeAudio: boolean = false

  constructor() {
    // 统一使用 Howler，它在安卓上也能工作
    this.useNativeAudio = false
  }

  /**
   * 播放音频，优先使用缓存
   */
  async play(url: string, track?: Track) {
    this.destroy()
    const store = usePlayerStore()

    let playUrl = url
    const onlineTrack = track as OnlineTrack

    // 在线歌曲处理
    if (track?.source === 'online' && track.id) {
      try {
        // 先检查缓存
        const cachedUrl = await audioCache.get(track.id)
        if (cachedUrl) {
          playUrl = cachedUrl
          console.log('使用缓存播放:', track.title)
        } else if (onlineTrack._platform && onlineTrack._songId) {
          // 解析实际音频 URL
          console.log('解析实际音频URL...')
          const actualUrl = await getActualMusicUrl(onlineTrack._platform, onlineTrack._songId)
          if (actualUrl) {
            playUrl = actualUrl
            console.log('实际音频URL:', actualUrl)
            // 后台缓存
            this.cacheInBackground(track.id, playUrl, track)
          } else {
            console.error('无法获取音频URL')
            return
          }
        }
      } catch (e) {
        console.warn('获取音频URL失败:', e)
      }
    }

    console.log('开始播放:', playUrl, '使用原生Audio:', this.useNativeAudio)

    if (this.useNativeAudio) {
      this.playWithNativeAudio(playUrl, track, store)
    } else {
      this.playWithHowler(playUrl, track, store)
    }
  }

  /**
   * 使用原生 HTML5 Audio 播放（安卓）
   */
  private playWithNativeAudio(playUrl: string, track: Track | undefined, store: ReturnType<typeof usePlayerStore>) {
    this.audio = new Audio()
    this.audio.crossOrigin = 'anonymous'
    this.audio.preload = 'auto'
    this.audio.volume = store.volume

    this.audio.oncanplaythrough = () => {
      console.log('原生Audio: 可以播放')
      this.audio?.play().catch(e => {
        console.error('原生Audio: play() 失败', e)
      })
    }

    this.audio.onplay = () => {
      console.log('原生Audio: 播放开始')
      store.isPlaying = true
      this.startNativeProgress()
      if (store.backgroundPlayEnabled) {
        backgroundMode.enable(track?.title, track?.artist)
      }
    }

    this.audio.onpause = () => {
      store.isPlaying = false
    }

    this.audio.onended = () => {
      if (store.playMode === 'single') {
        this.audio?.play()
      } else {
        store.nextTrack()
      }
    }

    this.audio.onloadedmetadata = () => {
      console.log('原生Audio: 元数据加载完成, 时长:', this.audio?.duration)
      store.setDuration(this.audio?.duration || 0)
    }

    this.audio.onerror = (e) => {
      console.error('原生Audio: 播放失败', e, this.audio?.error)
      store.isPlaying = false
      if (track?.source === 'online') {
        console.log('尝试播放下一首...')
        setTimeout(() => store.nextTrack(), 2000)
      }
    }

    // 设置 src 触发加载
    this.audio.src = playUrl
    this.audio.load()
  }

  /**
   * 使用 Howler 播放（桌面浏览器）
   */
  private playWithHowler(playUrl: string, track: Track | undefined, store: ReturnType<typeof usePlayerStore>) {
    this.howl = new Howl({
      src: [playUrl],
      html5: true,
      volume: store.volume,
      format: ['mp3', 'flac', 'wav', 'ogg', 'm4a'],
      onplay: () => {
        console.log('Howler: 播放开始')
        store.isPlaying = true
        this.startHowlerProgress()
        if (store.backgroundPlayEnabled) {
          backgroundMode.enable(track?.title, track?.artist)
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
        console.log('Howler: 音频加载完成')
        store.setDuration(this.howl?.duration() || 0)
      },
      onloaderror: (_id, error) => {
        console.error('Howler: 音频加载失败:', error, playUrl)
        store.isPlaying = false
        if (track?.source === 'online') {
          setTimeout(() => store.nextTrack(), 1000)
        }
      },
      onplayerror: (_id, error) => {
        console.error('Howler: 音频播放失败:', error)
        store.isPlaying = false
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
    if (this.useNativeAudio && this.audio) {
      if (this.audio.paused) {
        this.audio.play()
      } else {
        this.audio.pause()
      }
    } else if (this.howl) {
      if (this.howl.playing()) {
        this.howl.pause()
      } else {
        this.howl.play()
      }
    }
  }

  seek(time: number) {
    const store = usePlayerStore()
    // 立即更新 store 中的时间
    store.setCurrentTime(time)
    
    if (this.useNativeAudio && this.audio) {
      this.audio.currentTime = time
      // 确保进度更新继续
      if (!this.audio.paused) {
        this.startNativeProgress()
      }
    } else if (this.howl) {
      this.howl.seek(time)
      // seek 后延迟重新启动进度更新，因为 playing() 可能暂时返回 false
      if (store.isPlaying) {
        setTimeout(() => {
          if (this.howl && store.isPlaying) {
            this.startHowlerProgress()
          }
        }, 50)
      }
    }
  }

  setVolume(v: number) {
    if (this.useNativeAudio && this.audio) {
      this.audio.volume = v
    } else {
      this.howl?.volume(v)
    }
  }

  private startNativeProgress() {
    // 先取消之前的更新循环
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    
    const store = usePlayerStore()
    const update = () => {
      if (this.audio && !this.audio.paused) {
        store.setCurrentTime(this.audio.currentTime)
        this.rafId = requestAnimationFrame(update)
      } else {
        this.rafId = null
      }
    }
    update()
  }

  private startHowlerProgress() {
    // 先取消之前的更新循环
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    
    const store = usePlayerStore()
    const update = () => {
      // 使用 store.isPlaying 判断，因为 howl.playing() 在某些情况下不可靠
      if (this.howl && store.isPlaying) {
        const currentSeek = this.howl.seek()
        if (typeof currentSeek === 'number') {
          store.setCurrentTime(currentSeek)
        }
        this.rafId = requestAnimationFrame(update)
      } else {
        this.rafId = null
      }
    }
    update()
  }

  destroy() {
    if (this.rafId) cancelAnimationFrame(this.rafId)
    
    if (this.audio) {
      this.audio.pause()
      this.audio.src = ''
      this.audio = null
    }
    
    this.howl?.unload()
    this.howl = null
    backgroundMode.disable()
  }

  /**
   * 设置后台播放状态
   */
  setBackgroundPlay(enabled: boolean, track?: Track) {
    const store = usePlayerStore()
    store.backgroundPlayEnabled = enabled
    const isPlaying = this.useNativeAudio 
      ? (this.audio && !this.audio.paused)
      : this.howl?.playing()
    
    if (enabled && isPlaying) {
      backgroundMode.enable(track?.title || store.currentTrack?.title, track?.artist || store.currentTrack?.artist)
    } else if (!enabled) {
      backgroundMode.disable()
    }
  }

  /**
   * 更新通知栏信息（切歌时调用）
   */
  updateNotification(title: string, artist: string) {
    backgroundMode.updateNotification(title, artist)
  }
}


export const audioPlayer = new AudioPlayer()
