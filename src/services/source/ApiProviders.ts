/**
 * API 提供商抽象层
 * 支持在不同的音乐 API 服务之间切换
 */
import { Capacitor } from '@capacitor/core'
import { nativeFetch, type MusicPlatform } from '@/utils/nativeFetch'
export type { MusicPlatform }
export type AudioQuality = '128k' | '320k' | 'flac' | 'flac24bit'
export type ApiProviderType = 'sayqz' | 'gdstudio'

export interface SearchResult {
    id: string
    name: string
    artist: string
    album?: string
    url: string
    platform: MusicPlatform
    // GD Studio 特有字段
    pic_id?: string
    lyric_id?: string
    cover?: string // 新增封面字段
}

export interface ApiProvider {
    readonly name: string
    readonly id: ApiProviderType
    readonly supportedPlatforms: MusicPlatform[]

    search(platform: MusicPlatform, keyword: string, limit?: number): Promise<SearchResult[]>
    getMusicUrl(platform: MusicPlatform, id: string, quality?: AudioQuality): string
    // GD Studio 需要异步获取真实音频URL，因为API返回JSON而非直接重定向
    getActualMusicUrl(platform: MusicPlatform, id: string, quality?: AudioQuality): Promise<string>
    getCoverUrl(platform: MusicPlatform, id: string, picId?: string): string
    // GD Studio 封面也返回 JSON，需要异步解析
    getActualCoverUrl(platform: MusicPlatform, id: string, picId?: string): Promise<string>
    getLyrics(platform: MusicPlatform, id: string, lyricId?: string): Promise<string>
}

// ========== TuneHub API Key 管理 ==========

const TUNEHUB_API_KEY_STORAGE = 'tunehub_api_key'
const DEFAULT_TUNEHUB_API_KEY = 'th_58b325542b5ab26a309749148bdc4532393e88ed42889e8b'

export function getTuneHubApiKey(): string {
    try {
        const saved = localStorage.getItem(TUNEHUB_API_KEY_STORAGE)
        if (saved) return saved
    } catch { }
    return DEFAULT_TUNEHUB_API_KEY
}

export function setTuneHubApiKey(key: string): void {
    localStorage.setItem(TUNEHUB_API_KEY_STORAGE, key)
}

// ========== TuneHub Provider (原 Sayqz API，已升级) ==========

class TuneHubProvider implements ApiProvider {
    readonly name = 'TuneHub'
    readonly id: ApiProviderType = 'sayqz' // 保持 id 兼容性
    readonly supportedPlatforms: MusicPlatform[] = ['qq', 'netease', 'kuwo', 'kugou', 'migu', 'joox', 'tencent']

    // Parse 响应缓存 (避免重复请求)
    private parseCache = new Map<string, {
        url: string
        cover: string
        lyrics: string
        timestamp: number
    }>()
    private readonly CACHE_TTL = 30 * 60 * 1000 // 30分钟缓存

    // 正在进行的请求 (防止并发重复请求)
    private pendingRequests = new Map<string, Promise<{
        url: string
        cover: string
        lyrics: string
    } | null>>()

    private get baseUrl(): string {
        // 在原生平台上即使是开发模式也直接访问公网 API
        // 因为 Vite 代理只在 HMR 浏览器环境下有效，App 里的 WebView 无法识别 HMR 代理
        if (Capacitor.isNativePlatform()) {
            return 'https://tunehub.sayqz.com/api'
        }
        return import.meta.env.DEV ? '/api' : 'https://tunehub.sayqz.com/api'
    }

    private get authHeaders(): Record<string, string> {
        return { 'X-API-Key': getTuneHubApiKey() }
    }

    // 获取 method 配置并执行请求
    private async executeMethod(
        platform: MusicPlatform,
        method: string,
        variables: Record<string, string | number>
    ): Promise<any[]> {
        try {
            // [Override] QQ 搜索特殊处理 (使用 DoSearchForQQMusicLite)
            if ((platform === 'qq' || platform === 'tencent') && method === 'search') {
                console.log('[TuneHub] 使用本地 QQ 搜索配置 override')
                const targetUrl = 'https://u.y.qq.com/cgi-bin/musicu.fcg'
                const requestBody = {
                    "comm": {
                        "ct": 11,
                        "cv": "1003006",
                        "v": "1003006",
                        "os_ver": "12",
                        "phonetype": "0",
                        "devicelevel": "31",
                        "tmeAppID": "qqmusiclight",
                        "nettype": "NETWORK_WIFI"
                    },
                    "req": {
                        "module": "music.search.SearchCgiService",
                        "method": "DoSearchForQQMusicLite",
                        "param": {
                            "query": String(variables.keyword),
                            "search_type": 0,
                            "num_per_page": Number(variables.limit || 20),
                            "page_num": Number(variables.page || 1),
                            "nqc_flag": 0,
                            "grp": 1
                        }
                    }
                }

                let fullUrl = targetUrl
                if (import.meta.env.DEV && !Capacitor.isNativePlatform()) {
                    fullUrl = '/proxy-qq/cgi-bin/musicu.fcg'
                }

                try {
                    const response = await nativeFetch(fullUrl, {
                        method: 'POST',
                        body: requestBody,
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    })
                    const json = await response.json()

                    if (json.req && json.req.data && json.req.data.body && json.req.data.body.item_song) {
                        return json.req.data.body.item_song.map((item: any) => ({
                            id: item.mid,
                            name: item.name,
                            artist: item.singer ? item.singer.map((s: any) => s.name).join('/') : '',
                            album: item.album ? item.album.name : '',
                            cover: item.album && item.album.mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${item.album.mid}.jpg` : ''
                        }))
                    }
                    return []
                } catch (e) {
                    console.error('[TuneHub] QQ 本地搜索失败:', e)
                    return []
                }
            }

            // [Override] QQ 排行榜详情 (GetDetail)
            if ((platform === 'qq' || platform === 'tencent') && method === 'toplist') {
                console.log('[TuneHub] 使用本地 QQ 排行榜详情配置 override')
                const targetUrl = 'https://u.y.qq.com/cgi-bin/musicu.fcg'
                const requestBody = {
                    "comm": {
                        "ct": 20,
                        "cv": 1859,
                        "uin": 0,
                        "format": "json"
                    },
                    "toplist": {
                        "module": "musicToplist.ToplistInfoServer",
                        "method": "GetDetail",
                        "param": {
                            "topId": Number(variables.id),
                            "offset": 0,
                            "num": 100,
                            "period": ""
                        }
                    }
                }

                let fullUrl = targetUrl
                if (import.meta.env.DEV && !Capacitor.isNativePlatform()) {
                    fullUrl = '/proxy-qq/cgi-bin/musicu.fcg'
                }

                try {
                    const response = await nativeFetch(fullUrl, {
                        method: 'POST',
                        body: requestBody,
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    })
                    const json = await response.json()

                    const toplistData = json.toplist?.data
                    const songlist = toplistData?.songInfoList || toplistData?.songlist || toplistData?.song_list || toplistData?.list

                    if (songlist && Array.isArray(songlist)) {
                        return songlist.map((item: any) => {
                            // 兼容不同版本的字段名
                            const song = item.mid ? item : (item.data || item)
                            return {
                                id: song.mid || song.songmid || String(song.id || song.songid),
                                name: song.name || song.songname || song.title || '',
                                artist: song.singer ? song.singer.map((s: any) => s.name).join('/') : '',
                                album: song.album ? (song.album.name || '') : (song.albumname || ''),
                                cover: song.album?.mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${song.album.mid}.jpg` :
                                    (song.albummid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${song.albummid}.jpg` : '')
                            }
                        })
                    }
                    return []
                } catch (e) {
                    console.error('[TuneHub] QQ 本地排行榜获取失败:', e)
                    return []
                }
            }

            // [Override] QQ 排行榜列表 (GetAll)
            if ((platform === 'qq' || platform === 'tencent') && method === 'toplists') {
                console.log('[TuneHub] 使用本地 QQ 排行榜列表配置 override')
                const targetUrl = 'https://u.y.qq.com/cgi-bin/musicu.fcg'
                const requestBody = {
                    "comm": {
                        "ct": 11,
                        "cv": "1003006",
                        "v": "1003006",
                        "os_ver": "12",
                        "phonetype": "0",
                        "devicelevel": "31",
                        "tmeAppID": "qqmusiclight",
                        "nettype": "NETWORK_WIFI"
                    },
                    "toplist": {
                        "module": "musicToplist.ToplistInfoServer",
                        "method": "GetAll",
                        "param": {}
                    }
                }

                let fullUrl = targetUrl
                if (import.meta.env.DEV && !Capacitor.isNativePlatform()) {
                    fullUrl = '/proxy-qq/cgi-bin/musicu.fcg'
                }

                try {
                    const response = await nativeFetch(fullUrl, {
                        method: 'POST',
                        body: requestBody,
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    })
                    const json = await response.json()

                    if (json.toplist && json.toplist.data && json.toplist.data.group) {
                        const result: any[] = []
                        json.toplist.data.group.forEach((group: any) => {
                            if (group.toplist) {
                                group.toplist.forEach((item: any) => {
                                    result.push({
                                        id: String(item.topId),
                                        name: item.title,
                                        pic: item.frontPicUrl || item.headPicUrl,
                                        updateFrequency: item.updateType === 1 ? 'Daily' : 'Weekly'
                                    })
                                })
                            }
                        })
                        return result
                    }
                    return []
                } catch (e) {
                    console.error('[TuneHub] QQ 本地排行榜列表失败:', e)
                    return []
                }
            }

            // [Override] Netease 排行榜详情
            if (platform === 'netease' && method === 'toplist') {
                console.log('[TuneHub] 使用本地 Netease 排行榜详情配置 override')
                let targetUrl = `https://music.163.com/api/playlist/detail?id=${variables.id}`
                if (import.meta.env.DEV && !Capacitor.isNativePlatform()) {
                    targetUrl = `/proxy-netease/api/playlist/detail?id=${variables.id}`
                }

                try {
                    const response = await nativeFetch(targetUrl, {
                        headers: {}
                    })
                    const json = await response.json()

                    const data = json.result || json.playlist
                    if (data && data.tracks) {
                        return data.tracks.map((item: any) => ({
                            id: String(item.id),
                            name: item.name,
                            artist: item.artists ? item.artists.map((a: any) => a.name).join('/') :
                                (item.ar ? item.ar.map((a: any) => a.name).join('/') : ''),
                            album: item.album ? item.album.name : (item.al ? item.al.name : ''),
                            cover: (item.album && item.album.picUrl ? item.album.picUrl :
                                (item.al && item.al.picUrl ? item.al.picUrl : '')).replace('http:', 'https:'),
                            pic_id: item.album ? String(item.album.picId) : (item.al ? String(item.al.pic_id || item.al.pic) : undefined)
                        }))
                    }
                    return []
                } catch (e) {
                    console.error('[TuneHub] Netease 本地排行榜获取失败:', e)
                    return []
                }
            }

            // 1. 调用 TuneHub 方法 (带参数，让 TuneHub 代理执行)
            const params = new URLSearchParams()
            for (const [key, value] of Object.entries(variables)) {
                if (value !== undefined && value !== null) {
                    params.set(key, String(value))
                }
            }
            const configUrl = params.toString()
                ? `${this.baseUrl}/v1/methods/${platform}/${method}?${params.toString()}`
                : `${this.baseUrl}/v1/methods/${platform}/${method}`

            const configRes = await nativeFetch(configUrl, { headers: this.authHeaders })
            const configJson = await configRes.json()

            if (!configJson.success || !configJson.data) {
                console.error(`[TuneHub] 获取 ${platform}/${method} 配置失败:`, configJson)
                return []
            }

            const config = configJson.data

            // 2. 构建请求 URL 和参数
            let targetUrl = config.url
            const targetParams = new URLSearchParams()


            if (config.params) {
                for (const [key, template] of Object.entries(config.params)) {
                    let value = String(template)
                    // 替换模板变量
                    for (const [varName, varValue] of Object.entries(variables)) {
                        value = value.replace(new RegExp(`\\{\\{${varName}\\}\\}`, 'g'), String(varValue))
                    }
                    // 处理表达式 (如 {{((page || 1) - 1) * (limit || 20)}})
                    value = value.replace(/\{\{([^}]+)\}\}/g, (_, expr) => {
                        try {
                            // 安全地评估简单表达式
                            const safeExpr = expr
                                .replace(/\bpage\b/g, String(variables.page || 1))
                                .replace(/\blimit\b/g, String(variables.limit || 20))
                            // eslint-disable-next-line no-eval
                            return String(eval(safeExpr))
                        } catch {
                            return '0'
                        }
                    })
                    targetParams.set(key, value)
                }
            }

            // 2.1 构建 Body (如果存在配置)
            let requestBody: any = undefined
            if (config.body || config.data) {
                try {
                    const rawBody = config.body || config.data
                    // 先转字符串进行模板替换
                    let bodyStr = JSON.stringify(rawBody)

                    // 替换模板变量
                    for (const [varName, varValue] of Object.entries(variables)) {
                        bodyStr = bodyStr.replace(new RegExp(`\\{\\{${varName}\\}\\}`, 'g'), String(varValue))
                    }
                    // 处理表达式 (如 {{parseInt(id)}} 或 {{((page || 1) - 1) * (limit || 20)}})
                    // 特别处理: 如果 "{{expr}}" 的结果是数字，则移除引号使其成为真正的数字
                    bodyStr = bodyStr.replace(/"?\{\{([^}]+)\}\}"?/g, (match, expr) => {
                        try {
                            // 替换所有变量名为其值
                            let safeExpr = expr
                            for (const [varName, varValue] of Object.entries(variables)) {
                                safeExpr = safeExpr.replace(new RegExp(`\\b${varName}\\b`, 'g'), JSON.stringify(varValue))
                            }
                            // 提供默认值处理
                            safeExpr = safeExpr
                                .replace(/\bpage\b/g, '1')
                                .replace(/\blimit\b/g, '20')
                            // eslint-disable-next-line no-eval
                            const result = eval(safeExpr)

                            // 如果结果是数字或布尔值，直接返回（不带引号）
                            if (typeof result === 'number' || typeof result === 'boolean') {
                                return String(result)
                            }
                            // 如果结果是字符串且原本在引号内，保持引号
                            if (match.startsWith('"') && match.endsWith('"')) {
                                return `"${result}"`
                            }
                            return String(result)
                        } catch (e) {
                            console.warn('[TuneHub] 表达式计算失败:', expr, e)
                            return match.startsWith('"') ? '"0"' : '0'
                        }
                    })

                    requestBody = JSON.parse(bodyStr)
                } catch (e) {
                    console.warn('[TuneHub] Body 解析失败:', e)
                    // 如果解析失败，可能是普通字符串模版
                    requestBody = config.body || config.data
                }
            }


            const separator = targetUrl.includes('?') ? '&' : '?'
            let fullUrl = targetParams.toString() ? `${targetUrl}${separator}${targetParams.toString()}` : targetUrl

            // 开发模式下通过 Vite 代理解决 CORS
            if (import.meta.env.DEV && !Capacitor.isNativePlatform()) {
                // 重写 URL 使用本地代理
                if (fullUrl.includes('music.163.com')) {
                    fullUrl = fullUrl.replace('https://music.163.com', '/proxy-netease')
                } else if (fullUrl.includes('u.y.qq.com')) {
                    fullUrl = fullUrl.replace('https://u.y.qq.com', '/proxy-qq')
                } else if (fullUrl.includes('www.kuwo.cn') || fullUrl.includes('kuwo.cn')) {
                    fullUrl = fullUrl.replace(/https?:\/\/([\w-]+\.)?kuwo\.cn/, '/proxy-kuwo')
                }
            }

            // 3. 执行请求
            const requestHeaders = { ...config.headers }

            // 注意：nativeFetch 如果只传 fullUrl 和 headers 确实不会传 body
            // 需要构造 options 对象
            const fetchOptions: any = { headers: requestHeaders }
            if (requestBody) {
                fetchOptions.body = requestBody
                fetchOptions.method = config.method || 'POST' // 如果有 body 默认 POST
            }
            // 如果 config 明确指定了 POST
            if (config.method) {
                fetchOptions.method = config.method
            }

            const response = await nativeFetch(fullUrl, fetchOptions)
            const data = await response.json()

            // 4. 应用 transform 函数
            if (config.transform) {
                try {
                    // eslint-disable-next-line no-new-func
                    const transformFn = new Function('return ' + config.transform)()
                    const result = transformFn(data) || []
                    return result
                } catch (e) {
                    console.error('[TuneHub] Transform 执行失败:', e)
                    return []
                }
            }

            return Array.isArray(data) ? data : []
        } catch (e) {
            console.error(`[TuneHub][${platform}/${method}] 请求失败:`, e)
            return []
        }
    }

    async search(platform: MusicPlatform, keyword: string, limit = 20): Promise<SearchResult[]> {
        try {
            const results = await this.executeMethod(platform, 'search', {
                keyword,
                limit,
                pageSize: limit, // 兼容文档中提到的 {{pageSize}} 变量
                page: 1
            })

            return results.map((r: any) => ({
                id: String(r.id),
                name: r.name || '',
                artist: r.artist || '',
                album: r.album || '',
                cover: this.sanitizeUrl(r.pic || r.cover || r.picUrl || ''), // 映射并清洗封面
                url: '',
                platform: platform
            }))
        } catch (e) {
            console.error(`[TuneHub][${platform}] 搜索失败:`, e)
            return []
        }
    }

    getMusicUrl(platform: MusicPlatform, id: string, quality: AudioQuality = '320k'): string {
        // 构建 parse URL - 实际获取需要通过 getActualMusicUrl
        return `${this.baseUrl}/v1/parse?platform=${platform}&ids=${id}&quality=${quality}`
    }

    async getActualMusicUrl(platform: MusicPlatform, id: string, quality: AudioQuality = '320k'): Promise<string> {
        const cacheKey = `${platform}-${id}`

        // 1. 检查缓存
        const cached = this.parseCache.get(cacheKey)
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
            console.log('[TuneHub] 使用缓存的音频 URL:', cached.url)
            return cached.url
        }

        // 2. 检查是否有正在进行的请求
        const pending = this.pendingRequests.get(cacheKey)
        if (pending) {
            console.log('[TuneHub] 等待进行中的请求:', cacheKey)
            const result = await pending
            if (result?.url) return result.url
            throw new Error('无法获取音频URL')
        }

        // 3. 发起新请求并注册到 pending
        const requestPromise = this.doParseRequest(platform, id, quality)
        this.pendingRequests.set(cacheKey, requestPromise)

        try {
            const result = await requestPromise
            if (result?.url) {
                return result.url
            }
            throw new Error('无法获取音频URL')
        } finally {
            this.pendingRequests.delete(cacheKey)
        }
    }

    // 实际执行 parse 请求
    private async doParseRequest(
        platform: MusicPlatform,
        id: string,
        quality: AudioQuality = '320k'
    ): Promise<{ url: string; cover: string; lyrics: string } | null> {
        const cacheKey = `${platform}-${id}`

        try {
            const parseUrl = `${this.baseUrl}/v1/parse`
            const body = {
                platform,
                ids: String(id),
                quality
            }
            console.log('[TuneHub] 请求 parse URL:', parseUrl, body)

            const res = await nativeFetch(parseUrl, {
                method: 'POST',
                headers: { ...this.authHeaders, 'Content-Type': 'application/json' },
                body
            })
            const json = await res.json()
            console.log('[TuneHub] Parse 响应:', JSON.stringify(json))

            // 解析响应
            let songData: any = null
            if (json.success && json.data) {
                if (json.data.data && Array.isArray(json.data.data)) {
                    songData = json.data.data[0]
                } else {
                    const songs = Array.isArray(json.data) ? json.data : [json.data]
                    songData = songs[0]
                }
            } else if (json.code === 0 && json.data) {
                songData = json.data
            }

            if (songData?.url) {
                const result = {
                    url: songData.url,
                    cover: this.sanitizeUrl(songData.cover || songData.pic || songData.picUrl || ''),
                    lyrics: this.parseLyrics(songData.lyrics || songData.lrc || songData.lyric || '')
                }

                // 存入缓存
                this.parseCache.set(cacheKey, {
                    ...result,
                    timestamp: Date.now()
                })
                console.log('[TuneHub] 已缓存 parse 响应:', cacheKey)
                return result
            }

            // 备用格式
            if (typeof json.data === 'string' && json.data.startsWith('http')) {
                return { url: json.data, cover: '', lyrics: '' }
            }

            console.error('[TuneHub] Parse 返回无效数据:', json)
            return null
        } catch (e) {
            console.error('[TuneHub] 获取音频URL失败:', e)
            return null
        }
    }

    // 辅助方法：清洗 URL (解决有些 API 返回相对路径或带参数 of URL 问题)
    private sanitizeUrl(url: string | undefined): string {
        if (!url) return ''
        if (url.startsWith('http')) return url
        if (url.startsWith('//')) return `https:${url}`

        // 处理相对路径
        const path = url.startsWith('/') ? url : `/${url}`

        // 特殊处理: 某些 API 返回旧版 Sayqz 代理路径 /?source=... 或 /api/?source=...
        // 这种路径在本地环境下无法正确映射，应该转换为直链
        if (path.includes('source=') && (path.includes('id=') || path.includes('mid='))) {
            const queryPart = path.split('?')[1]
            if (queryPart) {
                const params = new URLSearchParams(queryPart)
                const source = params.get('source') as MusicPlatform
                const id = params.get('id') || params.get('mid')
                if (source && id) {
                    const directUrl = this.getCoverUrl(source, id)
                    if (directUrl) return directUrl
                }
            }
        }

        // 如果路径已经包含了 api 或者是外部链接则不处理
        // 注意：TuneHub 的 baseUrl 在开发环境下是 /api
        const currentBase = this.baseUrl
        if (path.startsWith(currentBase) || (import.meta.env.DEV && path.startsWith('/api'))) {
            return path
        }

        // 避免重复叠加 /api
        const cleanPath = path.replace(/^\/api\//, '/').replace(/^\/api\?/, '/?')
        return `${currentBase}${cleanPath}`
    }

    getCoverUrl(platform: MusicPlatform, id: string, picId?: string): string {
        switch (platform) {
            case 'netease':
                // 网易云: 如果有 picId 可以直接构造，否则尝试返回一个比较通用的构造方式
                if (picId && picId !== '0') {
                    return `https://p1.music.126.net/${picId}/${id}.jpg`
                }
                // 如果没有 picId，尝试用网易云的通用图片 API (有些老的或特殊的歌曲支持这种方式)
                return `https://music.163.com/api/song/enhance/player/url?id=${id}&ids=[${id}]&type=pic` // 实际上这个是获取URL的，网易没有太统一的直链构造
            case 'qq':
                // QQ 音乐: 构造 300x300 的封面 URL
                if (id.length > 10) { // mid 通常较长
                    return `https://y.gtimg.cn/music/photo_new/T002R300x300M000${id}.jpg`
                }
                return ''
            default:
                return ''
        }
    }

    async getActualCoverUrl(platform: MusicPlatform, id: string): Promise<string> {
        const cacheKey = `${platform}-${id}`

        // 1. 检查缓存
        const cached = this.parseCache.get(cacheKey)
        if (cached && cached.cover && Date.now() - cached.timestamp < this.CACHE_TTL) {
            console.log('[TuneHub] 使用缓存的封面:', cached.cover)
            return cached.cover
        }

        try {
            console.log('[TuneHub] 获取封面:', { platform, id })

            if (platform === 'netease') {
                // 网易云音乐: 获取歌曲详情
                let detailUrl = `https://music.163.com/api/song/detail?ids=[${id}]`

                // 开发模式使用代理
                if (import.meta.env.DEV && !Capacitor.isNativePlatform()) {
                    detailUrl = `/proxy-netease/api/song/detail?ids=[${id}]`
                }

                const res = await nativeFetch(detailUrl, {
                    headers: {
                        'Referer': 'https://music.163.com/',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                })
                const json = await res.json()
                console.log('[TuneHub] 网易云歌曲详情:', json)

                if (json.songs && json.songs[0]?.album?.picUrl) {
                    const cover = json.songs[0].album.picUrl
                    console.log('[TuneHub] 获取到封面:', cover)
                    return cover
                }
            }

            if (platform === 'qq') {
                // QQ 音乐暂不支持直接获取封面
                // 可以尝试从 parse 接口获取
                const res = await nativeFetch(`${this.baseUrl}/v1/parse`, {
                    method: 'POST',
                    headers: { ...this.authHeaders, 'Content-Type': 'application/json' },
                    body: { platform, ids: id, quality: '128k' }
                })
                const json = await res.json()
                console.log('[TuneHub] QQ Parse 响应 (封面):', json)

                if (json.success && json.data) {
                    // 1. 处理嵌套格式 { data: { data: [...] } }
                    if (json.data.data && Array.isArray(json.data.data)) {
                        const songs = json.data.data
                        const cover = songs[0]?.pic || songs[0]?.cover || songs[0]?.picUrl
                        if (cover) return cover
                    }

                    // 2. 处理直接格式
                    const songs = Array.isArray(json.data) ? json.data : [json.data]
                    const cover = songs[0]?.pic || songs[0]?.cover || songs[0]?.picUrl
                    if (cover) return cover
                }
            }

            if (platform === 'kuwo') {
                // 酷我音乐
                let infoUrl = `https://www.kuwo.cn/api/www/music/musicInfo?mid=${id}`

                if (import.meta.env.DEV && !Capacitor.isNativePlatform()) {
                    infoUrl = `/proxy-kuwo/api/www/music/musicInfo?mid=${id}`
                }

                const res = await nativeFetch(infoUrl)
                const json = await res.json()
                console.log('[TuneHub] 酷我歌曲详情:', json)

                if (json.data?.pic) {
                    return json.data.pic
                }
            }
        } catch (e) {
            console.error('[TuneHub] 获取封面失败:', e)
        }
        return ''
    }

    async getLyrics(platform: MusicPlatform, id: string): Promise<string> {
        const cacheKey = `${platform}-${id}`

        // 1. 检查缓存
        const cached = this.parseCache.get(cacheKey)
        if (cached && cached.lyrics && Date.now() - cached.timestamp < this.CACHE_TTL) {
            console.log('[TuneHub] 使用缓存的歌词')
            return cached.lyrics
        }

        // 2. 检查是否有正在进行的请求
        const pending = this.pendingRequests.get(cacheKey)
        if (pending) {
            console.log('[TuneHub] 等待进行中的请求获取歌词:', cacheKey)
            const result = await pending
            return result?.lyrics || ''
        }

        // 3. 发起新请求
        const requestPromise = this.doParseRequest(platform, id, '128k')
        this.pendingRequests.set(cacheKey, requestPromise)

        try {
            const result = await requestPromise
            return result?.lyrics || ''
        } finally {
            this.pendingRequests.delete(cacheKey)
        }
    }

    // 解析歌词格式
    private parseLyrics(raw: string): string {
        // 如果已经是 LRC 格式，直接返回
        if (raw.includes('[') && raw.includes(']')) {
            // 过滤掉 JSON 格式的元数据行
            const lines = raw.split('\n').filter(line => {
                // 保留 [mm:ss.xx] 格式的歌词行
                if (/^\[\d{2}:\d{2}/.test(line)) return true
                // 过滤掉 {"t":xxx} 格式的元数据
                if (line.startsWith('{') && line.includes('"t"')) return false
                return true
            })
            return lines.join('\n').trim()
        }
        return raw
    }

    // 公开 executeMethod 供外部调用
    public executeMethodPublic(
        platform: MusicPlatform,
        method: string,
        variables: Record<string, string | number>
    ): Promise<any[]> {
        return this.executeMethod(platform, method, variables)
    }
}

// TuneHub 实例用于公共方法调用
const tuneHubInstance = new TuneHubProvider()

// 导出 TuneHub 方法执行器
export async function executeTuneHubMethod(
    platform: MusicPlatform,
    method: string,
    variables: Record<string, string | number> = {}
): Promise<any[]> {
    return tuneHubInstance.executeMethodPublic(platform, method, variables)
}

// ========== GD Studio Provider ==========

class GDStudioProvider implements ApiProvider {
    readonly name = 'GD Studio'
    readonly id: ApiProviderType = 'gdstudio'
    readonly supportedPlatforms: MusicPlatform[] = ['netease', 'kuwo', 'joox', 'kugou', 'migu', 'qq', 'tencent']

    private get baseUrl(): string {
        return import.meta.env.DEV ? '/gdapi' : 'https://music-api.gdstudio.xyz'
    }

    private mapQuality(quality: AudioQuality): string {
        switch (quality) {
            case '128k': return '128'
            case '320k': return '320'
            case 'flac': return '999'
            case 'flac24bit': return '999'
            default: return '320'
        }
    }

    async search(platform: MusicPlatform, keyword: string, limit = 20): Promise<SearchResult[]> {
        try {
            // GD Studio 使用 tencent 代替 qq
            const source = platform === 'qq' ? 'tencent' : platform
            const url = `${this.baseUrl}/api.php?types=search&source=${source}&name=${encodeURIComponent(keyword)}&count=${limit}&pages=1`
            const res = await nativeFetch(url)
            const data = await res.json()

            if (Array.isArray(data)) {
                return data.map((item: any) => ({
                    id: String(item.id),
                    name: item.name || '',
                    artist: Array.isArray(item.artist) ? item.artist.join(', ') : (item.artist || ''),
                    album: item.album || '',
                    url: '',
                    platform: platform,
                    pic_id: item.pic_id ? String(item.pic_id) : undefined,
                    lyric_id: item.lyric_id ? String(item.lyric_id) : undefined
                }))
            }
            return []
        } catch (e) {
            console.error(`[GDStudio][${platform}] 搜索失败:`, e)
            return []
        }
    }

    getMusicUrl(platform: MusicPlatform, id: string, quality: AudioQuality = '320k'): string {
        const source = platform === 'qq' ? 'tencent' : platform
        const br = this.mapQuality(quality)
        return `${this.baseUrl}/api.php?types=url&source=${source}&id=${id}&br=${br}`
    }

    // GD Studio API 返回 JSON { url: "...", br: "...", size: "..." }，需要提取真实URL
    async getActualMusicUrl(platform: MusicPlatform, id: string, quality: AudioQuality = '320k'): Promise<string> {
        try {
            const apiUrl = this.getMusicUrl(platform, id, quality)
            console.log('[GDStudio] 获取音频URL:', apiUrl)
            const res = await nativeFetch(apiUrl)
            const data = await res.json()
            console.log('[GDStudio] 音频URL响应:', data)

            if (data && typeof data.url === 'string' && data.url) {
                return data.url
            }
            // 降级：尝试更低音质
            if (quality !== '128k') {
                console.log('[GDStudio] 当前音质无资源，尝试降级')
                return this.getActualMusicUrl(platform, id, '128k')
            }
            throw new Error('无法获取音频URL')
        } catch (e) {
            console.error('[GDStudio] 获取音频URL失败:', e)
            throw e
        }
    }

    getCoverUrl(platform: MusicPlatform, id: string, picId?: string): string {
        const source = platform === 'qq' ? 'tencent' : platform
        // GD Studio 需要使用 pic_id 获取封面，pic_id 需要 URL 编码
        const actualId = picId || id
        return `${this.baseUrl}/api.php?types=pic&source=${source}&id=${encodeURIComponent(actualId)}&size=500`
    }

    // GD Studio 封面 API 返回 JSON { url: "真实封面URL" }，需要提取真实 URL
    async getActualCoverUrl(platform: MusicPlatform, id: string, picId?: string): Promise<string> {
        try {
            const apiUrl = this.getCoverUrl(platform, id, picId)
            console.log('[GDStudio] 获取封面:', apiUrl)
            const res = await nativeFetch(apiUrl)
            const data = await res.json()
            console.log('[GDStudio] 封面响应:', data)

            if (data && typeof data.url === 'string' && data.url) {
                return data.url
            }
            // 回退到默认封面
            return ''
        } catch (e) {
            console.error('[GDStudio] 获取封面URL失败:', e)
            return ''
        }
    }

    async getLyrics(platform: MusicPlatform, id: string, lyricId?: string): Promise<string> {
        try {
            const source = platform === 'qq' ? 'tencent' : platform
            const actualId = lyricId || id
            const url = `${this.baseUrl}/api.php?types=lyric&source=${source}&id=${actualId}`
            const res = await nativeFetch(url)
            const data = await res.json()

            // GD Studio 返回 { lyric: "...", tlyric: "..." }
            if (data && typeof data.lyric === 'string') {
                return data.lyric
            }
            return ''
        } catch (e) {
            console.error('获取歌词失败:', e)
            return ''
        }
    }
}

// ========== Provider 管理 ==========

const PROVIDER_KEY = 'api_provider'
const providers: Record<ApiProviderType, ApiProvider> = {
    sayqz: new TuneHubProvider(),
    gdstudio: new GDStudioProvider()
}

export function getActiveProviderId(): ApiProviderType {
    try {
        const saved = localStorage.getItem(PROVIDER_KEY)
        if (saved && (saved === 'sayqz' || saved === 'gdstudio')) {
            return saved as ApiProviderType
        }
    } catch { }
    return 'sayqz' // 默认使用 Sayqz
}

export function setActiveProvider(id: ApiProviderType): void {
    localStorage.setItem(PROVIDER_KEY, id)
}

export function getActiveProvider(): ApiProvider {
    return providers[getActiveProviderId()]
}

export function getAllProviders(): ApiProvider[] {
    return Object.values(providers)
}

// 导出 provider 实例供直接使用
export { providers }
