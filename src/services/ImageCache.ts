/**
 * 图片缓存服务
 * 使用 IndexedDB 存储图片数据，解决跨域问题和离线访问
 */

const DB_NAME = 'zen_image_cache'
const STORE_NAME = 'images'
const DB_VERSION = 1

class ImageCache {
    private db: IDBDatabase | null = null
    private initPromise: Promise<void> | null = null

    constructor() {
        this.init()
    }

    private init() {
        if (this.initPromise) return this.initPromise

        this.initPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION)

            request.onerror = () => {
                console.error('Failed to open image cache database')
                reject(request.error)
            }

            request.onsuccess = () => {
                this.db = request.result
                resolve()
            }

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME)
                }
            }
        })

        return this.initPromise
    }

    /**
     * 获取缓存的图片 URL
     * 如果缓存存在，返回 blob URL
     * 如果缓存不存在，下载并缓存，然后返回 blob URL
     */
    async getCachedUrl(url: string): Promise<string> {
        if (!url) return ''
        if (url.startsWith('blob:') || url.startsWith('data:')) return url

        await this.init()

        // 1. 尝试从缓存获取
        const cachedBlob = await this.getFromCache(url)
        if (cachedBlob) {
            return URL.createObjectURL(cachedBlob)
        }

        // 2. 检查是否在原生平台上
        const isNative = typeof (window as any).Capacitor?.isNativePlatform === 'function'
            && (window as any).Capacitor.isNativePlatform()

        // Web 平台：直接返回原 URL，让浏览器处理（不尝试预缓存以避免 CORS）
        if (!isNative) {
            return url
        }

        // 3. 原生平台：下载并缓存
        try {
            const { CapacitorHttp } = await import('@capacitor/core')
            const response = await CapacitorHttp.get({
                url: url,
                responseType: 'blob'
            })

            if (response.status >= 200 && response.status < 300 && response.data) {
                // CapacitorHttp 返回的是 base64，需要转换为 Blob
                const base64 = response.data
                const byteCharacters = atob(base64)
                const byteNumbers = new Array(byteCharacters.length)
                for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i)
                }
                const byteArray = new Uint8Array(byteNumbers)
                const blob = new Blob([byteArray], { type: response.headers?.['content-type'] || 'image/jpeg' })

                // 存入缓存
                await this.addToCache(url, blob)

                return URL.createObjectURL(blob)
            } else {
                throw new Error(`HTTP ${response.status}`)
            }
        } catch (e) {
            // 原生平台下载失败，返回原 URL
            return url
        }
    }

    private getFromCache(key: string): Promise<Blob | null> {
        return new Promise((resolve) => {
            if (!this.db) return resolve(null)

            const transaction = this.db.transaction([STORE_NAME], 'readonly')
            const store = transaction.objectStore(STORE_NAME)
            const request = store.get(key)

            request.onsuccess = () => resolve(request.result as Blob)
            request.onerror = () => resolve(null)
        })
    }

    private addToCache(key: string, blob: Blob): Promise<void> {
        return new Promise((resolve) => {
            if (!this.db) return resolve()

            const transaction = this.db.transaction([STORE_NAME], 'readwrite')
            const store = transaction.objectStore(STORE_NAME)
            const request = store.put(blob, key)

            request.onsuccess = () => resolve()
            request.onerror = () => resolve() // 即使失败也不阻塞
        })
    }
}

export const imageCache = new ImageCache()
