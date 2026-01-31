/**
 * 音频缓存服务
 * 使用 IndexedDB 存储音频文件、封面、歌词，支持离线播放
 */
import { Capacitor } from '@capacitor/core'
import { CapacitorHttp } from '@capacitor/core'

const DB_NAME = 'zen_audio_cache'
const DB_VERSION = 2
const STORE_NAME = 'audio_files'
const META_STORE = 'cache_meta'
const COVER_STORE = 'covers'
const LYRICS_STORE = 'lyrics'

export interface CacheMeta {
  id: string
  size: number
  cachedAt: number
  lastAccess: number
  title: string
  artist: string
}

class AudioCacheService {
  private db: IDBDatabase | null = null
  private initPromise: Promise<void> | null = null

  // 最大缓存大小 (500MB)
  private maxCacheSize = 500 * 1024 * 1024

  async init(): Promise<void> {
    if (this.db) return
    if (this.initPromise) return this.initPromise

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = () => {
        console.error('IndexedDB 打开失败:', request.error)
        reject(request.error)
      }

      request.onsuccess = () => {
        this.db = request.result
        resolve()
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result

        // 音频文件存储
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        }

        // 缓存元数据
        if (!db.objectStoreNames.contains(META_STORE)) {
          const metaStore = db.createObjectStore(META_STORE, { keyPath: 'id' })
          metaStore.createIndex('lastAccess', 'lastAccess')
          metaStore.createIndex('cachedAt', 'cachedAt')
        }

        // 封面存储
        if (!db.objectStoreNames.contains(COVER_STORE)) {
          db.createObjectStore(COVER_STORE, { keyPath: 'id' })
        }

        // 歌词存储
        if (!db.objectStoreNames.contains(LYRICS_STORE)) {
          db.createObjectStore(LYRICS_STORE, { keyPath: 'id' })
        }
      }
    })

    return this.initPromise
  }


  /**
   * 检查是否已缓存
   */
  async has(id: string): Promise<boolean> {
    await this.init()
    return new Promise((resolve) => {
      const tx = this.db!.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const request = store.count(id)
      request.onsuccess = () => resolve(request.result > 0)
      request.onerror = () => resolve(false)
    })
  }

  /**
   * 获取缓存的音频 Blob URL
   */
  async get(id: string): Promise<string | null> {
    await this.init()
    return new Promise((resolve) => {
      const tx = this.db!.transaction([STORE_NAME, META_STORE], 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const metaStore = tx.objectStore(META_STORE)

      const request = store.get(id)
      request.onsuccess = () => {
        if (request.result) {
          // 更新最后访问时间
          const metaReq = metaStore.get(id)
          metaReq.onsuccess = () => {
            if (metaReq.result) {
              metaReq.result.lastAccess = Date.now()
              metaStore.put(metaReq.result)
            }
          }

          const blob = request.result.blob
          resolve(URL.createObjectURL(blob))
        } else {
          resolve(null)
        }
      }
      request.onerror = () => resolve(null)
    })
  }

  /**
   * 缓存音频文件
   */
  async cache(id: string, url: string, meta: { title: string; artist: string }): Promise<string | null> {
    try {
      await this.init()

      // 检查是否已缓存
      if (await this.has(id)) {
        return this.get(id)
      }

      // 下载音频 (使用 native fetch 以避开 CORS)
      let blob: Blob | null = null

      if (Capacitor.isNativePlatform()) {
        try {
          const response = await CapacitorHttp.get({
            url,
            responseType: 'blob'
          })
          // CapacitorHttp 在 responseType='blob' 时返回 data 为 base64 字符串 (如果是 blob，通常需要转换)
          // 或者直接返回 Blob 对象（取决于具体版本和插件实现）
          // 这里我们做一个安全的转换
          if (response.data instanceof Blob) {
            blob = response.data
          } else if (typeof response.data === 'string') {
            // 如果是 base64
            const base64Response = await fetch(`data:audio/mpeg;base64,${response.data}`)
            blob = await base64Response.blob()
          }
        } catch (nativeErr) {
          console.warn('Native HTTP download failed, falling back to fetch:', nativeErr)
        }
      }

      // 如果原生下载失败或不在原生环境，尝试普通 fetch
      if (!blob) {
        const response = await fetch(url)
        if (!response.ok) return null
        blob = await response.blob()
      }

      if (!blob) return null

      // 检查缓存空间，必要时清理

      // 检查缓存空间，必要时清理
      await this.ensureSpace(blob.size)

      // 存储音频
      await this.store(id, blob, meta)

      return URL.createObjectURL(blob)
    } catch (e) {
      console.error('缓存音频失败:', e)
      return null
    }
  }

  private async store(id: string, blob: Blob, meta: { title: string; artist: string }): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([STORE_NAME, META_STORE], 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const metaStore = tx.objectStore(META_STORE)

      store.put({ id, blob })
      metaStore.put({
        id,
        size: blob.size,
        cachedAt: Date.now(),
        lastAccess: Date.now(),
        title: meta.title,
        artist: meta.artist
      } as CacheMeta)

      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }


  /**
   * 确保有足够空间，LRU 策略清理
   */
  private async ensureSpace(needed: number): Promise<void> {
    const stats = await this.getStats()

    if (stats.totalSize + needed <= this.maxCacheSize) return

    // 按最后访问时间排序，删除最旧的
    const metas = await this.getAllMeta()
    metas.sort((a, b) => a.lastAccess - b.lastAccess)

    let freed = 0
    const toDelete: string[] = []

    for (const meta of metas) {
      if (stats.totalSize - freed + needed <= this.maxCacheSize) break
      toDelete.push(meta.id)
      freed += meta.size
    }

    for (const id of toDelete) {
      await this.delete(id)
    }
  }

  /**
   * 删除缓存
   */
  async delete(id: string): Promise<void> {
    await this.init()
    return new Promise((resolve) => {
      const tx = this.db!.transaction([STORE_NAME, META_STORE], 'readwrite')
      tx.objectStore(STORE_NAME).delete(id)
      tx.objectStore(META_STORE).delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  }

  /**
   * 清空所有缓存
   */
  async clear(): Promise<void> {
    await this.init()
    return new Promise((resolve) => {
      const tx = this.db!.transaction([STORE_NAME, META_STORE], 'readwrite')
      tx.objectStore(STORE_NAME).clear()
      tx.objectStore(META_STORE).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  }

  /**
   * 获取所有缓存元数据
   */
  private async getAllMeta(): Promise<CacheMeta[]> {
    return new Promise((resolve) => {
      const tx = this.db!.transaction(META_STORE, 'readonly')
      const store = tx.objectStore(META_STORE)
      const request = store.getAll()
      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => resolve([])
    })
  }

  /**
   * 获取缓存统计
   */
  async getStats(): Promise<{ count: number; totalSize: number }> {
    await this.init()
    const metas = await this.getAllMeta()
    return {
      count: metas.length,
      totalSize: metas.reduce((sum, m) => sum + m.size, 0)
    }
  }

  /**
   * 获取缓存列表（用于设置页面展示）
   */
  async getCacheList(): Promise<CacheMeta[]> {
    await this.init()
    const metas = await this.getAllMeta()
    return metas.sort((a, b) => b.lastAccess - a.lastAccess)
  }

  // ========== 封面缓存 ==========

  /**
   * 获取缓存的封面
   */
  async getCover(id: string): Promise<string | null> {
    await this.init()
    return new Promise((resolve) => {
      const tx = this.db!.transaction(COVER_STORE, 'readonly')
      const store = tx.objectStore(COVER_STORE)
      const request = store.get(id)
      request.onsuccess = () => {
        if (request.result?.blob) {
          resolve(URL.createObjectURL(request.result.blob))
        } else {
          resolve(null)
        }
      }
      request.onerror = () => resolve(null)
    })
  }

  /**
   * 缓存封面
   */
  async cacheCover(id: string, url: string): Promise<string | null> {
    try {
      await this.init()

      // 检查是否已缓存
      const cached = await this.getCover(id)
      if (cached) return cached

      const response = await fetch(url)
      if (!response.ok) return null

      const blob = await response.blob()

      return new Promise((resolve) => {
        const tx = this.db!.transaction(COVER_STORE, 'readwrite')
        const store = tx.objectStore(COVER_STORE)
        store.put({ id, blob })
        tx.oncomplete = () => resolve(URL.createObjectURL(blob))
        tx.onerror = () => resolve(null)
      })
    } catch (e) {
      console.warn('缓存封面失败:', e)
      return null
    }
  }

  // ========== 歌词缓存 ==========

  /**
   * 获取缓存的歌词
   */
  async getLyrics(id: string): Promise<string | null> {
    await this.init()
    return new Promise((resolve) => {
      const tx = this.db!.transaction(LYRICS_STORE, 'readonly')
      const store = tx.objectStore(LYRICS_STORE)
      const request = store.get(id)
      request.onsuccess = () => resolve(request.result?.lrc || null)
      request.onerror = () => resolve(null)
    })
  }

  /**
   * 缓存歌词
   */
  async cacheLyrics(id: string, lrc: string): Promise<void> {
    await this.init()
    return new Promise((resolve) => {
      const tx = this.db!.transaction(LYRICS_STORE, 'readwrite')
      const store = tx.objectStore(LYRICS_STORE)
      store.put({ id, lrc })
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  }

  /**
   * 清空所有缓存（包括封面和歌词）
   */
  async clearAll(): Promise<void> {
    await this.init()
    return new Promise((resolve) => {
      const tx = this.db!.transaction(
        [STORE_NAME, META_STORE, COVER_STORE, LYRICS_STORE],
        'readwrite'
      )
      tx.objectStore(STORE_NAME).clear()
      tx.objectStore(META_STORE).clear()
      tx.objectStore(COVER_STORE).clear()
      tx.objectStore(LYRICS_STORE).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  }
}

export const audioCache = new AudioCacheService()
