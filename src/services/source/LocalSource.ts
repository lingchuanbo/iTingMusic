import type { Track } from '@/types'

// Tauri 环境下使用 @tauri-apps/api/fs
// 这里提供 Web 端的 File API 实现

export async function scanLocalFiles(files: FileList): Promise<Track[]> {
  const tracks: Track[] = []
  const audioExts = ['.mp3', '.flac', '.wav', '.m4a', '.ogg']

  for (const file of Array.from(files)) {
    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
    if (!audioExts.includes(ext)) continue

    const url = URL.createObjectURL(file)
    let cover: string | undefined
    let title = file.name.replace(/\.[^.]+$/, '')
    let artist = '未知艺术家'

    // 尝试解析元数据 (需要 music-metadata-browser)
    try {
      const mm = await import('music-metadata-browser')
      const metadata = await mm.parseBlob(file)
      title = metadata.common.title || title
      artist = metadata.common.artist || artist

      if (metadata.common.picture?.[0]) {
        const pic = metadata.common.picture[0]
        const blob = new Blob([pic.data], { type: pic.format })
        cover = URL.createObjectURL(blob)
      }
    } catch {
      // 解析失败，使用默认值
    }

    tracks.push({
      id: `local-${file.name}-${Date.now()}`,
      title,
      artist,
      cover,
      url,
      source: 'local'
    })
  }
  return tracks
}
