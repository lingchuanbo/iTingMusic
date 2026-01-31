import { Howl } from 'howler'
import { Capacitor } from '@capacitor/core'
import { usePlayerStore } from '@/store/player'
import { useOfflineStore } from '@/store/offline'
import { audioCache } from '@/services/cache/AudioCache'
import { backgroundMode } from '@/services/player/BackgroundMode'
import { equalizerService } from '@/services/player/EqualizerService'
import { nativeAudioPlayer } from '@/services/player/NativeAudioPlayer'
import { getActualMusicUrl, searchResultToTrackAsync, type MusicSource } from '@/services/source/OnlineApiSource'
import { searchAndMatch } from '@/utils/songMatcher'
import { getActiveProvider } from '@/services/source/ApiProviders'
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
  private useExoPlayer: boolean = false // 使用原生 ExoPlayer
  private errorCount: number = 0
  private maxErrors: number = 3
  private retryCount: number = 0
  private maxRetries: number = 2  // 每首歌最多重试次数
  private controlCallbackSetup: boolean = false

  constructor() {
    // Android 平台使用原生 ExoPlayer
    this.useExoPlayer = Capacitor.isNativePlatform()

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

    // Android ExoPlayer 处理自己的通知和控制，不需要 backgroundMode
    if (this.useExoPlayer) return

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
    // Android ExoPlayer 处理自己的后台逻辑，不需要旧的 backgroundMode
    if (this.useExoPlayer) return

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
    this.retryCount = 0
  }

  /**
   * 处理播放错误：通过歌曲名+艺人重新搜索匹配，获取新的URL
   */
  private async handlePlayError(store: ReturnType<typeof usePlayerStore>) {
    const track = store.currentTrack

    // 先尝试重新搜索匹配当前歌曲
    if (this.retryCount < this.maxRetries && track) {
      this.retryCount++
      console.log(`AudioPlayer: 播放失败，通过歌名+艺人重新搜索 (${this.retryCount}/${this.maxRetries})`)

      try {
        // 使用当前 API 服务支持的平台重新搜索
        const provider = getActiveProvider()
        const sources = provider.supportedPlatforms.slice(0, 3) as MusicSource[] // 取前3个平台

        const match = await searchAndMatch(track.title, track.artist, sources)

        if (match) {
          console.log(`AudioPlayer: 重新匹配成功: ${match.name} - ${match.artist} (${match.platform})`)
          // 创建新的 track 并替换当前播放
          const newTrack = await searchResultToTrackAsync(match)
          // 更新当前 track 的 URL 和平台信息
          const onlineTrack = track as OnlineTrack
          onlineTrack._platform = match.platform as MusicSource
          onlineTrack._songId = match.id
          onlineTrack.url = newTrack.url
          onlineTrack.cover = newTrack.cover || track.cover
          // 重新播放
          this.play(newTrack.url, track)
          return
        }
      } catch (e) {
        console.warn('AudioPlayer: 重新搜索匹配失败:', e)
      }
    }

    // 重试次数用完或搜索失败，重置重试计数并增加错误计数
    this.retryCount = 0
    this.errorCount++

    if (this.errorCount >= this.maxErrors) {
      console.error('连续播放失败次数过多，停止播放')
      this.errorCount = 0
      store.isPlaying = false
      return
    }

    console.log(`AudioPlayer: 重试失败，切换下一首 (${this.errorCount}/${this.maxErrors})`)
    // 延迟切换下一首
    setTimeout(() => {
      store.nextTrack()
    }, 1000)
  }

  /**
   * 预加载下一首歌曲信息到原生层
   * 用于息屏时原生层自动切歌
   */
  private async preloadNextTrackForNative(store: ReturnType<typeof usePlayerStore>) {
    if (!this.useExoPlayer) return

    const { playlist, currentIndex, playMode } = store
    if (playlist.length === 0) return

    // 计算下一首索引
    let nextIndex: number
    if (playMode === 'shuffle') {
      nextIndex = Math.floor(Math.random() * playlist.length)
    } else if (playMode === 'single') {
      // 单曲循环，下一首还是当前曲
      nextIndex = currentIndex
    } else {
      // sequence 或 loop
      nextIndex = (currentIndex + 1) % playlist.length
    }

    const nextTrack = playlist[nextIndex] as OnlineTrack
    if (!nextTrack) return

    try {
      // 获取下一首的实际 URL
      let nextUrl: string | null = null
      if (nextTrack._platform && nextTrack._songId) {
        const { getActualMusicUrl } = await import('@/services/source/OnlineApiSource')
        nextUrl = await getActualMusicUrl(nextTrack._platform, nextTrack._songId)
      } else {
        nextUrl = nextTrack.url
      }

      if (nextUrl) {
        await nativeAudioPlayer.setNextTrack({
          url: nextUrl,
          id: nextTrack.id,
          title: nextTrack.title,
          artist: nextTrack.artist,
          cover: nextTrack.cover
        })
        console.log('AudioPlayer: 已预加载下一首到原生层:', nextTrack.title)
      }
    } catch (e) {
      console.warn('预加载下一首失败:', e)
    }
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
        // ExoPlayer 不能使用 blob 缓存，需要直接使用 HTTP URL
        if (this.useExoPlayer) {
          // Android ExoPlayer: 使用前端记录的 ID-URL 映射复用已缓存的 URL
          if (onlineTrack._platform && onlineTrack._songId) {
            // 先检查前端是否记录了该歌曲的缓存 URL
            const cachedAudioUrl = store.getCachedAudioUrl(track.id)

            if (cachedAudioUrl) {
              // 有缓存记录：使用记录的 URL，ExoPlayer 会从缓存读取
              console.log('AudioPlayer: 使用缓存 URL，跳过 API 请求:', track.id)
              playUrl = cachedAudioUrl
              store.setCached(true)
              store.setBuffered(100)
            } else {
              // 无缓存：请求 API 获取新 URL
              console.log('AudioPlayer: 无缓存记录，请求 API:', track.id)
              store.setCached(false)
              store.setBuffered(0)
              const actualUrl = await getActualMusicUrl(onlineTrack._platform, onlineTrack._songId)
              if (actualUrl) {
                playUrl = actualUrl
                // 保存 URL 到前端缓存映射，下次播放时可复用
                store.saveCachedAudioUrl(track.id, actualUrl)
              } else {
                console.error('无法获取音频URL')
                this.handlePlayError(store)
                return
              }
            }
          }
        } else {
          // Web 端: 优先使用 blob 缓存
          const cachedUrl = await audioCache.get(track.id)
          if (cachedUrl) {
            playUrl = cachedUrl
            store.setCached(true)
            store.setBuffered(100)
          } else if (offlineStore.isOfflineMode) {
            this.handlePlayError(store)
            return
          } else if (onlineTrack._platform && onlineTrack._songId) {
            store.setCached(false)
            store.setBuffered(0)
            const actualUrl = await getActualMusicUrl(onlineTrack._platform, onlineTrack._songId)
            if (actualUrl) {
              playUrl = actualUrl
              this.cacheInBackground(track.id, playUrl, track)
            } else {
              console.error('无法获取音频URL')
              this.handlePlayError(store)
              return
            }
          }
        }
      } catch (e) {
        console.warn('获取音频URL失败:', e)
        this.handlePlayError(store)
        return
      }
    } else {
      store.setCached(true)
      store.setBuffered(100)
    }

    // 成功开始播放，重置错误计数
    this.errorCount = 0

    // Android 使用 ExoPlayer
    if (this.useExoPlayer) {
      try {
        console.log('AudioPlayer: ExoPlayer play URL:', playUrl.substring(0, 80))

        // 先预加载下一首歌曲信息，这样播放时通知栏就能显示下一首按钮
        await this.preloadNextTrackForNative(store)

        // 直接播放单曲，由前端管理切歌逻辑
        await nativeAudioPlayer.play(playUrl, track)

        // 同步播放模式（用于单曲循环）
        await nativeAudioPlayer.setPlayMode(store.playMode)

        store.isPlaying = true
        console.log('AudioPlayer: ExoPlayer 播放开始')
      } catch (e) {
        console.error('AudioPlayer: ExoPlayer 播放失败', e)
        this.handlePlayError(store)
      }
      return
    }

    // Web 端使用 Howler
    this.playWithHowler(playUrl, track, store)
  }
  // 注意：Android 现在使用 ExoPlayer（原生播放器），不再使用 HTML5 Audio
  // playWithNativeAudio 方法已移除

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
        if (store.backgroundPlayEnabled && !this.useExoPlayer) {
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

        // 连接均衡器（Web 端）
        try {
          // 获取 Howler 内部的 Audio 元素
          const howlAny = this.howl as any
          if (howlAny._sounds && howlAny._sounds[0] && howlAny._sounds[0]._node) {
            const audioNode = howlAny._sounds[0]._node as HTMLAudioElement
            equalizerService.disconnect()
            equalizerService.connectAudioElement(audioNode)
            console.log('AudioPlayer: 已连接均衡器')
          }
        } catch (e) {
          console.warn('连接均衡器失败:', e)
        }
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
    // Android 使用 ExoPlayer
    if (this.useExoPlayer) {
      const store = usePlayerStore()

      // 如果没有当前歌曲，直接返回 false
      if (!store.currentTrack) {
        return false
      }

      // 异步检查 ExoPlayer 状态并处理
      nativeAudioPlayer.toggle().then((toggled) => {
        console.log('AudioPlayer: toggle result =', toggled)
        if (!toggled) {
          // ExoPlayer 没有媒体加载（应用重启后），需要重新播放当前歌曲
          console.log('AudioPlayer: ExoPlayer 无媒体，重新加载当前歌曲')
          this.play(store.currentTrack!.url, store.currentTrack!)
        } else {
          // toggle 成功，更新 store 状态
          nativeAudioPlayer.getState().then(state => {
            store.isPlaying = state.isPlaying
          })
        }
      })

      // 返回 true 表示处理中，但不要让上层立即更新 isPlaying
      // 由异步回调来更新正确的状态
      return true
    }
    // Web 端使用 Howler
    if (this.howl) {
      if (this.howl.playing()) {
        this.howl.pause()
      } else {
        this.howl.play()
      }
      return true
    }
    return false
  }

  seek(time: number) {
    const store = usePlayerStore()
    // 立即更新 store 中的时间
    store.setCurrentTime(time)

    // Android 使用 ExoPlayer
    if (this.useExoPlayer) {
      nativeAudioPlayer.seek(time)
      return
    }
    // Web 端使用 Howler
    if (this.howl && this.howl.state() === 'loaded') {
      this.howl.seek(time)
      if (store.isPlaying) {
        this.startHowlerProgress()
      }
    }
  }

  setVolume(v: number) {
    // Android 使用 ExoPlayer
    if (this.useExoPlayer) {
      nativeAudioPlayer.setVolume(v)
      return
    }
    // Web 端使用 Howler
    this.howl?.volume(v)
  }

  // startNativeProgress 方法已移除 - Android 现在使用 ExoPlayer 的 onProgress 事件

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

    // ExoPlayer 不需要在这里销毁，由服务管理
    // 只清理 Web 端资源
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
    if (this.useExoPlayer) {
      nativeAudioPlayer.stop()
    } else {
      this.destroy()
      backgroundMode.disable()
    }
  }

  /**
   * 设置后台播放状态
   */
  setBackgroundPlay(enabled: boolean, track?: Track) {
    const store = usePlayerStore()
    store.backgroundPlayEnabled = enabled

    // Android ExoPlayer 不需要处理这个，它默认就支持后台
    if (this.useExoPlayer) return

    const isPlaying = this.howl?.playing()

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
    if (this.useExoPlayer) return
    backgroundMode.updateNotification({ title, artist, cover, duration })
  }
}


export const audioPlayer = new AudioPlayer()
