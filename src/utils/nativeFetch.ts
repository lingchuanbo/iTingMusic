import { Capacitor } from '@capacitor/core'
import { CapacitorHttp, type HttpResponse } from '@capacitor/core'

/**
 * 音乐 API 提供商
 */
export type MusicPlatform = 'netease' | 'kuwo' | 'kugou' | 'qq' | 'migu' | 'joox' | 'tencent'

/**
 * 通用 HTTP 请求选项
 */
export interface FetchOptions {
    method?: 'GET' | 'POST'
    headers?: Record<string, string>
    body?: unknown
    signal?: AbortSignal
}

/**
 * 适配移动端的统一 HTTP 请求工具
 * 在原生平台上使用 CapacitorHttp 绕过 CORS，在 Web 平台上使用原生 fetch
 */
export async function nativeFetch(url: string, options?: FetchOptions): Promise<Response> {
    const method = options?.method || 'GET'
    const headers = options?.headers || {}

    // Debug Log
    const isTargetUrl = url.includes('tunehub') ||
        url.includes('/api') ||
        url.includes('chat/completions') ||
        url.includes('qq.com') ||
        url.includes('163.com') ||
        url.includes('kuwo.cn')

    if (isTargetUrl) {
        console.log(`[nativeFetch] Request: ${method} ${url}`, {
            isDev: typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env.DEV : 'unknown',
            isNative: Capacitor.isNativePlatform(),
            headers
        })
    }

    const finalHeaders = { ...headers }

    // 移动端专用逻辑：为特定主域自动添加必要的头部以绕过反爬
    if (Capacitor.isNativePlatform()) {
        const urlStr = url.toLowerCase()
        if (urlStr.includes('qq.com')) {
            if (!finalHeaders['Referer']) finalHeaders['Referer'] = 'https://y.qq.com/'
            if (!finalHeaders['User-Agent']) finalHeaders['User-Agent'] = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1'
        } else if (urlStr.includes('163.com')) {
            if (!finalHeaders['Referer']) finalHeaders['Referer'] = 'https://music.163.com/'
            if (!finalHeaders['User-Agent']) finalHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        } else if (urlStr.includes('kuwo.cn')) {
            if (!finalHeaders['Referer']) finalHeaders['Referer'] = 'https://www.kuwo.cn/'
        }

        try {
            const requestOptions: any = {
                url,
                method,
                headers: finalHeaders,
                data: options?.body
            }

            // 如果是 POST 且有 body，确保 Content-Type
            if (options?.body && method.toUpperCase() === 'POST' && !finalHeaders['Content-Type']) {
                finalHeaders['Content-Type'] = 'application/json'
            }

            const response: HttpResponse = method.toUpperCase() === 'POST'
                ? await CapacitorHttp.post(requestOptions)
                : await CapacitorHttp.get(requestOptions)

            const responseData = typeof response.data === 'string' ? response.data : JSON.stringify(response.data)

            return new Response(responseData, {
                status: response.status,
                headers: {
                    'Content-Type': 'application/json',
                    ...response.headers
                }
            })
        } catch (e) {
            console.error('[nativeFetch] CapacitorHttp 请求失败:', e)
            throw e
        }
    }

    // Web 平台使用原生 fetch
    // 注意：浏览器 fetch 不允许手动设置某些受限头部（如 Referer, User-Agent）
    const cleanHeaders = { ...finalHeaders }
    const forbiddenHeaders = ['referer', 'user-agent', 'host', 'origin']
    Object.keys(cleanHeaders).forEach(key => {
        if (forbiddenHeaders.includes(key.toLowerCase())) {
            delete cleanHeaders[key]
        }
    })

    const fetchOptions: RequestInit = {
        method,
        headers: cleanHeaders,
        signal: options?.signal
    }

    if (options?.body) {
        fetchOptions.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body)
        if (method.toUpperCase() === 'POST' && !cleanHeaders['Content-Type']) {
            (cleanHeaders as Record<string, string>)['Content-Type'] = 'application/json'
        }
    }

    try {
        return await fetch(url, fetchOptions)
    } catch (e) {
        console.error('[nativeFetch] Browser fetch 失败:', e)
        throw e
    }
}
