/**
 * 原生 ExoPlayer 封装
 * 在 Android 上使用原生 ExoPlayer 替代 HTML5 Audio
 */

import { registerPlugin } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { usePlayerStore } from '@/store/player'
import type { Track, PlayMode } from '@/types'

// 插件接口定义
interface ExoPlayerPlugin {
    play(options: {
        url: string
        id?: string
        title?: string
        artist?: string
        cover?: string
    }): Promise<{ success: boolean }>

    pause(): Promise<{ success: boolean }>
    resume(): Promise<{ success: boolean }>
    stop(): Promise<{ success: boolean }>
    seek(options: { position: number }): Promise<{ success: boolean }>
    setVolume(options: { volume: number }): Promise<{ success: boolean }>

    getState(): Promise<{
        isPlaying: boolean
        playbackState: number
        currentPosition: number
        duration: number
        volume: number
        mediaId: string
    }>

    setPlaylist(options: {
        tracks: Array<{
            url: string
            id?: string
            title?: string
            artist?: string
            cover?: string
        }>
        startIndex?: number
    }): Promise<{ success: boolean }>

    next(): Promise<{ success: boolean }>
    prev(): Promise<{ success: boolean }>
    setPlayMode(options: { mode: string }): Promise<{ success: boolean }>

    // 背景播放支持 - 设置下一首歌曲信息，用于息屏时原生自动切歌
    setNextTrack(options: {
        url: string
        id: string
        title?: string
        artist?: string
        cover?: string
    }): Promise<{ success: boolean }>

    // 均衡器
    getAudioSessionId(): Promise<{ sessionId: number }>
    setEqualizerEnabled(options: { enabled: boolean }): Promise<{ success: boolean }>
    setEqualizerBand(options: { band: number; level: number }): Promise<{ success: boolean }>
    getEqualizerBands(): Promise<{ bands: number[]; minLevel: number; maxLevel: number }>
    setBassBoost(options: { strength: number }): Promise<{ success: boolean }>
    setVirtualizer(options: { strength: number }): Promise<{ success: boolean }>
    checkListeners(): Promise<{ listeners: string[] }>

    // 缓存管理
    getCacheStats(): Promise<{ sizeBytes: number; sizeMB: number; count: number }>
    isCached(options: { mediaId: string }): Promise<{ cached: boolean }>
    clearCache(): Promise<{ success: boolean }>

    // 事件监听
    addListener(
        eventName: 'onStateChange',
        listenerFunc: (data: {
            isPlaying: boolean
            playbackState: number
            currentPosition: number
            duration: number
            mediaId: string
        }) => void
    ): Promise<PluginListenerHandle>

    addListener(
        eventName: 'onProgress',
        listenerFunc: (data: {
            currentPosition: number
            duration: number
            bufferedPosition: number
        }) => void
    ): Promise<PluginListenerHandle>

    addListener(
        eventName: 'onTrackChange',
        listenerFunc: (data: { mediaId: string; reason: number }) => void
    ): Promise<PluginListenerHandle>

    addListener(
        eventName: 'onError',
        listenerFunc: (data: { code: number; message: string }) => void
    ): Promise<PluginListenerHandle>

    addListener(
        eventName: 'onEnded',
        listenerFunc: (data: { event: string }) => void
    ): Promise<PluginListenerHandle>
}

// 注册插件
const NativeExoPlayer = registerPlugin<ExoPlayerPlugin>('ExoPlayer')

/**
 * 原生音频播放器类
 */
class NativeAudioPlayer {
    private listeners: PluginListenerHandle[] = []
    private isSetup = false

    constructor() {
        this.setupListeners()
    }

    private async setupListeners() {
        if (this.isSetup) {
            console.log('NativeAudioPlayer: 监听器已设置，跳过')
            return
        }

        console.log('NativeAudioPlayer: 开始设置原生监听器...')
        this.isSetup = true

        try {
            // 1. 播放结束监听 (最优先，核心逻辑)
            console.log('NativeAudioPlayer: 正在注册 onEnded...')
            const endedListener = await NativeExoPlayer.addListener('onEnded', (data) => {
                console.warn('NativeAudioPlayer: [EVENT] 收到 onEnded 事件', JSON.stringify(data))
                const store = usePlayerStore()
                console.log('NativeAudioPlayer: 处理播放结束. 模式:', store.playMode, '索引:', store.currentIndex)

                if (store.playMode === 'single') {
                    console.log('NativeAudioPlayer: 单曲循环 -> 重新播放')
                    store.playTrack(store.currentIndex)
                } else if (store.playMode === 'sequence' && store.currentIndex >= store.playlist.length - 1) {
                    console.log('NativeAudioPlayer: 顺序播放已到末尾')
                    store.isPlaying = false
                } else {
                    console.log('NativeAudioPlayer: 切换下一首')
                    store.nextTrack()
                }
            })
            this.listeners.push(endedListener)
            console.log('NativeAudioPlayer: onEnded 注册成功')

            // 2. 状态变化监听
            console.log('NativeAudioPlayer: 正在注册 onStateChange...')
            const stateListener = await NativeExoPlayer.addListener('onStateChange', (data) => {
                // console.log('NativeAudioPlayer: [EVENT] onStateChange', data.isPlaying)
                const store = usePlayerStore()
                store.isPlaying = data.isPlaying
                if (data.duration > 0) {
                    store.setDuration(data.duration / 1000)
                }
            })
            this.listeners.push(stateListener)
            console.log('NativeAudioPlayer: onStateChange 注册成功')

            // 3. 进度监听
            console.log('NativeAudioPlayer: 正在注册 onProgress...')
            const progressListener = await NativeExoPlayer.addListener('onProgress', (data) => {
                const store = usePlayerStore()
                store.setCurrentTime(data.currentPosition / 1000)
                if (data.duration > 0) {
                    store.setDuration(data.duration / 1000)
                    const buffered = (data.bufferedPosition / data.duration) * 100
                    store.setBuffered(buffered)

                    // 当缓冲完成时，标记为已缓存并保存到 localStorage
                    if (data.bufferedPosition >= data.duration && !store.isCached) {
                        store.markCurrentAsCached()
                    }
                }
            })
            this.listeners.push(progressListener)
            console.log('NativeAudioPlayer: onProgress 注册成功')

            // 4. 歌曲切换监听
            console.log('NativeAudioPlayer: 正在注册 onTrackChange...')
            const trackListener = await NativeExoPlayer.addListener('onTrackChange', async (data) => {
                console.log('NativeAudioPlayer: [EVENT] onTrackChange', data.mediaId)
                const store = usePlayerStore()
                const index = store.playlist.findIndex(t => t.id === data.mediaId)
                if (index >= 0 && index !== store.currentIndex) {
                    store.currentIndex = index
                }

                // 检查新歌曲是否已缓存 (使用前端缓存追踪)
                store.checkAndSetCached()
            })
            this.listeners.push(trackListener)
            console.log('NativeAudioPlayer: onTrackChange 注册成功')

            // 5. 错误监听
            console.log('NativeAudioPlayer: 正在注册 onError...')
            const errorListener = await NativeExoPlayer.addListener('onError', (data) => {
                console.error('NativeAudioPlayer: [EVENT] 播放错误', data.code, data.message)
                const store = usePlayerStore()
                store.isPlaying = false
                setTimeout(() => store.nextTrack(), 1000)
            })
            this.listeners.push(errorListener)
            console.log('NativeAudioPlayer: onError 注册成功')

            console.log('NativeAudioPlayer: === 所有原生监听器注册完成 ===')

            // 调试：验证 Native 侧是否收到了监听器注册
            setTimeout(async () => {
                try {
                    const result = await NativeExoPlayer.checkListeners()
                    console.warn('NativeAudioPlayer: Native 侧确认已注册监听器:', JSON.stringify(result.listeners))
                } catch (e) {
                    console.error('NativeAudioPlayer: checkListeners 失败', e)
                }
            }, 500)
        } catch (e) {
            console.error('NativeAudioPlayer: 监听器注册过程中发生异常:', e)
            this.isSetup = false // 允许重试
        }
    }

    /**
     * 手动初始化监听器 (暴露给外部以确保在 Capacitor 准备就绪后调用)
     */
    async init() {
        await this.setupListeners()
    }

    /**
     * 播放单曲
     */
    async play(url: string, track?: Track): Promise<void> {
        console.log('NativeAudioPlayer: play', url.substring(0, 50))

        try {
            await NativeExoPlayer.play({
                url,
                id: track?.id || url,
                title: track?.title || 'Unknown',
                artist: track?.artist || 'Unknown',
                cover: track?.cover
            })
            // 缓存状态由 store.checkAndSetCached() 在播放入口处检查
        } catch (e) {
            console.error('NativeAudioPlayer: play 失败', e)
            throw e
        }
    }

    /**
     * 设置播放列表并开始播放
     */
    async setPlaylistAndPlay(tracks: Track[], startIndex: number): Promise<void> {
        console.log('NativeAudioPlayer: setPlaylistAndPlay', tracks.length, startIndex)

        try {
            const trackItems = tracks.map(t => ({
                url: t.url,
                id: t.id,
                title: t.title,
                artist: t.artist,
                cover: t.cover
            }))

            await NativeExoPlayer.setPlaylist({
                tracks: trackItems,
                startIndex
            })
            // 缓存状态由 store.checkAndSetCached() 在播放入口处检查
        } catch (e) {
            console.error('NativeAudioPlayer: setPlaylistAndPlay 失败', e)
            throw e
        }
    }

    /**
     * 暂停/恢复切换
     * @returns true if toggled successfully, false if no media is loaded (needs to call play())
     */
    async toggle(): Promise<boolean> {
        try {
            const state = await NativeExoPlayer.getState()

            // 调试日志 - 查看实际状态值
            console.log('NativeAudioPlayer: toggle state =', JSON.stringify(state))

            // STATE_IDLE = 1, 表示没有媒体加载
            // 如果没有 mediaId 或者处于 IDLE 状态，说明需要重新加载歌曲
            const noMedia = !state.mediaId || state.mediaId === '' || state.playbackState === 1
            console.log('NativeAudioPlayer: noMedia check =', noMedia, 'mediaId:', state.mediaId, 'playbackState:', state.playbackState)

            if (noMedia) {
                console.log('NativeAudioPlayer: toggle - 没有媒体加载，需要重新播放')
                return false
            }

            if (state.isPlaying) {
                await NativeExoPlayer.pause()
            } else {
                await NativeExoPlayer.resume()
            }
            return true
        } catch (e) {
            console.error('NativeAudioPlayer: toggle 失败', e)
            return false
        }
    }

    /**
     * 暂停
     */
    async pause(): Promise<void> {
        await NativeExoPlayer.pause()
    }

    /**
     * 恢复播放
     */
    async resume(): Promise<void> {
        await NativeExoPlayer.resume()
    }

    /**
     * 跳转到指定位置（秒）
     */
    async seek(time: number): Promise<void> {
        await NativeExoPlayer.seek({ position: time })
    }

    /**
     * 设置音量 (0-1)
     */
    async setVolume(volume: number): Promise<void> {
        await NativeExoPlayer.setVolume({ volume })
    }

    /**
     * 下一首
     */
    async next(): Promise<void> {
        await NativeExoPlayer.next()
    }

    /**
     * 上一首
     */
    async prev(): Promise<void> {
        await NativeExoPlayer.prev()
    }

    /**
     * 设置播放模式
     */
    async setPlayMode(mode: PlayMode): Promise<void> {
        await NativeExoPlayer.setPlayMode({ mode })
    }

    /**
     * 停止播放
     */
    async stop(): Promise<void> {
        await NativeExoPlayer.stop()
    }

    /**
     * 获取当前状态
     */
    async getState() {
        return await NativeExoPlayer.getState()
    }

    // ========== 均衡器相关 ==========

    /**
     * 获取音频会话 ID
     */
    async getAudioSessionId(): Promise<number> {
        const result = await NativeExoPlayer.getAudioSessionId()
        return result.sessionId
    }

    /**
     * 启用/禁用均衡器
     */
    async setEqualizerEnabled(enabled: boolean): Promise<void> {
        await NativeExoPlayer.setEqualizerEnabled({ enabled })
    }

    /**
     * 设置均衡器频段
     */
    async setEqualizerBand(band: number, level: number): Promise<void> {
        await NativeExoPlayer.setEqualizerBand({ band, level })
    }

    /**
     * 获取均衡器频段信息
     */
    async getEqualizerBands(): Promise<{ bands: number[]; minLevel: number; maxLevel: number }> {
        return await NativeExoPlayer.getEqualizerBands()
    }

    /**
     * 设置低音增强 (0-100)
     */
    async setBassBoost(strength: number): Promise<void> {
        await NativeExoPlayer.setBassBoost({ strength })
    }

    /**
     * 设置环绕声 (0-100)
     */
    async setVirtualizer(strength: number): Promise<void> {
        await NativeExoPlayer.setVirtualizer({ strength })
    }

    // ========== 缓存管理 ==========

    /**
     * 获取缓存统计信息
     */
    async getCacheStats(): Promise<{ sizeBytes: number; sizeMB: number; count: number }> {
        return await NativeExoPlayer.getCacheStats()
    }

    /**
     * 检查某首歌是否已缓存（传入 URL 作为缓存 key）
     */
    async isCached(cacheKey: string): Promise<boolean> {
        const result = await NativeExoPlayer.isCached({ mediaId: cacheKey })
        return result.cached
    }

    /**
     * 清除所有音频缓存
     */
    async clearCache(): Promise<void> {
        await NativeExoPlayer.clearCache()
    }

    /**
     * 设置下一首歌曲信息（用于息屏时原生自动切歌）
     */
    async setNextTrack(options: {
        url: string
        id: string
        title?: string
        artist?: string
        cover?: string
    }): Promise<void> {
        await NativeExoPlayer.setNextTrack(options)
    }

    /**
     * 清理资源
     */
    destroy() {
        this.listeners.forEach(l => l.remove())
        this.listeners = []
    }
}

export const nativeAudioPlayer = new NativeAudioPlayer()
