import { Howl } from 'howler'
import { Capacitor } from '@capacitor/core'
import { usePlayerStore } from '@/store/player'
import { useOfflineStore } from '@/store/offline'
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
  private controlCallbackSetup: boolean = false

  constructor() {
    // Android 平台强制使用原生 Audio，因为 Howler 在后台会被暂停
    this.useNativeAudio = Capacitor.isNativePlatform()

    // 监听页面可见性变化，确保后台播放
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange.bind(this))
    }

    // 设置通知栏控制回调
    this.setupNotificationControls()
  }

  /**
   * 设置通知栏控制回调
   */
  private setupNotificationControls() {
    if (this.controlCallbackSetup) return
    this.controlCallbackSetup = true

    backgroundMode.setControlCallback((action) => {
      const store = usePlayerStore()

      switch (action) {
        case 'playPause':
          // 只调用 toggle，它会处理实际的播放/暂停
          // store.isPlaying 会在 audio 的 onplay/onpause 事件中更新
          const toggled = this.toggle()
          if (toggled) {
            // 预先更新通知栏状态
            const newState = this.audio ? !this.audio.paused : (this.howl ? this.howl.playing() : false)
            backgroundMode.updatePlayState(newState)
          }
          break
        case 'next':
          store.nextTrack()
          break
        case 'prev':
          store.prevTrack()
          break
        case 'toggleLyrics':
          store.toggleLyrics()
          break
        case 'audioFocusLoss':
          // 音频焦点丢失（来电等），暂停播放
          console.log('AudioPlayer: 音频焦点丢失，暂停播放')
          if (this.audio && !this.audio.paused) {
            this.audio.pause()
          } else if (this.howl && this.howl.playing()) {
            this.howl.pause()
          }
          store.isPlaying = false
          break
        case 'audioFocusGain':
          // 音频焦点恢复，由原生层决定是否恢复播放
          // 如果原生层设置了 resumeOnFocusGain，它会发送这个事件
          console.log('AudioPlayer: 音频焦点恢复，恢复播放')
          if (this.audio) {
            this.audio.play().catch(e => console.warn('恢复播放失败:', e))
          } else if (this.howl) {
            this.howl.play()
          }
          break
        case 'audioBecomingNoisy':
          // 耳机拔出/蓝牙断开，暂停播放
          console.log('AudioPlayer: 耳机断开，暂停播放')
          if (this.audio && !this.audio.paused) {
            this.audio.pause()
          } else if (this.howl && this.howl.playing()) {
            this.howl.pause()
          }
          store.isPlaying = false
          break
      }
    })
  }

  /**
   * 处理页面可见性变化
   */
  private handleVisibilityChange() {
    const store = usePlayerStore()
    if (document.hidden && store.isPlaying && store.backgroundPlayEnabled) {
      // 页面进入后台，确保后台服务运行
      backgroundMode.enable({
        title: store.currentTrack?.title,
        artist: store.currentTrack?.artist,
        cover: store.currentTrack?.cover,
        isPlaying: true,
        duration: store.duration
      })
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
    const offlineStore = useOfflineStore()

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
        } else if (offlineStore.isOfflineMode) {
          // 离线模式下，没有缓存则跳过
          this.handlePlayError(store)
          return
        } else if (onlineTrack._platform && onlineTrack._songId) {
          store.setCached(false)
          store.setBuffered(0)
          // 解析实际音频 URL
          const actualUrl = await getActualMusicUrl(onlineTrack._platform, onlineTrack._songId)
          if (actualUrl) {
            playUrl = actualUrl
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
      await backgroundMode.enable({
        title: track?.title,
        artist: track?.artist,
        cover: track?.cover,
        isPlaying: true,
        duration: 0
      })
    }

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
      this.audio?.play().catch(e => {
        console.error('原生Audio: play() 失败', e)
      })
    }

    this.audio.onplay = () => {
      hasStartedPlaying = true
      this.errorCount = 0 // 播放成功，重置错误计数
      store.isPlaying = true
      this.startNativeProgress()

      if (store.backgroundPlayEnabled) {
        backgroundMode.enable({
          title: currentTrack?.title,
          artist: currentTrack?.artist,
          cover: currentTrack?.cover,
          isPlaying: true,
          duration: this.audio?.duration || 0
        })
        backgroundMode.updatePlayState(true)
      }
    }

    this.audio.onpause = () => {
      // 只有在非后台状态下才更新 isPlaying
      if (!document.hidden) {
        store.isPlaying = false
      }
      // 更新通知栏状态
      backgroundMode.updatePlayState(false)
    }

    this.audio.onended = () => {
      if (store.playMode === 'single') {
        // 单曲循环
        if (this.audio) {
          this.audio.currentTime = 0
          this.audio.play()
        }
      } else {
        // 切换下一首
        store.nextTrack()
      }
    }

    this.audio.onloadedmetadata = () => {
      const audioDuration = this.audio?.duration || 0
      store.setDuration(audioDuration)

      // 更新通知栏时长
      if (store.backgroundPlayEnabled && currentTrack && audioDuration > 0) {
        backgroundMode.updateNotification({
          title: currentTrack.title,
          artist: currentTrack.artist,
          cover: currentTrack.cover,
          duration: audioDuration
        })
      }
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
      if (this.audio) {
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
        store.isPlaying = true
        this.startHowlerProgress()
        if (store.backgroundPlayEnabled) {
          backgroundMode.enable({
            title: track?.title,
            artist: track?.artist,
            cover: track?.cover,
            isPlaying: true,
            duration: this.howl?.duration() || 0
          })
        }
      },
      onpause: () => {
        store.isPlaying = false
      },
      onend: () => {
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
      // 缓存完成，更新状态
      if (store.currentTrack?.id === id) {
        store.setCached(true)
      }

      if (track.cover) {
        await audioCache.cacheCover(id, track.cover)
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
    let lastUpdate = 0
    const UPDATE_INTERVAL = 250 // 降低更新频率到 250ms，省电

    const update = (timestamp: number) => {
      if (this.audio && !this.audio.paused) {
        // 节流：只在间隔时间后更新
        if (timestamp - lastUpdate >= UPDATE_INTERVAL) {
          store.setCurrentTime(this.audio.currentTime)
          lastUpdate = timestamp
        }
        // 页面可见时才继续 RAF，后台时依赖 timeupdate 事件
        if (!document.hidden) {
          this.rafId = requestAnimationFrame(update)
        } else {
          this.rafId = null
        }
      } else {
        this.rafId = null
      }
    }
    this.rafId = requestAnimationFrame(update)
  }

  private startHowlerProgress() {
    // 先取消之前的更新循环
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }

    const store = usePlayerStore()
    let lastUpdate = 0
    const UPDATE_INTERVAL = 250 // 降低更新频率到 250ms，省电

    const update = (timestamp: number) => {
      // 使用 store.isPlaying 判断，因为 howl.playing() 在某些情况下不可靠
      if (this.howl && store.isPlaying) {
        // 节流：只在间隔时间后更新
        if (timestamp - lastUpdate >= UPDATE_INTERVAL) {
          const currentSeek = this.howl.seek()
          if (typeof currentSeek === 'number') {
            store.setCurrentTime(currentSeek)
          }
          lastUpdate = timestamp
        }
        // 页面可见时才继续 RAF
        if (!document.hidden) {
          this.rafId = requestAnimationFrame(update)
        } else {
          this.rafId = null
        }
      } else {
        this.rafId = null
      }
    }
    this.rafId = requestAnimationFrame(update)
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
      backgroundMode.enable({
        title: track?.title || store.currentTrack?.title,
        artist: track?.artist || store.currentTrack?.artist,
        cover: track?.cover || store.currentTrack?.cover,
        isPlaying: true,
        duration: store.duration
      })
    } else if (!enabled) {
      backgroundMode.disable()
    }
  }

  /**
   * 更新通知栏信息（切歌时调用）
   */
  updateNotification(title: string, artist: string, cover?: string, duration?: number) {
    backgroundMode.updateNotification({ title, artist, cover, duration })
  }
}


export const audioPlayer = new AudioPlayer()
