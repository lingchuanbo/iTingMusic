/**
 * 推荐服务
 * 实现 Item-CF 相似推荐 + 热门推荐 + AI 推荐理由
 * 支持相似度矩阵预热（基于艺术家/流派/年代）
 */
import type { Track, RecommendItem, UserProfile } from '@/types'
export interface AIExpertRecommendation {
    reason: string
    categories: {
        name: string
        songs: {
            title: string
            artist: string
            comment: string
        }[]
    }[]
}
import { behaviorService } from './BehaviorService'
import { trackStorage } from './TrackStorage'
import {
    searchSongs,
    searchResultToTrack,
    type MusicSource,
    getEnabledSources
} from './source/OnlineApiSource'
import { getActiveProviderId } from './source/ApiProviders'
import { loadAIConfig, analyzeTrackMetadata, getAIRecommendations } from './ai/AIService'

// 缓存配置
const CACHE_KEY = 'zen_recommend_cache'
const SIMILAR_CACHE_KEY = 'zen_similar_cache'
const SIMILARITY_MATRIX_KEY = 'zen_similarity_matrix'
const HOT_CACHE_TTL = 30 * 60 * 1000           // 热门推荐缓存 30 分钟
const SIMILAR_CACHE_TTL = 60 * 60 * 1000       // 相似推荐缓存 1 小时
const GDSTUDIO_RATE_LIMIT_TTL = 10 * 60 * 1000 // GD Studio 请求限制: 10分钟
const MATRIX_WARM_TTL = 2 * 60 * 60 * 1000     // 相似度矩阵 2 小时
const METADATA_CACHE_KEY = 'zen_ai_metadata_cache'
const EXPERT_CACHE_KEY = 'zen_ai_expert_cache'
const GDSTUDIO_LAST_REQUEST_KEY = 'zen_gdstudio_last_request'

interface CacheData<T> {
    data: T
    timestamp: number
    ttl: number
}

// ========== 相似度矩阵类型 ==========

/** 歌曲元数据（用于计算相似度） */
interface TrackMeta {
    id: string
    title: string
    artist: string
    album?: string
    platform?: string
    // 从标题推断的类型标签
    inferredGenre?: string
    // 从标题/歌手推断的年代
    inferredEra?: string
}

/** 相似度分数 */
interface SimilarityScore {
    trackId: string
    score: number
    factors: {
        sameArtist: boolean
        sameGenre: boolean
        sameEra: boolean
        coPlayScore: number  // 共同播放分数
    }
}

/** 相似度矩阵存储 */
interface SimilarityMatrixData {
    matrix: Record<string, SimilarityScore[]>  // trackId -> 相似歌曲列表
    trackMetas: Record<string, TrackMeta>       // trackId -> 歌曲元数据
    lastWarmup: number
}

class RecommendationService {
    // 相似度矩阵数据
    private similarityMatrix: SimilarityMatrixData | null = null

    /** 检查缓存是否有效 */
    private isValidCache<T>(cache: CacheData<T> | null): cache is CacheData<T> {
        if (!cache) return false
        return Date.now() - cache.timestamp < cache.ttl
    }

    /** 检查 GD Studio 是否在请求限制内 */
    isGDStudioRateLimited(): boolean {
        if (getActiveProviderId() !== 'gdstudio') return false
        try {
            const lastRequest = localStorage.getItem(GDSTUDIO_LAST_REQUEST_KEY)
            if (lastRequest) {
                const elapsed = Date.now() - parseInt(lastRequest, 10)
                return elapsed < GDSTUDIO_RATE_LIMIT_TTL
            }
        } catch { }
        return false
    }

    /** 获取 GD Studio 距离下次可刷新的剩余时间（毫秒） */
    getGDStudioRateLimitRemaining(): number {
        if (getActiveProviderId() !== 'gdstudio') return 0
        try {
            const lastRequest = localStorage.getItem(GDSTUDIO_LAST_REQUEST_KEY)
            if (lastRequest) {
                const elapsed = Date.now() - parseInt(lastRequest, 10)
                return Math.max(0, GDSTUDIO_RATE_LIMIT_TTL - elapsed)
            }
        } catch { }
        return 0
    }

    /** 记录 GD Studio 请求时间 */
    private markGDStudioRequest(): void {
        if (getActiveProviderId() === 'gdstudio') {
            localStorage.setItem(GDSTUDIO_LAST_REQUEST_KEY, Date.now().toString())
        }
    }

    /** 获取缓存 */
    private getCache<T>(key: string): CacheData<T> | null {
        try {
            const data = localStorage.getItem(key)
            if (data) {
                return JSON.parse(data)
            }
        } catch (e) {
            console.error('读取缓存失败:', e)
        }
        return null
    }

    /** 设置缓存 */
    private setCache<T>(key: string, data: T, ttl: number): void {
        try {
            const cache: CacheData<T> = {
                data,
                timestamp: Date.now(),
                ttl
            }
            localStorage.setItem(key, JSON.stringify(cache))
        } catch (e) {
            console.error('写入缓存失败:', e)
        }
    }

    // ========== 相似度矩阵方法 ==========

    /**
     * 从歌曲标题推断流派
     */
    private inferGenre(title: string, artist: string): string {
        const text = `${title} ${artist}`.toLowerCase().trim()

        // 流派关键词映射
        const genreKeywords: Record<string, string[]> = {
            '摇滚': ['rock', '摇滚', '乐队', 'band'],
            '流行': ['pop', '流行', '热门'],
            '电子': ['edm', 'dj', '电子', 'remix', 'dance'],
            '嘻哈': ['rap', 'hip-hop', '说唱', '嘻哈'],
            '民谣': ['folk', '民谣', '吉他', '木吉他'],
            '古典': ['classical', '古典', '钢琴', '小提琴', '交响'],
            '抒情': ['ballad', '情歌', '抒情', '慢歌', '温柔'],
            '轻音乐': ['light', '轻音乐', '纯音乐', 'instrumental', '钢琴曲', '背景音乐'],
            '古风/国风': ['古风', '国风', '中国风', '戏曲', '曲艺', '伶', '醉酒', '江湖', '琵琶', '古筝', '笛子', '赤伶'],
            'R&B': ['r&b', 'rnb', '节奏布鲁斯'],
            '动漫': ['anime', '动漫', '二次元', 'ost', '游戏']
        }

        for (const [genre, keywords] of Object.entries(genreKeywords)) {
            if (keywords.some(kw => text.includes(kw.toLowerCase()))) {
                return genre
            }
        }

        return '未知'
    }

    /**
     * 从歌曲信息推断年代
     */
    private inferEra(title: string, artist: string): string {
        const text = `${title} ${artist}`.toLowerCase().trim()

        // 一些经典艺人的年代标签
        const eraArtists: Record<string, string[]> = {
            '80年代': ['邓丽君', '谭咏麟', '张国荣', '梅艳芳', '罗大佑', '李宗盛', '费玉清'],
            '90年代': ['周华健', '王菲', '刘德华', '张学友', '黎明', '郭富城', '陈百强', '张信哲', '任贤齐', '张震岳', '林忆莲'],
            '00年代': ['周杰伦', '林俊杰', '蔡依林', '孙燕姿', '梁静茹', 'SHE', '陈奕迅', '潘玮柏', '张韶涵', '王心凌', '五月天', '孙楠', '韩红'],
            '10年代': ['薛之谦', '毛不易', '华晨宇', 'TFboys', '鹿晗', '李荣浩', '李玉刚', '许嵩', '汪苏泷', '徐良', '凤凰传奇', '邓紫棋', '张杰'],
            '20年代': ['刘雨昕', '时代少年团', 'THE9', '单依纯', '周深']
        }

        for (const [era, artists] of Object.entries(eraArtists)) {
            if (artists.some(a => text.includes(a.toLowerCase()))) {
                return era
            }
        }

        return '未知'
    }

    /**
     * 计算两个歌曲之间的相似度分数
     */
    private calculateSimilarityScore(track1: TrackMeta, track2: TrackMeta, coPlayScore: number): SimilarityScore {
        const sameArtist = track1.artist === track2.artist
        const sameGenre = track1.inferredGenre === track2.inferredGenre && track1.inferredGenre !== '未知'
        const sameEra = track1.inferredEra === track2.inferredEra && track1.inferredEra !== '未知'

        // 权重分配
        let score = 0
        if (sameArtist) score += 0.1    // 同艺术家
        if (sameGenre) score += 0.4    // 同流派
        if (sameEra) score += 0.35      // 同年代  
        score += coPlayScore * 0.15     // 共同播放分数

        return {
            trackId: track2.id,
            score,
            factors: {
                sameArtist,
                sameGenre,
                sameEra,
                coPlayScore
            }
        }
    }

    /**
     * 预热相似度矩阵
     * 基于用户播放历史构建歌曲相似度矩阵
     */
    async warmupSimilarityMatrix(): Promise<void> {
        // 检查是否需要刷新
        if (this.similarityMatrix &&
            Date.now() - this.similarityMatrix.lastWarmup < MATRIX_WARM_TTL) {
            console.log('相似度矩阵仍有效，跳过预热')
            return
        }

        // 尝试从缓存加载
        try {
            const cached = localStorage.getItem(SIMILARITY_MATRIX_KEY)
            if (cached) {
                const data: SimilarityMatrixData = JSON.parse(cached)
                if (Date.now() - data.lastWarmup < MATRIX_WARM_TTL) {
                    this.similarityMatrix = data
                    console.log('从缓存加载相似度矩阵')
                    return
                }
            }
        } catch (e) {
            console.warn('加载相似度矩阵缓存失败:', e)
        }

        console.log('开始预热相似度矩阵...')

        // 获取用户播放历史中的所有歌曲
        const allTracks = trackStorage.getAllTracks()

        if (allTracks.length < 2) {
            console.log('歌曲数量不足，跳过预热')
            return
        }

        // 构建歌曲元数据
        const trackMetas: Record<string, TrackMeta> = {}
        const cacheStr = localStorage.getItem(METADATA_CACHE_KEY)
        const metadataCache: Record<string, any> = cacheStr ? JSON.parse(cacheStr) : {}

        for (const track of allTracks) {
            const aiMeta = metadataCache[track.id]
            trackMetas[track.id] = {
                id: track.id,
                title: track.title,
                artist: track.artist,
                album: track.album,
                platform: track._platform,
                inferredGenre: aiMeta?.genre || this.inferGenre(track.title, track.artist),
                inferredEra: aiMeta?.era || this.inferEra(track.title, track.artist)
            }
        }

        // 计算共同播放分数（基于播放顺序的相邻性）
        const coPlayMap = new Map<string, Map<string, number>>()
        const behaviors = behaviorService.getBehaviors(500)
        const playSequence = behaviors
            .filter(b => b.type === 'play_start' && b.trackId)
            .map(b => b.trackId!)

        for (let i = 0; i < playSequence.length - 1; i++) {
            const current = playSequence[i]
            const next = playSequence[i + 1]
            if (current === next) continue

            if (!coPlayMap.has(current)) {
                coPlayMap.set(current, new Map())
            }
            const currentMap = coPlayMap.get(current)!
            currentMap.set(next, (currentMap.get(next) || 0) + 1)
        }

        // 归一化共同播放分数
        const maxCoPlay = Math.max(1, ...Array.from(coPlayMap.values())
            .flatMap(m => Array.from(m.values())))

        // 构建相似度矩阵
        const matrix: Record<string, SimilarityScore[]> = {}
        const trackIds = Object.keys(trackMetas)

        for (const id1 of trackIds) {
            const meta1 = trackMetas[id1]
            const similarities: SimilarityScore[] = []

            for (const id2 of trackIds) {
                if (id1 === id2) continue

                const meta2 = trackMetas[id2]
                const coPlayScore = (coPlayMap.get(id1)?.get(id2) || 0) / maxCoPlay

                const simScore = this.calculateSimilarityScore(meta1, meta2, coPlayScore)

                // 只保留有一定相似度的结果
                if (simScore.score > 0.1) {
                    similarities.push(simScore)
                }
            }

            // 按分数排序，只保留前20个最相似的
            similarities.sort((a, b) => b.score - a.score)
            matrix[id1] = similarities.slice(0, 20)
        }

        // 保存到实例和缓存
        this.similarityMatrix = {
            matrix,
            trackMetas,
            lastWarmup: Date.now()
        }

        try {
            localStorage.setItem(SIMILARITY_MATRIX_KEY, JSON.stringify(this.similarityMatrix))
            console.log(`相似度矩阵预热完成: ${trackIds.length} 首歌曲`)
        } catch (e) {
            console.warn('保存相似度矩阵失败:', e)
        }
    }

    /**
     * 从相似度矩阵获取相似歌曲
     */
    getSimilarFromMatrix(trackId: string, limit = 10): SimilarityScore[] {
        if (!this.similarityMatrix) {
            return []
        }
        return (this.similarityMatrix.matrix[trackId] || []).slice(0, limit)
    }
    /**
     * 获取热门推荐
     * 基于用户播放统计，推荐用户常听艺术家的歌曲（优化多样性）
     */
    async getHotRecommendations(limit = 20): Promise<RecommendItem[]> {
        console.group('[热门推荐] 开始生成')

        // 检查缓存
        const cache = this.getCache<RecommendItem[]>(CACHE_KEY)
        if (this.isValidCache(cache) && cache.data.length >= limit) {
            console.log('命中缓存，返回', cache.data.length, '首')
            console.groupEnd()
            return cache.data.slice(0, limit)
        }

        // GD Studio 请求频率限制：如果在限制内且有旧缓存，返回旧缓存
        if (this.isGDStudioRateLimited()) {
            const remaining = Math.ceil(this.getGDStudioRateLimitRemaining() / 60000)
            console.log(`[GD Studio] 请求频率限制中，${remaining} 分钟后可刷新`)
            const oldCache = this.getCache<RecommendItem[]>(CACHE_KEY)
            if (oldCache?.data?.length) {
                console.groupEnd()
                return oldCache.data.slice(0, limit)
            }
        }

        const profile = behaviorService.getUserProfile()
        const recommendations: RecommendItem[] = []
        const seenIds = new Set<string>()

        // 获取启用的音乐源
        const sources = getEnabledSources()
        const defaultSource: MusicSource = sources[0] || 'netease'

        // 每个艺术家最多选取的歌曲数（限制单艺术家数量以提升多样性）
        const MAX_SONGS_PER_ARTIST = 3

        // 基于用户偏好艺术家搜索推荐
        if (profile.favoriteArtists.length > 0) {
            // 取前8个常听艺术家以增加多样性
            const topArtists = profile.favoriteArtists.slice(0, 8)
            console.log('偏好艺术家:', topArtists.map(a => `${a.name}(${a.count})`).join(', '))

            for (const { name: artist } of topArtists) {
                try {
                    const results = await searchSongs(defaultSource, artist, 8)
                    let artistCount = 0

                    for (const result of results) {
                        if (artistCount >= MAX_SONGS_PER_ARTIST) break
                        if (seenIds.has(result.id)) continue
                        seenIds.add(result.id)

                        const track = searchResultToTrack(result)
                        // 统一分数范围，加大随机性以增加多样性
                        const score = 0.6 + Math.random() * 0.4

                        recommendations.push({
                            track,
                            score,
                            type: 'hot'
                        })
                        artistCount++
                    }
                    console.log(`  ${artist}: ${artistCount} 首`)
                } catch (e) {
                    console.error(`搜索艺术家 ${artist} 失败:`, e)
                }
            }
        }

        // 添加探索性推荐（不同流派/新歌等）
        const exploreKeywords = ['热门新歌', '流行金曲', '经典老歌', '网络红歌']
        const randomKeyword = exploreKeywords[Math.floor(Math.random() * exploreKeywords.length)]

        if (recommendations.length < limit) {
            try {
                console.log('探索关键词:', randomKeyword)
                const exploreResults = await searchSongs(defaultSource, randomKeyword, 6)
                for (const result of exploreResults) {
                    if (seenIds.has(result.id)) continue
                    seenIds.add(result.id)

                    const track = searchResultToTrack(result)
                    recommendations.push({
                        track,
                        score: 0.4 + Math.random() * 0.3,
                        type: 'hot'
                    })
                }
            } catch (e) {
                console.error('探索推荐失败:', e)
            }
        }

        // 如果用户没有历史，使用默认热门
        if (recommendations.length < limit / 2) {
            try {
                const defaultResults = await searchSongs(defaultSource, '热门歌曲', limit)
                for (const result of defaultResults) {
                    if (seenIds.has(result.id)) continue
                    seenIds.add(result.id)

                    const track = searchResultToTrack(result)
                    recommendations.push({
                        track,
                        score: Math.random(),
                        type: 'hot'
                    })
                }
            } catch (e) {
                console.error('获取默认热门失败:', e)
            }
        }

        // 洗牌算法，打乱顺序以增加随机感
        const shuffled = [...recommendations].sort(() => Math.random() - 0.5)

        // 按分数排序并取前 limit 个
        const sorted = shuffled
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)

        console.log('总计:', recommendations.length, '首，返回 Top', limit)
        console.log('艺人分布:', [...new Set(sorted.map(r => r.track.artist))].slice(0, 8).join(', '))
        console.groupEnd()

        // 缓存结果并标记请求时间
        this.setCache(CACHE_KEY, sorted, HOT_CACHE_TTL)
        this.markGDStudioRequest()

        return sorted
    }

    /**
     * 获取歌曲的智能元数据（带持久化缓存）
     */
    private async getAIMetadata(track: Track): Promise<{ genre: string, era: string, tags: string[], mood: string } | null> {
        try {
            // 1. 尝试从 localStorage 加载缓存
            const cacheStr = localStorage.getItem(METADATA_CACHE_KEY)
            const metadataCache: Record<string, any> = cacheStr ? JSON.parse(cacheStr) : {}

            if (metadataCache[track.id]) {
                return metadataCache[track.id]
            }

            // 2. 调用 AI 分析
            console.log(`[AI 元数据] 正在分析: ${track.title} - ${track.artist}`)
            const metadata = await analyzeTrackMetadata(track.title, track.artist)

            if (metadata) {
                // 3. 存入缓存
                metadataCache[track.id] = metadata
                localStorage.setItem(METADATA_CACHE_KEY, JSON.stringify(metadataCache))
                return metadata
            }
        } catch (e) {
            console.error('获取 AI 元数据失败:', e)
        }
        return null
    }

    /**
     * 获取 AI 专家深度推荐报告
     */
    async getAIExpertRecommendations(track: Track): Promise<AIExpertRecommendation | null> {
        try {
            // 1. 检查缓存
            const cacheStr = localStorage.getItem(EXPERT_CACHE_KEY)
            const expertCache: Record<string, AIExpertRecommendation> = cacheStr ? JSON.parse(cacheStr) : {}

            if (expertCache[track.id]) {
                return expertCache[track.id]
            }

            // 2. 调用 AI 获取推荐
            const prompt = `我在听 ${track.artist} 的 《${track.title}》，请以资深乐评人的身份，为我生成一份结构化的深度推荐报告。包含同类风格、同时代经典、影视金曲、以及更现代的延伸推荐。`

            const result = await getAIRecommendations(prompt)
            if (!result) return null

            // 3. 结构化处理：按 category 分组
            const categoriesMap = new Map<string, any[]>()
            for (const song of (result.songs || [])) {
                const catName = (song as any).category || '推荐列表'
                if (!categoriesMap.has(catName)) {
                    categoriesMap.set(catName, [])
                }
                categoriesMap.get(catName)!.push({
                    title: song.title,
                    artist: song.artist,
                    comment: (song as any).comment || ''
                })
            }

            const expertRec: AIExpertRecommendation = {
                reason: result.reason,
                categories: Array.from(categoriesMap.entries()).map(([name, songs]) => ({
                    name,
                    songs
                }))
            }

            // 4. 存入缓存
            expertCache[track.id] = expertRec
            localStorage.setItem(EXPERT_CACHE_KEY, JSON.stringify(expertCache))

            return expertRec
        } catch (e) {
            console.error('获取 AI 专家推荐失败:', e)
            return null
        }
    }

    /**
     * 获取相似歌曲推荐 (Item-CF)
     * 基于当前播放的歌曲，推荐同艺术家或相似风格的歌曲
     */
    async getSimilarRecommendations(currentTrack: Track, limit = 10): Promise<RecommendItem[]> {
        console.group('[相似推荐] 开始生成')
        console.log('当前歌曲:', `《${currentTrack.title}》 - ${currentTrack.artist}`)

        // 检查缓存
        const cacheKey = `${SIMILAR_CACHE_KEY}_${currentTrack.id}`
        const cache = this.getCache<RecommendItem[]>(cacheKey)
        if (this.isValidCache(cache)) {
            console.log('命中缓存，返回', cache.data.length, '首')
            console.groupEnd()
            return cache.data.slice(0, limit)
        }

        // GD Studio 请求频率限制：如果在限制内且有旧缓存，返回旧缓存
        if (this.isGDStudioRateLimited()) {
            const remaining = Math.ceil(this.getGDStudioRateLimitRemaining() / 60000)
            console.log(`[GD Studio] 请求频率限制中，${remaining} 分钟后可刷新`)
            const oldCache = this.getCache<RecommendItem[]>(cacheKey)
            if (oldCache?.data?.length) {
                console.groupEnd()
                return oldCache.data.slice(0, limit)
            }
        }

        const recommendations: RecommendItem[] = []
        const seenIds = new Set<string>([currentTrack.id])
        const seenTitles = new Set<string>([`${currentTrack.title.toLowerCase().trim()}-${currentTrack.artist.toLowerCase().trim()}`])
        const artistCounts: Record<string, number> = {}
        const MAX_PER_ARTIST = 2 // 每个艺人最多推荐 2 首

        const strategyCounts = { matrix: 0, artist: 0, genre: 0, era: 0, history: 0 }

        // 获取启用的音乐源
        const sources = getEnabledSources()
        const defaultSource: MusicSource = currentTrack._platform as MusicSource || sources[0] || 'netease'

        // 策略0：从相似度矩阵获取推荐（基于同艺人/同流派/同年代）
        const matrixResults = this.getSimilarFromMatrix(currentTrack.id, limit)
        for (const sim of matrixResults) {
            const storedTrack = trackStorage.getTrack(sim.trackId)
            if (storedTrack) {
                const titleKey = `${storedTrack.title.toLowerCase().trim()}-${storedTrack.artist.toLowerCase().trim()}`
                if (seenIds.has(storedTrack.id) || seenTitles.has(titleKey)) continue

                // 艺人多样性检查
                const count = artistCounts[storedTrack.artist] || 0
                if (count >= MAX_PER_ARTIST) continue

                seenIds.add(storedTrack.id)
                seenTitles.add(titleKey)
                artistCounts[storedTrack.artist] = count + 1

                recommendations.push({
                    track: storedTrack,
                    score: 0.8 + sim.score * 0.2,
                    type: 'similar'
                })
                strategyCounts.matrix++
            }
        }
        console.log('策略0 [矩阵]:', strategyCounts.matrix, '首')

        // 策略1：搜索同艺术家的其他歌曲（限制数量）
        // 对于策略1，由于是搜索同艺人，我们稍微放宽一点配额，但总数依然受限
        try {
            const artistResults = await searchSongs(defaultSource, currentTrack.artist, 5)
            for (const result of artistResults) {
                const titleKey = `${result.name.toLowerCase().trim()}-${result.artist.toLowerCase().trim()}`
                if (seenIds.has(result.id) || seenTitles.has(titleKey)) continue

                // 仅针对策略1，如果已经是当前艺人，我们允许最多再加 2 首
                const count = artistCounts[result.artist] || 0
                if (count >= 3) continue // 同一艺人总数不超过 3 (当前播放1 + 推荐2)

                seenIds.add(result.id)
                seenTitles.add(titleKey)
                artistCounts[result.artist] = count + 1

                recommendations.push({
                    track: searchResultToTrack(result),
                    score: 0.7 + Math.random() * 0.1,
                    type: 'similar'
                })
                strategyCounts.artist++
            }
        } catch (e) {
            console.error('搜索同艺术家歌曲失败:', e)
        }
        console.log('策略1 [同艺人]:', strategyCounts.artist, '首')

        // 获取 AI 增强元数据（尝试获取更精准的流派和年代）
        const aiMetadata = await this.getAIMetadata(currentTrack)

        // 策略2：基于推断的流派搜索
        const inferredGenre = aiMetadata?.genre || this.inferGenre(currentTrack.title, currentTrack.artist)
        console.log('推断流派:', inferredGenre, aiMetadata ? '(AI)' : '(本地)')
        if (inferredGenre !== '未知') {
            try {
                const genreResults = await searchSongs(defaultSource, inferredGenre + ' 歌曲', 6)
                for (const result of genreResults) {
                    const titleKey = `${result.name.toLowerCase().trim()}-${result.artist.toLowerCase().trim()}`
                    if (seenIds.has(result.id) || seenTitles.has(titleKey)) continue
                    if (result.artist === currentTrack.artist) continue

                    // 艺人多样性检查
                    const count = artistCounts[result.artist] || 0
                    if (count >= MAX_PER_ARTIST) continue

                    seenIds.add(result.id)
                    seenTitles.add(titleKey)
                    artistCounts[result.artist] = count + 1

                    recommendations.push({
                        track: searchResultToTrack(result),
                        score: 0.65 + Math.random() * 0.1,
                        type: 'similar'
                    })
                    strategyCounts.genre++
                }
            } catch (e) {
                console.error('搜索同流派歌曲失败:', e)
            }
        }
        console.log('策略2 [同流派]:', strategyCounts.genre, '首')

        // 策略3：基于推断的年代搜索
        const inferredEra = aiMetadata?.era || this.inferEra(currentTrack.title, currentTrack.artist)
        console.log('详细推断结果 - 文本:', `"${currentTrack.title} ${currentTrack.artist}"`, '结果:', inferredEra, aiMetadata ? '(AI)' : '(本地)')
        if (inferredEra !== '未知') {
            try {
                // 优化搜索关键词，使用更具体的年代词
                const searchYear = inferredEra.replace('年代', '')
                const query = `${searchYear}年代 经典歌曲`
                const eraResults = await searchSongs(defaultSource, query, 5)
                for (const result of eraResults) {
                    const titleKey = `${result.name.toLowerCase().trim()}-${result.artist.toLowerCase().trim()}`
                    if (seenIds.has(result.id) || seenTitles.has(titleKey)) continue
                    if (result.artist === currentTrack.artist) continue

                    // 艺人多样性检查
                    const count = artistCounts[result.artist] || 0
                    if (count >= MAX_PER_ARTIST) continue

                    seenIds.add(result.id)
                    seenTitles.add(titleKey)
                    artistCounts[result.artist] = count + 1

                    recommendations.push({
                        track: searchResultToTrack(result),
                        score: 0.6 + Math.random() * 0.1,
                        type: 'similar'
                    })
                    strategyCounts.era++
                }
            } catch (e) {
                console.error('搜索同年代歌曲失败:', e)
            }
        }
        console.log('策略3 [同年代]:', strategyCounts.era, '首')

        // 策略4：基于用户历史中与当前歌曲共同出现的歌曲
        const stats = behaviorService.getStatsArray()
        for (const stat of stats.slice(0, 20)) {
            if (stat.trackId === currentTrack.id) continue
            if (seenIds.has(stat.trackId)) continue
            const storedTrack = trackStorage.getTrack(stat.trackId)
            if (storedTrack) {
                const titleKey = `${storedTrack.title.toLowerCase().trim()}-${storedTrack.artist.toLowerCase().trim()}`
                if (seenTitles.has(titleKey)) continue

                // 艺人多样性检查
                const count = artistCounts[storedTrack.artist] || 0
                if (count >= MAX_PER_ARTIST) continue

                seenIds.add(stat.trackId)
                seenTitles.add(titleKey)
                artistCounts[storedTrack.artist] = count + 1

                recommendations.push({
                    track: storedTrack,
                    score: 0.5 + (stat.avgCompletionRate * 0.2) + Math.random() * 0.1,
                    type: 'similar'
                })
                strategyCounts.history++
            }
        }
        console.log('策略4 [历史共现]:', strategyCounts.history, '首')

        // 按分数排序
        const sorted = recommendations
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)

        console.log('总结:', `矩阵${strategyCounts.matrix} + 艺人${strategyCounts.artist} + 流派${strategyCounts.genre} + 年代${strategyCounts.era} + 历史${strategyCounts.history} = ${recommendations.length}首`)
        console.log('返回 Top', limit, ':', sorted.map(r => `${r.track.artist}-${r.track.title.slice(0, 8)}`).join(', '))
        console.groupEnd()

        // 缓存结果并标记请求时间
        this.setCache(cacheKey, sorted, SIMILAR_CACHE_TTL)
        this.markGDStudioRequest()

        return sorted
    }

    /**
     * 获取探索推荐
     * 推荐用户较少接触的内容，增加多样性
     */
    async getExploreRecommendations(limit = 6): Promise<RecommendItem[]> {
        const recommendations: RecommendItem[] = []
        const profile = behaviorService.getUserProfile()

        // 获取启用的音乐源
        const sources = getEnabledSources()
        const defaultSource: MusicSource = sources[0] || 'netease'

        // 使用用户不常听的平台
        const lessUsedPlatforms = sources.filter(
            source => !profile.favoritePlatforms.some(p => p.name === source)
        )
        const exploreSource = lessUsedPlatforms[0] || defaultSource

        // 搜索一些通用热门关键词
        const exploreKeywords = ['新歌', '推荐', '热门', '流行']
        const keyword = exploreKeywords[Math.floor(Math.random() * exploreKeywords.length)]

        try {
            const results = await searchSongs(exploreSource, keyword, limit)
            for (const result of results) {
                const track = searchResultToTrack(result)
                recommendations.push({
                    track,
                    score: Math.random(),
                    type: 'explore'
                })
            }
        } catch (e) {
            console.error('获取探索推荐失败:', e)
        }

        return recommendations
    }

    /**
     * 获取混合个性化推荐
     * 热门 40% + 相似 30% + 探索 30%
     */
    async getPersonalizedRecommendations(
        currentTrack?: Track,
        limit = 20
    ): Promise<RecommendItem[]> {
        const hotLimit = Math.ceil(limit * 0.4)
        const similarLimit = Math.ceil(limit * 0.3)
        const exploreLimit = Math.ceil(limit * 0.3)

        // 并行获取各类推荐
        const [hotRecs, similarRecs, exploreRecs] = await Promise.all([
            this.getHotRecommendations(hotLimit),
            currentTrack
                ? this.getSimilarRecommendations(currentTrack, similarLimit)
                : Promise.resolve([]),
            this.getExploreRecommendations(exploreLimit)
        ])

        // 合并并去重
        const seenIds = new Set<string>()
        const merged: RecommendItem[] = []

        const addUnique = (items: RecommendItem[]) => {
            for (const item of items) {
                if (!seenIds.has(item.track.id)) {
                    seenIds.add(item.track.id)
                    merged.push(item)
                }
            }
        }

        addUnique(hotRecs)
        addUnique(similarRecs)
        addUnique(exploreRecs)

        return merged.slice(0, limit)
    }

    /**
     * 生成 AI 推荐理由
     * 增强版：包含用户画像、最近播放、时间上下文
     */
    async generateRecommendReason(
        track: Track,
        userProfile: UserProfile,
        recentPlays?: string[]
    ): Promise<string> {
        const config = loadAIConfig()

        // 如果 AI 未配置，返回默认理由
        if (!config.apiKey) {
            console.log('[推荐] AI 未配置，使用默认理由')
            return this.getDefaultReason(track, userProfile)
        }

        try {
            // 获取时间上下文
            const now = new Date()
            const hour = now.getHours()
            const dayOfWeek = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][now.getDay()]
            let timeOfDay = '日常'
            if (hour >= 6 && hour < 9) timeOfDay = '早晨通勤'
            else if (hour >= 9 && hour < 12) timeOfDay = '上午工作'
            else if (hour >= 12 && hour < 14) timeOfDay = '午休'
            else if (hour >= 14 && hour < 18) timeOfDay = '下午工作'
            else if (hour >= 18 && hour < 21) timeOfDay = '晚间放松'
            else if (hour >= 21 || hour < 6) timeOfDay = '深夜'

            // 获取最近播放（如果未提供）
            let recentTracks = recentPlays
            if (!recentTracks) {
                const recentArtists = behaviorService.getRecentArtists(3)
                recentTracks = recentArtists
            }

            // ========== 打印用户画像汇总 ==========
            console.group('[推荐] 用户画像汇总')
            console.log('偏好艺人:', userProfile.favoriteArtists.slice(0, 5).map(a => `${a.name}(${a.count}次)`).join(', ') || '无')
            console.log('偏好平台:', userProfile.favoritePlatforms.slice(0, 3).map(p => `${p.name}(${p.count}次)`).join(', ') || '无')
            console.log('偏好时段:', userProfile.preferredTimeOfDay || '未知')
            console.log('总播放次数:', userProfile.totalPlayCount)
            console.log('平均完播率:', `${(userProfile.avgCompletionRate * 100).toFixed(1)}%`)
            console.log('最近听过:', recentTracks?.slice(0, 5).join(', ') || '无')
            console.log('当前时间:', `${timeOfDay}（${dayOfWeek} ${hour}:00）`)
            console.groupEnd()

            // 构建推荐 prompt
            const prompt = `你是一个专业的音乐推荐助手，请用15字以内简短说明推荐理由。

用户信息：
- 偏好艺人：${userProfile.favoriteArtists.slice(0, 5).map(a => a.name).join('、') || '未知'}
- 偏好平台：${userProfile.favoritePlatforms.slice(0, 2).map(p => p.name).join('、') || '未知'}
- 平均完播率：${(userProfile.avgCompletionRate * 100).toFixed(0)}%

最近听过：${recentTracks?.slice(0, 3).join('、') || '暂无'}

当前上下文：
- 时间：${timeOfDay}（${dayOfWeek}）

推荐歌曲：《${track.title}》 - ${track.artist}

请考虑：
1. 根据用户偏好艺人风格匹配程度
2. 根据当前时间段推荐适合的音乐
3. 如果是新艺人，强调"拓展新风格"

要求：15字以内，可用emoji，有趣有温度，不要引号`

            // ========== 打印发送给 AI 的 prompt ==========
            console.group('[推荐] 发送给 AI 的请求')
            console.log('推荐歌曲:', `《${track.title}》 - ${track.artist}`)
            console.log('API:', config.baseUrl)
            console.log('模型:', config.model)
            console.log('Prompt 长度:', prompt.length, '字符')
            console.groupEnd()

            const response = await fetch(`${config.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey}`
                },
                body: JSON.stringify({
                    model: config.model,
                    messages: [
                        {
                            role: 'system',
                            content: '你是一个专业的音乐推荐助手。根据用户信息和收听历史，生成简短有趣的推荐理由。'
                        },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.7,
                    max_tokens: 60
                })
            })

            if (!response.ok) {
                console.error('[推荐] AI 请求失败:', response.status, response.statusText)
                throw new Error('AI 请求失败')
            }

            const data = await response.json()
            const reason = data.choices?.[0]?.message?.content?.trim()

            // ========== 打印 AI 返回结果 ==========
            console.group('[推荐] AI 返回结果')
            console.log('歌曲:', `《${track.title}》 - ${track.artist}`)
            console.log('AI 理由:', reason || '(无)')
            console.log('Token 使用:', data.usage?.total_tokens || '未知')
            console.groupEnd()

            return reason || this.getDefaultReason(track, userProfile)
        } catch (e) {
            console.error('[推荐] 生成AI推荐理由失败:', e)
            return this.getDefaultReason(track, userProfile)
        }
    }

    /**
     * 批量生成推荐理由（优化版：一次请求多首歌）
     */
    async generateRecommendReasons(
        recommendations: RecommendItem[],
        maxBatch = 5
    ): Promise<RecommendItem[]> {
        const profile = behaviorService.getUserProfile()
        const config = loadAIConfig()

        // 如果 AI 未配置，全部使用默认理由
        if (!config.apiKey) {
            console.log('[推荐] AI 未配置，全部使用默认理由')
            return recommendations.map(rec => ({
                ...rec,
                reason: rec.reason || this.getDefaultReason(rec.track, profile)
            }))
        }

        // 只对前 maxBatch 首使用 AI
        const toProcess = recommendations.slice(0, maxBatch).filter(r => !r.reason)

        if (toProcess.length === 0) {
            return recommendations.map(rec => ({
                ...rec,
                reason: rec.reason || this.getDefaultReason(rec.track, profile)
            }))
        }

        try {
            // 获取时间上下文
            const now = new Date()
            const hour = now.getHours()
            let timeOfDay = '日常'
            if (hour >= 6 && hour < 9) timeOfDay = '早晨'
            else if (hour >= 12 && hour < 14) timeOfDay = '午休'
            else if (hour >= 18 && hour < 21) timeOfDay = '晚间'
            else if (hour >= 21 || hour < 6) timeOfDay = '深夜'

            // 构建批量 prompt
            const songList = toProcess.map((r, i) =>
                `${i + 1}. 《${r.track.title}》- ${r.track.artist}`
            ).join('\n')

            const prompt = `你是音乐推荐助手。请为以下歌曲各生成一条简短推荐理由（每条15字以内）。

用户偏好艺人：${profile.favoriteArtists.slice(0, 5).map(a => a.name).join('、') || '未知'}
当前时间：${timeOfDay}

歌曲列表：
${songList}

请按以下 JSON 格式返回（数组顺序与歌曲顺序对应）：
{"reasons": ["理由1", "理由2", ...]}

要求：每条理由可用emoji，简洁有趣，不要引号`

            console.group('[推荐] 批量 AI 请求')
            console.log('歌曲数:', toProcess.length)
            console.log('Prompt 长度:', prompt.length)

            const response = await fetch(`${config.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${config.apiKey}`
                },
                body: JSON.stringify({
                    model: config.model,
                    messages: [
                        { role: 'system', content: '你是音乐推荐助手，返回 JSON 格式的推荐理由列表。' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.7,
                    max_tokens: 300
                })
            })

            if (!response.ok) {
                throw new Error(`AI 请求失败: ${response.status}`)
            }

            const data = await response.json()
            const content = data.choices?.[0]?.message?.content?.trim() || ''

            console.log('AI 返回:', content.slice(0, 200))
            console.log('Token 使用:', data.usage?.total_tokens)
            console.groupEnd()

            // 解析 JSON
            let reasons: string[] = []
            try {
                const jsonMatch = content.match(/\{[\s\S]*\}/)
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0])
                    reasons = parsed.reasons || []
                }
            } catch (e) {
                console.warn('解析 AI 返回失败，使用默认理由')
            }

            // 合并结果
            const withReasons: RecommendItem[] = []
            for (let i = 0; i < recommendations.length; i++) {
                const rec = recommendations[i]
                if (i < toProcess.length && reasons[i]) {
                    withReasons.push({ ...rec, reason: reasons[i] })
                } else {
                    withReasons.push({
                        ...rec,
                        reason: rec.reason || this.getDefaultReason(rec.track, profile)
                    })
                }
            }

            return withReasons
        } catch (e) {
            console.error('[推荐] 批量 AI 请求失败:', e)
            // 回退到默认理由
            return recommendations.map(rec => ({
                ...rec,
                reason: rec.reason || this.getDefaultReason(rec.track, profile)
            }))
        }
    }

    /** 获取默认推荐理由 */
    private getDefaultReason(track: Track, profile: UserProfile): string {
        const isKnownArtist = profile.favoriteArtists.some(
            a => a.name === track.artist
        )

        if (isKnownArtist) {
            return `💗 你喜欢的 ${track.artist}`
        }

        const reasons = [
            `🎵 ${track.artist} 的热门曲目`,
            `✨ 精选推荐`,
            `🔥 人气歌曲`,
            `🎧 为你推荐`
        ]

        return reasons[Math.floor(Math.random() * reasons.length)]
    }

    /** 清除缓存（包括相似度矩阵） */
    clearCache(): void {
        try {
            // 清除热门推荐缓存
            localStorage.removeItem(CACHE_KEY)

            // 清除相似度矩阵缓存
            localStorage.removeItem(SIMILARITY_MATRIX_KEY)
            this.similarityMatrix = null

            // 清除所有相似推荐缓存
            const keys = Object.keys(localStorage)
            for (const key of keys) {
                if (key.startsWith(SIMILAR_CACHE_KEY)) {
                    localStorage.removeItem(key)
                }
            }

            console.log('已清除所有推荐缓存')
        } catch (e) {
            console.error('清除缓存失败:', e)
        }
    }
}

export const recommendationService = new RecommendationService()
