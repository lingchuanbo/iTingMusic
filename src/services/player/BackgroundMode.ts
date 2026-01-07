import { Capacitor, registerPlugin } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'

/**
 * 后台播放插件接口
 */
interface BackgroundModePlugin {
  enable(options: {
    title: string
    artist: string
    cover?: string
    isPlaying?: boolean
    duration?: number
  }): Promise<{ success: boolean }>
  disable(): Promise<{ success: boolean }>
  updateNotification(options: {
    title: string
    artist: string
    cover?: string
    duration?: number
  }): Promise<{ success: boolean }>
  updatePlayState(options: { isPlaying: boolean }): Promise<{ success: boolean }>
  isRunning(): Promise<{ running: boolean }>
  addListener(
    eventName: 'controlAction',
    listenerFunc: (data: { action: string }) => void
  ): Promise<PluginListenerHandle>
}

// 注册原生插件
const NativeBackgroundMode = registerPlugin<BackgroundModePlugin>('BackgroundMode')

// 控制动作回调类型
type ControlActionCallback = (action: 'playPause' | 'next' | 'prev' | 'toggleLyrics') => void

/**
 * 后台/息屏播放服务
 * Android 使用前台服务保持播放，支持通知栏媒体控制
 */
class BackgroundModeService {
  private isEnabled = false
  private currentTitle = '正在播放'
  private currentArtist = '未知艺术家'
  private currentCover = ''
  private controlCallback: ControlActionCallback | null = null
  private listenerHandle: PluginListenerHandle | null = null

  /**
   * 检查是否在原生平台
   */
  isNative(): boolean {
    return Capacitor.isNativePlatform()
  }

  /**
   * 设置控制动作回调
   */
  setControlCallback(callback: ControlActionCallback): void {
    this.controlCallback = callback
    this.setupListener()
  }

  /**
   * 设置监听器
   */
  private async setupListener(): Promise<void> {
    if (!this.isNative() || this.listenerHandle) return

    try {
      this.listenerHandle = await NativeBackgroundMode.addListener(
        'controlAction',
        (data: { action: string }) => {
          if (this.controlCallback) {
            this.controlCallback(data.action as 'playPause' | 'next' | 'prev' | 'toggleLyrics')
          }
        }
      )
    } catch (e) {
      console.error('设置控制监听器失败:', e)
    }
  }

  /**
   * 启用后台播放模式
   */
  async enable(options: {
    title?: string
    artist?: string
    cover?: string
    isPlaying?: boolean
    duration?: number
  } = {}): Promise<void> {
    if (options.title) this.currentTitle = options.title
    if (options.artist) this.currentArtist = options.artist
    if (options.cover) this.currentCover = options.cover

    if (this.isNative()) {
      try {
        await NativeBackgroundMode.enable({
          title: this.currentTitle,
          artist: this.currentArtist,
          cover: this.currentCover,
          isPlaying: options.isPlaying ?? true,
          duration: options.duration ?? 0
        })
      } catch (e) {
        console.error('启动后台播放服务失败:', e)
      }
    }
    this.isEnabled = true
  }

  /**
   * 禁用后台播放模式
   */
  async disable(): Promise<void> {
    if (this.isNative()) {
      try {
        await NativeBackgroundMode.disable()
      } catch (e) {
        console.error('停止后台播放服务失败:', e)
      }
    }
    this.isEnabled = false
  }

  /**
   * 更新通知栏信息
   */
  async updateNotification(options: {
    title: string
    artist: string
    cover?: string
    duration?: number
  }): Promise<void> {
    this.currentTitle = options.title
    this.currentArtist = options.artist
    if (options.cover) this.currentCover = options.cover

    if (this.isNative() && this.isEnabled) {
      try {
        await NativeBackgroundMode.updateNotification({
          title: options.title,
          artist: options.artist,
          cover: options.cover || this.currentCover,
          duration: options.duration
        })
      } catch (e) {
        console.warn('更新通知失败:', e)
      }
    }
  }

  /**
   * 更新播放状态
   */
  async updatePlayState(isPlaying: boolean): Promise<void> {
    if (this.isNative() && this.isEnabled) {
      try {
        await NativeBackgroundMode.updatePlayState({ isPlaying })
      } catch (e) {
        console.warn('更新播放状态失败:', e)
      }
    }
  }

  /**
   * 获取当前状态
   */
  getStatus(): boolean {
    return this.isEnabled
  }

  /**
   * 检查服务是否运行中
   */
  async checkRunning(): Promise<boolean> {
    if (this.isNative()) {
      try {
        const result = await NativeBackgroundMode.isRunning()
        return result.running
      } catch {
        return false
      }
    }
    return this.isEnabled
  }

  /**
   * 清理资源
   */
  async cleanup(): Promise<void> {
    if (this.listenerHandle) {
      await this.listenerHandle.remove()
      this.listenerHandle = null
    }
  }
}

export const backgroundMode = new BackgroundModeService()
