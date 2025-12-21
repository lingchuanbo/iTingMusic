/**
 * 后台/息屏播放服务
 * Web 环境下为空实现，原生 App 打包时再添加 Capacitor 依赖
 */

class BackgroundModeService {
  private isEnabled = false

  /**
   * 检查是否在原生平台
   */
  isNative(): boolean {
    // Web 环境始终返回 false
    return false
  }

  /**
   * 启用后台播放模式
   */
  async enable(): Promise<void> {
    // Web 环境下无需处理，浏览器本身支持后台音频播放
    this.isEnabled = true
  }

  /**
   * 禁用后台播放模式
   */
  async disable(): Promise<void> {
    this.isEnabled = false
  }

  /**
   * 获取当前状态
   */
  getStatus(): boolean {
    return this.isEnabled
  }
}

export const backgroundMode = new BackgroundModeService()
