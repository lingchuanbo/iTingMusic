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

        // 2. 缓存未命中，下载图片
        try {
            const response = await fetch(url)
            const blob = await response.blob()

            // 3. 存入缓存
            await this.addToCache(url, blob)

            return URL.createObjectURL(blob)
        } catch (e) {
            console.warn('Failed to cache image:', url, e)
            return url // 降级：直接返回原 URL
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
