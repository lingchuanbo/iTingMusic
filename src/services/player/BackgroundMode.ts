import { Capacitor, registerPlugin } from '@capacitor/core'

/**
 * 后台播放插件接口
 */
interface BackgroundModePlugin {
  enable(options: { title: string; artist: string }): Promise<{ success: boolean }>
  disable(): Promise<{ success: boolean }>
  updateNotification(options: { title: string; artist: string }): Promise<{ success: boolean }>
  isRunning(): Promise<{ running: boolean }>
}

// 注册原生插件
const NativeBackgroundMode = registerPlugin<BackgroundModePlugin>('BackgroundMode')

/**
 * 后台/息屏播放服务
 * Android 使用前台服务保持播放
 */
class BackgroundModeService {
  private isEnabled = false
  private currentTitle = '正在播放'
  private currentArtist = '未知艺术家'

  /**
   * 检查是否在原生平台
   */
  isNative(): boolean {
    return Capacitor.isNativePlatform()
  }

  /**
   * 启用后台播放模式
   */
  async enable(title?: string, artist?: string): Promise<void> {
    if (title) this.currentTitle = title
    if (artist) this.currentArtist = artist

    if (this.isNative()) {
      try {
        await NativeBackgroundMode.enable({
          title: this.currentTitle,
          artist: this.currentArtist
        })
        console.log('后台播放服务已启动')
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
        console.log('后台播放服务已停止')
      } catch (e) {
        console.error('停止后台播放服务失败:', e)
      }
    }
    this.isEnabled = false
  }

  /**
   * 更新通知栏信息
   */
  async updateNotification(title: string, artist: string): Promise<void> {
    this.currentTitle = title
    this.currentArtist = artist

    if (this.isNative() && this.isEnabled) {
      try {
        await NativeBackgroundMode.updateNotification({ title, artist })
      } catch (e) {
        console.warn('更新通知失败:', e)
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
}

export const backgroundMode = new BackgroundModeService()
