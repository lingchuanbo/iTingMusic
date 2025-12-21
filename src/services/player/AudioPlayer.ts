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
  private audio: HTMLAudioElement | null = null
  private rafId: number | null = null
  private useNativeAudio: boolean = false
  private errorCount: number = 0
  private maxErrors: number = 3

  constructor() {
    // Android 平台强制使用原生 Audio，因为 Howler 在后台会被暂停
    this.useNativeAudio = Capacitor.isNativePlatform()
    
    // 监听页面可见性变化，确保后台播放
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange.bind(this))
    }
  }

  /**
   * 处理页面可见性变化
   */
  private handleVisibilityChange() {
    const store = usePlayerStore()
    if (document.hidden && store.isPlaying && store.backgroundPlayEnabled) {
      // 页面进入后台，确保后台服务运行
      backgroundMode.enable(store.currentTrack?.title, store.currentTrack?.artist)
    }
  }

  /**
   * 重置错误计数
   */
  resetErrorCount() {
    this.errorCount = 0
  }

  /**
   * 处理播放错误，防止无限循环切歌
   */
  private handlePlayError(store: ReturnType<typeof usePlayerStore>) {
    this.errorCount++
    console.log(`播放错误次数: ${this.errorCount}/${this.maxErrors}`)
    
    if (this.errorCount >= this.maxErrors) {
      console.error('连续播放失败次数过多，停止播放')
      this.errorCount = 0
      store.isPlaying = false
      return
    }
    
    // 延迟切换下一首
    setTimeout(() => {
      store.nextTrack()
    }, 1000)
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
          store.setCached(true)
          store.setBuffered(100)
          console.log('使用缓存播放:', track.title)
        } else if (onlineTrack._platform && onlineTrack._songId) {
          store.setCached(false)
          store.setBuffered(0)
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
            this.handlePlayError(store)
            return
          }
        }
      } catch (e) {
        console.warn('获取音频URL失败:', e)
        this.handlePlayError(store)
        return
      }
    } else {
      // 本地文件，直接标记为已缓存
      store.setCached(true)
      store.setBuffered(100)
    }

    // 成功开始播放，重置错误计数
    this.errorCount = 0

    // 在 Android 上，播放前先启动后台服务
    if (this.useNativeAudio && store.backgroundPlayEnabled) {
      await backgroundMode.enable(track?.title, track?.artist)
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

    // 保存当前 track 引用用于事件处理
    const currentTrack = track
    let hasStartedPlaying = false

    this.audio.oncanplaythrough = () => {
      console.log('原生Audio: 可以播放')
      this.audio?.play().catch(e => {
        console.error('原生Audio: play() 失败', e)
      })
    }

    this.audio.onplay = () => {
      console.log('原生Audio: 播放开始')
      hasStartedPlaying = true
      this.errorCount = 0 // 播放成功，重置错误计数
      store.isPlaying = true
      this.startNativeProgress()
      if (store.backgroundPlayEnabled) {
        backgroundMode.enable(currentTrack?.title, currentTrack?.artist)
      }
    }

    this.audio.onpause = () => {
      console.log('原生Audio: 暂停')
      // 只有在非后台状态下才更新 isPlaying
      // 后台暂停可能是系统行为，不应该停止播放状态
      if (!document.hidden) {
        store.isPlaying = false
      }
    }

    this.audio.onended = () => {
      console.log('原生Audio: 播放结束, 播放模式:', store.playMode)
      if (store.playMode === 'single') {
        this.audio?.play()
      } else {
        // 使用 setTimeout 确保在后台也能触发
        setTimeout(() => {
          console.log('原生Audio: 切换下一首')
          store.nextTrack()
        }, 100)
      }
    }

    this.audio.onloadedmetadata = () => {
      console.log('原生Audio: 元数据加载完成, 时长:', this.audio?.duration)
      store.setDuration(this.audio?.duration || 0)
    }

    this.audio.onerror = (e) => {
      // 如果已经开始播放了，忽略错误事件（可能是之前的残留事件）
      if (hasStartedPlaying) {
        console.warn('原生Audio: 忽略播放后的错误事件')
        return
      }
      console.error('原生Audio: 播放失败', e, this.audio?.error)
      store.isPlaying = false
      this.handlePlayError(store)
    }

    // 监听 timeupdate 作为备用进度更新（后台时 RAF 可能不工作）
    this.audio.ontimeupdate = () => {
      if (document.hidden && this.audio) {
        store.setCurrentTime(this.audio.currentTime)
      }
    }

    // 监听缓冲进度
    this.audio.onprogress = () => {
      if (this.audio && this.audio.buffered.length > 0 && this.audio.duration > 0) {
        const bufferedEnd = this.audio.buffered.end(this.audio.buffered.length - 1)
        const bufferedPercent = (bufferedEnd / this.audio.duration) * 100
        store.setBuffered(bufferedPercent)
      }
    }

    // 设置 src 触发加载
    this.audio.src = playUrl
    this.audio.load()
  }

  /**
   * 使用 Howler 播放（桌面浏览器）
   */
  private playWithHowler(
    playUrl: string,
    track: Track | undefined,
    store: ReturnType<typeof usePlayerStore>
  ) {
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
        console.log('Howler: 播放结束, 播放模式:', store.playMode)
        if (store.playMode === 'single') {
          this.howl?.play()
        } else {
          // 延迟一点再切换下一首，确保状态更新
          setTimeout(() => {
            store.nextTrack()
          }, 100)
        }
      },
      onload: () => {
        console.log('Howler: 音频加载完成, 时长:', this.howl?.duration())
        store.setDuration(this.howl?.duration() || 0)
      },
      onloaderror: (_id, error) => {
        console.error('Howler: 音频加载失败:', error, playUrl)
        store.isPlaying = false
        this.handlePlayError(store)
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
    const store = usePlayerStore()
    try {
      await audioCache.cache(id, url, {
        title: track.title,
        artist: track.artist
      })
      console.log('已缓存音频:', track.title)
      // 缓存完成，更新状态
      if (store.currentTrack?.id === id) {
        store.setCached(true)
      }

      if (track.cover) {
        await audioCache.cacheCover(id, track.cover)
        console.log('已缓存封面:', track.title)
      }
    } catch (e) {
      console.warn('后台缓存失败:', e)
    }
  }

  toggle(): boolean {
    if (this.useNativeAudio && this.audio) {
      if (this.audio.paused) {
        this.audio.play()
      } else {
        this.audio.pause()
      }
      return true
    } else if (this.howl) {
      if (this.howl.playing()) {
        this.howl.pause()
      } else {
        this.howl.play()
      }
      return true
    }
    return false // 没有 audio 实例
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
      // 检查 howl 是否已加载
      if (this.howl.state() === 'loaded') {
        this.howl.seek(time)
        // seek 后重新启动进度更新
        if (store.isPlaying) {
          this.startHowlerProgress()
        }
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
    // 不在这里禁用后台服务，让它保持运行直到用户主动停止
  }

  /**
   * 完全停止播放并关闭后台服务
   */
  stop() {
    this.destroy()
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
