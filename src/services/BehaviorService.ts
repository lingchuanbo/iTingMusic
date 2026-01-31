/**
 * 用户行为收集服务
 * 记录用户的每一次关键交互，用于推荐算法
 */
import type { Track, UserBehavior, TrackStats, UserProfile, TimeOfDay } from '@/types'

const STORAGE_KEY = 'zen_user_behaviors'
const STATS_KEY = 'zen_track_stats'
const MAX_BEHAVIORS = 2000

class BehaviorService {
    private behaviors: UserBehavior[] = []
    private stats: Map<string, TrackStats> = new Map()
    private loaded = false

    private load() {
        if (this.loaded) return
        try {
            // 加载行为记录
            const behaviorData = localStorage.getItem(STORAGE_KEY)
            if (behaviorData) {
                this.behaviors = JSON.parse(behaviorData)
            }
            // 加载统计数据
            const statsData = localStorage.getItem(STATS_KEY)
            if (statsData) {
                const arr: TrackStats[] = JSON.parse(statsData)
                arr.forEach(s => this.stats.set(s.trackId, s))
            }
        } catch (e) {
            console.error('加载行为数据失败:', e)
        }
        this.loaded = true
    }

    private save() {
        try {
            // 限制记录数量
            if (this.behaviors.length > MAX_BEHAVIORS) {
                this.behaviors = this.behaviors.slice(-MAX_BEHAVIORS)
            }
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.behaviors))
            localStorage.setItem(STATS_KEY, JSON.stringify(Array.from(this.stats.values())))
        } catch (e) {
            console.error('保存行为数据失败:', e)
        }
    }

    /** 获取当前上下文 */
    private getContext(): { timeOfDay: TimeOfDay; dayOfWeek: number } {
        const now = new Date()
        const hour = now.getHours()
        const dayOfWeek = now.getDay()

        let timeOfDay: TimeOfDay
        if (hour >= 5 && hour < 12) {
            timeOfDay = 'morning'
        } else if (hour >= 12 && hour < 18) {
            timeOfDay = 'afternoon'
        } else if (hour >= 18 && hour < 22) {
            timeOfDay = 'evening'
        } else {
            timeOfDay = 'night'
        }

        return { timeOfDay, dayOfWeek }
    }

    /** 生成唯一ID */
    private generateId(): string {
        return `b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    }

    /** 记录播放开始 */
    recordPlayStart(track: Track): void {
        this.load()

        const behavior: UserBehavior = {
            id: this.generateId(),
            type: 'play_start',
            trackId: track.id,
            trackMeta: {
                title: track.title,
                artist: track.artist,
                platform: track._platform
            },
            context: this.getContext(),
            timestamp: Date.now()
        }

        this.behaviors.push(behavior)

        // 初始化/更新统计（即使没有完播也要有基础数据）
        const existing = this.stats.get(track.id)
        if (existing) {
            existing.playCount += 1
            existing.lastPlayedAt = Date.now()
        } else {
            const stats: TrackStats = {
                trackId: track.id,
                artist: track.artist,
                platform: track._platform,
                playCount: 1,
                completeCount: 0,
                skipCount: 0,
                totalDuration: 0,
                lastPlayedAt: Date.now(),
                avgCompletionRate: 0
            }
            this.stats.set(track.id, stats)
        }

        this.save()
    }

    /** 记录播放完成 */
    recordPlayComplete(track: Track, listenDuration: number, completionRate: number): void {
        this.load()

        // 记录行为
        const behavior: UserBehavior = {
            id: this.generateId(),
            type: 'play_complete',
            trackId: track.id,
            trackMeta: {
                title: track.title,
                artist: track.artist,
                platform: track._platform
            },
            context: this.getContext(),
            metrics: {
                listenDuration,
                completionRate
            },
            timestamp: Date.now()
        }
        this.behaviors.push(behavior)

        // 更新统计
        this.updateStats(track, listenDuration, completionRate, false)
        this.save()
    }

    /** 记录跳过 */
    recordSkip(track: Track, listenDuration: number): void {
        this.load()

        const completionRate = track.duration ? listenDuration / (track.duration * 1000) : 0

        const behavior: UserBehavior = {
            id: this.generateId(),
            type: 'skip',
            trackId: track.id,
            trackMeta: {
                title: track.title,
                artist: track.artist,
                platform: track._platform
            },
            context: this.getContext(),
            metrics: {
                listenDuration,
                completionRate
            },
            timestamp: Date.now()
        }
        this.behaviors.push(behavior)

        // 更新统计
        this.updateStats(track, listenDuration, completionRate, true)
        this.save()
    }

    /** 记录单曲循环 */
    recordLoop(track: Track): void {
        this.load()

        const behavior: UserBehavior = {
            id: this.generateId(),
            type: 'loop',
            trackId: track.id,
            trackMeta: {
                title: track.title,
                artist: track.artist,
                platform: track._platform
            },
            context: this.getContext(),
            timestamp: Date.now()
        }
        this.behaviors.push(behavior)
        this.save()
    }

    /** 记录收藏 */
    recordFavorite(track: Track, isFavorite: boolean): void {
        this.load()

        const behavior: UserBehavior = {
            id: this.generateId(),
            type: isFavorite ? 'favorite' : 'unfavorite',
            trackId: track.id,
            trackMeta: {
                title: track.title,
                artist: track.artist,
                platform: track._platform
            },
            context: this.getContext(),
            timestamp: Date.now()
        }
        this.behaviors.push(behavior)
        this.save()
    }

    /** 记录添加到歌单 */
    recordAddToPlaylist(track: Track, playlistId: string): void {
        this.load()

        const behavior: UserBehavior = {
            id: this.generateId(),
            type: 'add_playlist',
            trackId: track.id,
            playlistId,
            trackMeta: {
                title: track.title,
                artist: track.artist,
                platform: track._platform
            },
            context: this.getContext(),
            timestamp: Date.now()
        }
        this.behaviors.push(behavior)
        this.save()
    }

    /** 记录搜索 */
    recordSearch(keyword: string): void {
        this.load()

        const behavior: UserBehavior = {
            id: this.generateId(),
            type: 'search',
            keyword,
            context: this.getContext(),
            timestamp: Date.now()
        }
        this.behaviors.push(behavior)
        this.save()
    }

    /** 记录推荐反馈（喜欢/不喜欢） */
    recordFeedback(track: Track, isPositive: boolean): void {
        this.load()

        const behavior: UserBehavior = {
            id: this.generateId(),
            type: isPositive ? 'feedback_positive' : 'feedback_negative',
            trackId: track.id,
            trackMeta: {
                title: track.title,
                artist: track.artist,
                platform: track._platform
            },
            context: this.getContext(),
            timestamp: Date.now()
        }
        this.behaviors.push(behavior)

        // 更新统计权重
        const existing = this.stats.get(track.id)
        if (existing) {
            // 正面反馈增加完播率权重，负面反馈降低
            if (isPositive) {
                existing.avgCompletionRate = Math.min(1, existing.avgCompletionRate + 0.2)
            } else {
                existing.avgCompletionRate = Math.max(0, existing.avgCompletionRate - 0.3)
            }
        }

        this.save()
        console.log(`[反馈] ${isPositive ? '👍' : '👎'} ${track.title} - ${track.artist}`)
    }

    /** 获取指定歌曲的最新推荐反馈 */
    getLatestFeedback(trackId: string): 'positive' | 'negative' | null {
        this.load()
        // 从后往前找最新的反馈记录
        for (let i = this.behaviors.length - 1; i >= 0; i--) {
            const b = this.behaviors[i]
            if (b.trackId === trackId) {
                if (b.type === 'feedback_positive') return 'positive'
                if (b.type === 'feedback_negative') return 'negative'
            }
        }
        return null
    }

    /** 获取用户反馈的正面艺术家列表 */
    getPositiveFeedbackArtists(): string[] {
        this.load()
        const artists = new Set<string>()
        for (const b of this.behaviors) {
            if (b.type === 'feedback_positive' && b.trackMeta?.artist) {
                artists.add(b.trackMeta.artist)
            }
        }
        return Array.from(artists)
    }

    /** 获取用户反馈的负面艺术家列表 */
    getNegativeFeedbackArtists(): string[] {
        this.load()
        const artists = new Set<string>()
        for (const b of this.behaviors) {
            if (b.type === 'feedback_negative' && b.trackMeta?.artist) {
                artists.add(b.trackMeta.artist)
            }
        }
        return Array.from(artists)
    }

    /** 更新歌曲统计 */
    private updateStats(track: Track, duration: number, completionRate: number, isSkip: boolean): void {
        const existing = this.stats.get(track.id)

        if (existing) {
            existing.playCount += 1
            if (!isSkip && completionRate >= 0.9) {
                existing.completeCount += 1
            }
            if (isSkip) {
                existing.skipCount += 1
            }
            existing.totalDuration += duration
            existing.lastPlayedAt = Date.now()
            // 更新平均完播率
            existing.avgCompletionRate =
                (existing.avgCompletionRate * (existing.playCount - 1) + completionRate) / existing.playCount
        } else {
            const stats: TrackStats = {
                trackId: track.id,
                artist: track.artist,
                platform: track._platform,
                playCount: 1,
                completeCount: !isSkip && completionRate >= 0.9 ? 1 : 0,
                skipCount: isSkip ? 1 : 0,
                totalDuration: duration,
                lastPlayedAt: Date.now(),
                avgCompletionRate: completionRate
            }
            this.stats.set(track.id, stats)
        }
    }

    /** 获取所有行为记录 */
    getBehaviors(limit?: number): UserBehavior[] {
        this.load()
        if (limit) {
            return this.behaviors.slice(-limit)
        }
        return [...this.behaviors]
    }

    /** 获取歌曲统计 */
    getStats(): Map<string, TrackStats> {
        this.load()
        return new Map(this.stats)
    }

    /** 获取统计数组（按播放次数排序） */
    getStatsArray(): TrackStats[] {
        this.load()
        return Array.from(this.stats.values())
            .sort((a, b) => b.playCount - a.playCount)
    }

    /** 获取用户画像 */
    getUserProfile(): UserProfile {
        this.load()

        // 统计艺术家偏好
        const artistCounts = new Map<string, number>()
        const platformCounts = new Map<string, number>()
        const timeOfDayCounts: Record<TimeOfDay, number> = {
            morning: 0, afternoon: 0, evening: 0, night: 0
        }

        let totalCompletionRate = 0
        let completionCount = 0

        for (const behavior of this.behaviors) {
            if (behavior.trackMeta?.artist) {
                artistCounts.set(
                    behavior.trackMeta.artist,
                    (artistCounts.get(behavior.trackMeta.artist) || 0) + 1
                )
            }
            if (behavior.trackMeta?.platform) {
                platformCounts.set(
                    behavior.trackMeta.platform,
                    (platformCounts.get(behavior.trackMeta.platform) || 0) + 1
                )
            }
            timeOfDayCounts[behavior.context.timeOfDay] += 1

            if (behavior.metrics?.completionRate !== undefined) {
                totalCompletionRate += behavior.metrics.completionRate
                completionCount += 1
            }
        }

        // 排序获取Top
        const favoriteArtists = Array.from(artistCounts.entries())
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10)

        const favoritePlatforms = Array.from(platformCounts.entries())
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5)

        // 找最常听的时间段
        const preferredTimeOfDay = (Object.entries(timeOfDayCounts) as [TimeOfDay, number][])
            .sort((a, b) => b[1] - a[1])[0]?.[0] || 'evening'

        return {
            favoriteArtists,
            favoritePlatforms,
            preferredTimeOfDay,
            totalPlayCount: this.behaviors.filter(b => b.type === 'play_start').length,
            avgCompletionRate: completionCount > 0 ? totalCompletionRate / completionCount : 0
        }
    }

    /** 获取最近播放的艺术家 */
    getRecentArtists(limit = 5): string[] {
        this.load()
        const artists: string[] = []
        const seen = new Set<string>()

        // 从最近的行为开始
        for (let i = this.behaviors.length - 1; i >= 0 && artists.length < limit; i--) {
            const artist = this.behaviors[i].trackMeta?.artist
            if (artist && !seen.has(artist)) {
                seen.add(artist)
                artists.push(artist)
            }
        }

        return artists
    }

    /** 清除所有数据 */
    clear(): void {
        this.behaviors = []
        this.stats.clear()
        localStorage.removeItem(STORAGE_KEY)
        localStorage.removeItem(STATS_KEY)
    }
}

export const behaviorService = new BehaviorService()
