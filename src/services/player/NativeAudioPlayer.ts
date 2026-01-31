/**
 * 原生 ExoPlayer 封装
 * 在 Android 上使用原生 ExoPlayer 替代 HTML5 Audio
 */

import { registerPlugin } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { usePlayerStore } from '@/store/player'
import { logger } from '@/services/LoggerService'
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
    getCachedSongs(): Promise<{ keys: string[] }>

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
            const endedListener = await NativeExoPlayer.addListener('onEnded', async (data: any) => {
                console.warn('NativeAudioPlayer: [EVENT] 收到 onEnded 事件', JSON.stringify(data))
                const store = usePlayerStore()
                const currentTrack = store.playlist[store.currentIndex]

                // 检查是否由原生层已经处理了切歌
                if (data.nativeHandled && data.nextTrackId) {
                    logger.info(`[onEnded] 原生层已处理切歌，同步前端状态 -> ${data.nextTrackId}`)
                    console.log('NativeAudioPlayer: 原生层已处理切歌，同步前端状态')
                    // 查找下一首在播放列表中的索引
                    const nextIndex = store.playlist.findIndex(t => t.id === data.nextTrackId)
                    if (nextIndex >= 0) {
                        store.currentIndex = nextIndex
                        store.currentTime = 0
                        store.duration = 0
                        store.isPlaying = true
                        logger.info(`[onEnded] 前端状态已同步，当前索引: ${nextIndex}`)
                    }
                    return // 原生层已处理，不需要前端再切歌
                }

                // 计算播放进度，检测是否是真正的播放结束
                const progress = store.duration > 0 ? store.currentTime / store.duration : 0
                const isRealEnd = progress >= 0.90 || store.currentTime >= store.duration - 2

                logger.warn(`[onEnded] 播放结束事件触发 - 进度: ${(progress * 100).toFixed(1)}%, 当前时间: ${store.currentTime.toFixed(1)}s, 总时长: ${store.duration.toFixed(1)}s`)
                logger.info(`[onEnded] 当前: ${currentTrack?.title || 'N/A'}, 模式: ${store.playMode}, 索引: ${store.currentIndex}/${store.playlist.length}, 真正结束: ${isRealEnd}`)

                // 如果播放进度不足 90%，可能是息屏导致的假结束，尝试恢复播放
                if (!isRealEnd) {
                    logger.warn(`[onEnded] 疑似息屏导致的假结束，尝试恢复播放`)
                    console.warn('NativeAudioPlayer: 进度不足90%，尝试恢复播放')
                    try {
                        // 尝试恢复播放
                        await NativeExoPlayer.seek({ position: store.currentTime })
                        await NativeExoPlayer.resume()
                        logger.info(`[onEnded] 已尝试恢复播放`)
                        return // 不执行切歌逻辑
                    } catch (e) {
                        logger.error(`[onEnded] 恢复播放失败: ${e}`)
                        // 恢复失败，继续执行正常的切歌逻辑
                    }
                }

                if (store.playMode === 'single') {
                    console.log('NativeAudioPlayer: 单曲循环 -> 重新播放')
                    logger.info(`[onEnded] 单曲循环 -> 重新播放`)
                    store.playTrack(store.currentIndex)
                } else if (store.playMode === 'sequence' && store.currentIndex >= store.playlist.length - 1) {
                    console.log('NativeAudioPlayer: 顺序播放已到末尾')
                    logger.info(`[onEnded] 顺序播放已到末尾, 停止`)
                    store.isPlaying = false
                } else {
                    console.log('NativeAudioPlayer: 切换下一首')
                    logger.info(`[onEnded] 切换下一首`)
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
                // 只记录播放/暂停状态变化
                if (store.isPlaying !== data.isPlaying) {
                    logger.info(`[onStateChange] ${data.isPlaying ? '开始播放' : '暂停'}`)
                }
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
            const trackListener = await NativeExoPlayer.addListener('onTrackChange', async (data: any) => {
                console.log('NativeAudioPlayer: [EVENT] onTrackChange', data.mediaId, data.nativeAutoNext ? '(原生自动切歌)' : '')
                const store = usePlayerStore()
                const index = store.playlist.findIndex(t => t.id === data.mediaId)
                if (index >= 0 && index !== store.currentIndex) {
                    const newTrack = store.playlist[index]
                    logger.info(`[onTrackChange] 切换到: ${newTrack?.title || data.mediaId}${data.nativeAutoNext ? ' (原生自动切歌)' : ''}`)
                    store.currentIndex = index
                    store.currentTime = 0
                    store.duration = 0

                    // 如果是原生层自动切歌，确保播放状态为 true
                    if (data.nativeAutoNext) {
                        store.isPlaying = true
                        logger.info(`[onTrackChange] 原生自动切歌，设置 isPlaying = true`)

                        // 关键：自动切歌后立即预加载下一首到原生层队列
                        // 这样队列始终有下一首可播放，保证连续息屏播放
                        this.preloadNextTrackToQueue(store)
                    }
                }

                // 检查新歌曲是否已缓存 (使用前端缓存追踪)
                store.checkAndSetCached()
            })
            this.listeners.push(trackListener)
            console.log('NativeAudioPlayer: onTrackChange 注册成功')

            // 5. 错误监听 - 智能重试机制
            console.log('NativeAudioPlayer: 正在注册 onError...')
            const errorListener = await NativeExoPlayer.addListener('onError', async (data) => {
                console.error('NativeAudioPlayer: [EVENT] 播放错误', data.code, data.message)
                logger.error(`[onError] 播放错误: ${data.code} - ${data.message}`)
                const store = usePlayerStore()
                store.isPlaying = false

                // 智能重试：尝试刷新 URL 并重新播放
                const currentTrack = store.playlist[store.currentIndex] as any
                if (currentTrack && currentTrack._platform && currentTrack._songId) {
                    logger.info(`[onError] 尝试刷新 URL 并重试: ${currentTrack.title}`)
                    try {
                        const { getActualMusicUrl } = await import('@/services/source/OnlineApiSource')
                        const newUrl = await getActualMusicUrl(currentTrack._platform, currentTrack._songId)

                        if (newUrl) {
                            logger.info(`[onError] 获取到新 URL，重试播放`)
                            await NativeExoPlayer.play({
                                url: newUrl,
                                id: currentTrack.id,
                                title: currentTrack.title,
                                artist: currentTrack.artist,
                                cover: currentTrack.cover
                            })
                            store.isPlaying = true
                            logger.info(`[onError] 重试成功`)
                            return // 重试成功，不跳下一首
                        }
                    } catch (retryError) {
                        logger.error(`[onError] 重试失败: ${retryError}`)
                    }
                }

                // 重试失败或非在线歌曲，跳到下一首
                logger.info(`[onError] 跳到下一首`)
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
     * 获取所有已缓存歌曲的 URL 列表
     */
    async getCachedSongs(): Promise<string[]> {
        const result = await NativeExoPlayer.getCachedSongs()
        return result.keys || []
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
     * 预加载下一首歌曲到原生层队列
     * 在歌曲切换后调用，保持队列始终有下一首可播放
     */
    private async preloadNextTrackToQueue(store: ReturnType<typeof usePlayerStore>) {
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

        const nextTrack = playlist[nextIndex] as any
        if (!nextTrack) return

        try {
            // 获取下一首的实际 URL - 先检查缓存
            let nextUrl: string | null = null
            const cachedUrl = store.getCachedAudioUrl(nextTrack.id)

            // 验证 ExoPlayer 原生缓存是否存在
            if (cachedUrl) {
                const nativeCached = await this.isCached(cachedUrl)
                if (nativeCached) {
                    console.log('NativeAudioPlayer: 预加载使用缓存 URL:', nextTrack.id)
                    nextUrl = cachedUrl
                }
            }

            // 无有效缓存时请求 API
            if (!nextUrl && nextTrack._platform && nextTrack._songId) {
                console.log('NativeAudioPlayer: 预加载请求 API:', nextTrack.id)
                const { getActualMusicUrl } = await import('@/services/source/OnlineApiSource')
                nextUrl = await getActualMusicUrl(nextTrack._platform, nextTrack._songId)
                if (nextUrl) {
                    store.saveCachedAudioUrl(nextTrack.id, nextUrl)
                }
            } else if (!nextUrl) {
                nextUrl = nextTrack.url
            }

            if (nextUrl) {
                await NativeExoPlayer.setNextTrack({
                    url: nextUrl,
                    id: nextTrack.id,
                    title: nextTrack.title,
                    artist: nextTrack.artist,
                    cover: nextTrack.cover
                })
                logger.info(`[preloadNextTrackToQueue] 已预加载下一首: ${nextTrack.title}`)
                console.log('NativeAudioPlayer: 已预加载下一首到队列:', nextTrack.title)
            }
        } catch (e) {
            console.warn('预加载下一首到队列失败:', e)
            logger.warn(`[preloadNextTrackToQueue] 预加载失败: ${e}`)
        }
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
