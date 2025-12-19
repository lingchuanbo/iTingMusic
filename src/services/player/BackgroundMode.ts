/**
 * 后台/息屏播放服务
 * 使用 Capacitor Background Task 保持音频在后台播放
 */

import { Capacitor } from '@capacitor/core'
import { BackgroundTask } from '@capawesome/capacitor-background-task'

class BackgroundModeService {
  private taskId: string | null = null
  private isEnabled = false

  /**
   * 检查是否在原生平台
   */
  isNative(): boolean {
    return Capacitor.isNativePlatform()
  }

  /**
   * 启用后台播放模式
   */
  async enable(): Promise<void> {
    if (!this.isNative() || this.isEnabled) return

    try {
      // 开始后台任务
      const taskId = await BackgroundTask.beforeExit(async () => {
        // 这个回调会在应用进入后台时执行
        console.log('进入后台模式，保持音频播放')
      })
      
      this.taskId = taskId
      this.isEnabled = true
      console.log('后台播放模式已启用')
    } catch (e) {
      console.warn('启用后台播放失败:', e)
    }
  }

  /**
   * 禁用后台播放模式
   */
  async disable(): Promise<void> {
    if (!this.isNative() || !this.isEnabled || !this.taskId) return

    try {
      await BackgroundTask.finish({ taskId: this.taskId })
      this.taskId = null
      this.isEnabled = false
      console.log('后台播放模式已禁用')
    } catch (e) {
      console.warn('禁用后台播放失败:', e)
    }
  }

  /**
   * 获取当前状态
   */
  getStatus(): boolean {
    return this.isEnabled
  }
}

export const backgroundMode = new BackgroundModeService()
