/**
 * 歌曲下载服务
 * 支持下载音频文件到本地
 */
import { Capacitor } from '@capacitor/core'
import { audioCache } from '@/services/cache/AudioCache'
import { getActualMusicUrl, type MusicSource } from '@/services/source/OnlineApiSource'
import type { Track } from '@/types'

export interface DownloadTask {
  id: string
  track: Track
  progress: number // 0-100
  status: 'pending' | 'downloading' | 'completed' | 'failed'
  error?: string
}

// 下载设置
export interface DownloadSettings {
  folderName: string
  fileNameFormat: 'artist-title' | 'title-artist' | 'title'
  autoCache: boolean
}

const DOWNLOAD_SETTINGS_KEY = 'download_settings'

const defaultSettings: DownloadSettings = {
  folderName: '灵听音乐',
  fileNameFormat: 'artist-title',
  autoCache: true
}

type DownloadCallback = (task: DownloadTask) => void

class DownloadService {
  private tasks: Map<string, DownloadTask> = new Map()
  private listeners: Set<DownloadCallback> = new Set()
  private settings: DownloadSettings

  constructor() {
    this.settings = this.loadSettings()
  }

  private loadSettings(): DownloadSettings {
    try {
      const saved = localStorage.getItem(DOWNLOAD_SETTINGS_KEY)
      if (saved) {
        return { ...defaultSettings, ...JSON.parse(saved) }
      }
    } catch (e) {
      console.warn('加载下载设置失败:', e)
    }
    return { ...defaultSettings }
  }

  saveSettings(settings: Partial<DownloadSettings>) {
    this.settings = { ...this.settings, ...settings }
    localStorage.setItem(DOWNLOAD_SETTINGS_KEY, JSON.stringify(this.settings))
  }

  getSettings(): DownloadSettings {
    return { ...this.settings }
  }

  getDownloadPathDescription(): string {
    if (Capacitor.isNativePlatform()) {
      const platform = Capacitor.getPlatform()
      if (platform === 'android') {
        return `内部存储/Documents/${this.settings.folderName}/`
      } else if (platform === 'ios') {
        return `文件 App/${this.settings.folderName}/`
      }
    }
    return '浏览器下载目录'
  }

  addListener(callback: DownloadCallback) {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  private notifyListeners(task: DownloadTask) {
    this.listeners.forEach(cb => cb(task))
  }

  getTasks(): DownloadTask[] {
    return Array.from(this.tasks.values())
  }

  getTask(id: string): DownloadTask | undefined {
    return this.tasks.get(id)
  }

  async isDownloaded(id: string): Promise<boolean> {
    return audioCache.has(id)
  }


  /**
   * 下载歌曲
   */
  async download(track: Track): Promise<boolean> {
    if (this.tasks.has(track.id) && this.tasks.get(track.id)?.status === 'downloading') {
      return false
    }

    if (await audioCache.has(track.id)) {
      return this.saveToDevice(track)
    }

    const task: DownloadTask = {
      id: track.id,
      track,
      progress: 0,
      status: 'pending'
    }
    this.tasks.set(track.id, task)
    this.notifyListeners(task)

    try {
      task.status = 'downloading'
      this.notifyListeners(task)

      let audioUrl = track.url
      const onlineTrack = track as Track & { _platform?: MusicSource; _songId?: string }
      
      if (track.source === 'online' && onlineTrack._platform && onlineTrack._songId) {
        const actualUrl = await getActualMusicUrl(onlineTrack._platform, onlineTrack._songId)
        if (!actualUrl) {
          throw new Error('无法获取音频地址')
        }
        audioUrl = actualUrl
      }

      // 原生平台：通过 fetch 下载
      if (Capacitor.isNativePlatform()) {
        return await this.downloadWithFetch(audioUrl, track, task)
      }
      
      // Web 端：直接打开链接下载（避免 CORS 问题）
      const fileName = this.generateFileName(track)
      this.browserDownloadUrl(audioUrl, fileName)
      
      task.progress = 100
      task.status = 'completed'
      this.notifyListeners(task)
      return true
    } catch (e: any) {
      task.status = 'failed'
      task.error = e.message || '下载失败'
      this.notifyListeners(task)
      return false
    }
  }

  /**
   * 通过 fetch 下载（原生平台使用）
   */
  private async downloadWithFetch(audioUrl: string, track: Track, task: DownloadTask): Promise<boolean> {
    const response = await fetch(audioUrl)
    if (!response.ok) {
      throw new Error(`下载失败: ${response.status}`)
    }

    const contentLength = response.headers.get('content-length')
    const total = contentLength ? parseInt(contentLength, 10) : 0
    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('无法读取响应')
    }

    const chunks: Uint8Array[] = []
    let received = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      received += value.length
      if (total > 0) {
        task.progress = Math.round((received / total) * 100)
        this.notifyListeners(task)
      }
    }

    const blob = new Blob(chunks as BlobPart[], { type: 'audio/mpeg' })
    await this.cacheBlob(track.id, blob, track)

    if (track.cover) {
      audioCache.cacheCover(track.id, track.cover).catch(() => {})
    }

    task.progress = 100
    task.status = 'completed'
    this.notifyListeners(task)

    await this.saveToDevice(track, blob)
    return true
  }

  /**
   * 浏览器直接下载 URL（避免 CORS）
   */
  private browserDownloadUrl(url: string, fileName: string) {
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }


  /**
   * 缓存 Blob 到 IndexedDB
   */
  private async cacheBlob(id: string, blob: Blob, track: Track): Promise<void> {
    const DB_NAME = 'zen_audio_cache'
    const DB_VERSION = 2
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction(['audio_files', 'cache_meta'], 'readwrite')
        
        tx.objectStore('audio_files').put({ id, blob })
        tx.objectStore('cache_meta').put({
          id,
          size: blob.size,
          cachedAt: Date.now(),
          lastAccess: Date.now(),
          title: track.title,
          artist: track.artist
        })

        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      }
    })
  }

  /**
   * 保存到设备本地存储
   */
  private async saveToDevice(track: Track, blob?: Blob): Promise<boolean> {
    try {
      if (!blob) {
        const cachedUrl = await audioCache.get(track.id)
        if (!cachedUrl) return false
        const response = await fetch(cachedUrl)
        blob = await response.blob()
      }

      const fileName = this.generateFileName(track)

      if (Capacitor.isNativePlatform()) {
        try {
          const filesystemModule = '@capaci' + 'tor/filesystem'
          const { Filesystem, Directory } = await import(/* @vite-ignore */ filesystemModule)
          const base64 = await this.blobToBase64(blob)
          const folderPath = this.settings.folderName || '灵听音乐'
          
          await Filesystem.writeFile({
            path: `${folderPath}/${fileName}`,
            data: base64,
            directory: Directory.Documents,
            recursive: true
          })
          return true
        } catch (e) {
          console.warn('Filesystem 插件不可用，使用浏览器下载:', e)
          return this.browserDownload(blob, fileName)
        }
      } else {
        return this.browserDownload(blob, fileName)
      }
    } catch (e) {
      console.error('保存文件失败:', e)
      return false
    }
  }

  private generateFileName(track: Track): string {
    let baseName: string
    switch (this.settings.fileNameFormat) {
      case 'title-artist':
        baseName = `${track.title} - ${track.artist}`
        break
      case 'title':
        baseName = track.title
        break
      case 'artist-title':
      default:
        baseName = `${track.artist} - ${track.title}`
        break
    }
    return this.sanitizeFileName(`${baseName}.mp3`)
  }

  private browserDownload(blob: Blob, fileName: string): boolean {
    try {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      return true
    } catch (e) {
      console.error('浏览器下载失败:', e)
      return false
    }
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => {
        const base64 = reader.result as string
        resolve(base64.split(',')[1])
      }
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  }

  private sanitizeFileName(name: string): string {
    return name.replace(/[<>:"/\\|?*]/g, '_').trim()
  }

  clearCompleted() {
    for (const [id, task] of this.tasks) {
      if (task.status === 'completed' || task.status === 'failed') {
        this.tasks.delete(id)
      }
    }
  }
}

export const downloadService = new DownloadService()
