import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Playlist } from '@/types'

const STORAGE_KEY = 'zen_playlists'

function loadPlaylists(): Playlist[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    return data ? JSON.parse(data) : []
  } catch {
    return []
  }
}

function savePlaylists(playlists: Playlist[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(playlists))
}

export const usePlaylistStore = defineStore('playlist', () => {
  const playlists = ref<Playlist[]>(loadPlaylists())

  // 创建歌单
  function createPlaylist(name: string): Playlist {
    const playlist: Playlist = {
      id: `pl-${Date.now()}`,
      name,
      trackIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    playlists.value.push(playlist)
    savePlaylists(playlists.value)
    return playlist
  }

  // 删除歌单
  function deletePlaylist(id: string) {
    const idx = playlists.value.findIndex(p => p.id === id)
    if (idx >= 0) {
      playlists.value.splice(idx, 1)
      savePlaylists(playlists.value)
    }
  }

  // 重命名歌单
  function renamePlaylist(id: string, name: string) {
    const playlist = playlists.value.find(p => p.id === id)
    if (playlist) {
      playlist.name = name
      playlist.updatedAt = Date.now()
      savePlaylists(playlists.value)
    }
  }

  // 添加歌曲到歌单
  function addToPlaylist(playlistId: string, trackId: string) {
    const playlist = playlists.value.find(p => p.id === playlistId)
    if (playlist && !playlist.trackIds.includes(trackId)) {
      playlist.trackIds.push(trackId)
      playlist.updatedAt = Date.now()
      savePlaylists(playlists.value)
    }
  }

  // 从歌单移除歌曲
  function removeFromPlaylist(playlistId: string, trackId: string) {
    const playlist = playlists.value.find(p => p.id === playlistId)
    if (playlist) {
      const idx = playlist.trackIds.indexOf(trackId)
      if (idx >= 0) {
        playlist.trackIds.splice(idx, 1)
        playlist.updatedAt = Date.now()
        savePlaylists(playlists.value)
      }
    }
  }

  // 设置歌单封面
  function setPlaylistCover(playlistId: string, cover: string) {
    const playlist = playlists.value.find(p => p.id === playlistId)
    if (playlist) {
      playlist.cover = cover
      playlist.updatedAt = Date.now()
      savePlaylists(playlists.value)
    }
  }

  // 获取歌单
  function getPlaylist(id: string) {
    return playlists.value.find(p => p.id === id)
  }

  // 检查歌曲是否在某个歌单中
  function isInPlaylist(playlistId: string, trackId: string) {
    const playlist = playlists.value.find(p => p.id === playlistId)
    return playlist?.trackIds.includes(trackId) ?? false
  }

  return {
    playlists,
    createPlaylist,
    deletePlaylist,
    renamePlaylist,
    addToPlaylist,
    removeFromPlaylist,
    setPlaylistCover,
    getPlaylist,
    isInPlaylist
  }
})
