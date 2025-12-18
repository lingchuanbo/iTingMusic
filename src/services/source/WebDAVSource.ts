import { createClient, WebDAVClient, FileStat } from 'webdav'
import type { Track } from '@/types'

let client: WebDAVClient | null = null

export interface WebDAVConfig {
  url: string
  username: string
  password: string
}

export function connectWebDAV(config: WebDAVConfig) {
  client = createClient(config.url, {
    username: config.username,
    password: config.password
  })
}

export async function scanWebDAV(path: string = '/'): Promise<Track[]> {
  if (!client) throw new Error('WebDAV 未连接')

  const items = await client.getDirectoryContents(path) as FileStat[]
  const tracks: Track[] = []
  const audioExts = ['.mp3', '.flac', '.wav', '.m4a', '.ogg']

  for (const item of items) {
    if (item.type === 'file') {
      const ext = item.filename.slice(item.filename.lastIndexOf('.')).toLowerCase()
      if (audioExts.includes(ext)) {
        tracks.push({
          id: `webdav-${item.filename}`,
          title: item.basename.replace(/\.[^.]+$/, ''),
          artist: '未知艺术家',
          url: client.getFileDownloadLink(item.filename),
          source: 'webdav'
        })
      }
    }
  }
  return tracks
}

export function isConnected() {
  return client !== null
}
