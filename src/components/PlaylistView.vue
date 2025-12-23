<script setup lang="ts">
import { ref, computed } from 'vue'
import { usePlayerStore } from '@/store/player'
import { usePlaylistStore } from '@/store/playlist'
import { formatTime } from '@/utils/formatTime'
import { trackStorage } from '@/services/TrackStorage'
import type { Playlist } from '@/types'

const playerStore = usePlayerStore()
const playlistStore = usePlaylistStore()

const selectedPlaylist = ref<Playlist | null>(null)
const showCreateModal = ref(false)
const newPlaylistName = ref('')
const editingId = ref<string | null>(null)
const editingName = ref('')

// 视图模式: 'grid' 网格视图, 'list' 多行列表视图
const viewMode = ref<'grid' | 'list'>('grid')

// 封面显示模式: 'grid' 网格拼接, 'single' 单图
const coverMode = ref<'grid' | 'single'>(
  localStorage.getItem('playlist_cover_mode') as 'grid' | 'single' || 'grid'
)

// 封面选择弹窗
const showCoverPicker = ref(false)
const coverPickerPlaylistId = ref<string | null>(null)

// 歌单详情视图模式: 'list' 列表, 'album' 专辑展示
// 移动端默认使用专辑视图（列表视图在移动端隐藏）
const isMobile = typeof window !== 'undefined' && window.innerWidth < 768
const detailViewMode = ref<'list' | 'album'>(isMobile ? 'album' : 'list')

// 当前在歌单中播放的歌曲索引（保留以备将来使用）
const _currentPlaylistIndex = computed(() => {
  if (!playerStore.currentTrack) return 0
  const idx = playlistTracks.value.findIndex(t => t?.id === playerStore.currentTrack?.id)
  return idx >= 0 ? idx : 0
})
void _currentPlaylistIndex

// 播放菜单显示状态
const showPlayMenu = ref(false)

// 获取歌单中的歌曲
const playlistTracks = computed(() => {
  if (!selectedPlaylist.value) return []
  return selectedPlaylist.value.trackIds
    .map(id => {
      // 优先从 trackStorage 获取（独立存储）
      const stored = trackStorage.getTrack(id)
      if (stored) return stored
      // 兼容：从播放列表获取
      return playerStore.playlist.find(t => t.id === id)
    })
    .filter(Boolean)
})

// 获取歌单封面图片列表（最多4张用于拼接显示）
function getPlaylistCovers(playlist: Playlist): string[] {
  if (playlist.cover) return [playlist.cover]
  
  const covers: string[] = []
  const seenCovers = new Set<string>() // 去重
  
  for (const trackId of playlist.trackIds) {
    if (covers.length >= 4) break
    
    // 优先从 trackStorage 获取
    const stored = trackStorage.getTrack(trackId)
    let cover = stored?.cover
    
    // 兼容：从播放列表获取
    if (!cover) {
      const track = playerStore.playlist.find(t => t.id === trackId)
      cover = track?.cover
    }
    
    if (cover && !seenCovers.has(cover)) {
      seenCovers.add(cover)
      covers.push(cover)
    }
  }
  
  return covers
}

// 获取歌单封面（使用第一首歌的封面，兼容旧逻辑）
function getPlaylistCover(playlist: Playlist): string | undefined {
  const covers = getPlaylistCovers(playlist)
  return covers[0]
}

// 切换封面显示模式
function toggleCoverMode() {
  coverMode.value = coverMode.value === 'grid' ? 'single' : 'grid'
  localStorage.setItem('playlist_cover_mode', coverMode.value)
}

// 打开封面选择弹窗
function openCoverPicker(playlistId: string) {
  coverPickerPlaylistId.value = playlistId
  showCoverPicker.value = true
}

// 设置歌单封面
function setCover(cover: string) {
  if (coverPickerPlaylistId.value) {
    playlistStore.setPlaylistCover(coverPickerPlaylistId.value, cover)
  }
  showCoverPicker.value = false
  coverPickerPlaylistId.value = null
}

// 清除自定义封面
function clearCover(playlistId: string) {
  playlistStore.setPlaylistCover(playlistId, '')
}

// 获取封面选择弹窗的歌曲列表
const coverPickerTracks = computed(() => {
  if (!coverPickerPlaylistId.value) return []
  const playlist = playlistStore.playlists.find(p => p.id === coverPickerPlaylistId.value)
  if (!playlist) return []
  return playlist.trackIds
    .map(id => {
      const stored = trackStorage.getTrack(id)
      if (stored) return stored
      return playerStore.playlist.find(t => t.id === id)
    })
    .filter(t => t?.cover)
})

function createPlaylist() {
  if (!newPlaylistName.value.trim()) return
  playlistStore.createPlaylist(newPlaylistName.value.trim())
  newPlaylistName.value = ''
  showCreateModal.value = false
}

function startEdit(playlist: Playlist) {
  editingId.value = playlist.id
  editingName.value = playlist.name
}

function saveEdit() {
  if (editingId.value && editingName.value.trim()) {
    playlistStore.renamePlaylist(editingId.value, editingName.value.trim())
  }
  editingId.value = null
}

function deletePlaylist(id: string) {
  if (confirm('确定删除这个歌单？')) {
    playlistStore.deletePlaylist(id)
    if (selectedPlaylist.value?.id === id) {
      selectedPlaylist.value = null
    }
  }
}

function selectPlaylist(playlist: Playlist) {
  selectedPlaylist.value = playlist
}

function backToList() {
  selectedPlaylist.value = null
}

function playTrack(trackId: string) {
  // 先检查播放列表中是否存在
  let idx = playerStore.playlist.findIndex(t => t.id === trackId)
  if (idx < 0) {
    // 不在播放列表中，从 trackStorage 获取并添加
    const track = trackStorage.getTrack(trackId)
    if (track) {
      playerStore.addTrack(track)
      idx = playerStore.playlist.length - 1
    }
  }
  if (idx >= 0) {
    playerStore.playTrack(idx)
  }
}

function removeFromPlaylist(trackId: string) {
  if (selectedPlaylist.value) {
    playlistStore.removeFromPlaylist(selectedPlaylist.value.id, trackId)
  }
}

// 多选模式
const isSelectMode = ref(false)
const selectedTrackIds = ref<Set<string>>(new Set())
let longPressTimer: number | null = null

// 长按开始
function handleLongPressStart(trackId: string) {
  longPressTimer = window.setTimeout(() => {
    isSelectMode.value = true
    selectedTrackIds.value.add(trackId)
  }, 500)
}

// 长按结束
function handleLongPressEnd() {
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
}

// 点击处理
function handleTrackClick(trackId: string) {
  if (isSelectMode.value) {
    toggleTrackSelect(trackId)
  } else {
    playTrack(trackId)
  }
}

// 切换选中
function toggleTrackSelect(trackId: string) {
  if (selectedTrackIds.value.has(trackId)) {
    selectedTrackIds.value.delete(trackId)
  } else {
    selectedTrackIds.value.add(trackId)
  }
  if (selectedTrackIds.value.size === 0) {
    isSelectMode.value = false
  }
}

// 全选/取消全选
function toggleSelectAll() {
  if (selectedTrackIds.value.size === playlistTracks.value.length) {
    selectedTrackIds.value.clear()
  } else {
    playlistTracks.value.forEach(t => {
      if (t) selectedTrackIds.value.add(t.id)
    })
  }
}

// 退出多选模式
function exitSelectMode() {
  isSelectMode.value = false
  selectedTrackIds.value.clear()
}

// 批量从歌单移除
function batchRemoveFromPlaylist() {
  if (!selectedPlaylist.value || selectedTrackIds.value.size === 0) return
  selectedTrackIds.value.forEach(trackId => {
    playlistStore.removeFromPlaylist(selectedPlaylist.value!.id, trackId)
  })
  exitSelectMode()
}

// 批量添加到播放列表
function batchAddToPlayerList() {
  selectedTrackIds.value.forEach(trackId => {
    const track = trackStorage.getTrack(trackId) || playerStore.playlist.find(t => t.id === trackId)
    if (track && !playerStore.playlist.some(t => t.id === trackId)) {
      playerStore.addTrack(track)
    }
  })
  exitSelectMode()
}

// 批量播放
function batchPlaySelected() {
  const trackIds = Array.from(selectedTrackIds.value)
  if (trackIds.length === 0) return
  trackIds.forEach((trackId, idx) => {
    const track = trackStorage.getTrack(trackId) || playerStore.playlist.find(t => t.id === trackId)
    if (track && !playerStore.playlist.some(t => t.id === trackId)) {
      playerStore.addTrack(track)
    }
    if (idx === 0) {
      const playIdx = playerStore.playlist.findIndex(t => t.id === trackId)
      if (playIdx >= 0) playerStore.playTrack(playIdx)
    }
  })
  exitSelectMode()
}

const selectedCount = computed(() => selectedTrackIds.value.size)

// 播放全部 - 替换播放列表
function playAllReplace() {
  if (playlistTracks.value.length === 0) return
  
  // 清空当前播放列表
  playerStore.clearPlaylist()
  
  // 添加歌单中的所有歌曲
  playlistTracks.value.forEach(track => {
    if (track) {
      playerStore.addTrack(track)
    }
  })
  
  // 播放第一首
  if (playerStore.playlist.length > 0) {
    playerStore.playTrack(0)
  }
  
  showPlayMenu.value = false
}

// 播放全部 - 加入当前播放列表
function playAllAdd() {
  if (playlistTracks.value.length === 0) return
  
  let firstNewIdx = -1
  
  // 添加歌单中的所有歌曲（跳过已存在的）
  playlistTracks.value.forEach((track, idx) => {
    if (track) {
      const existIdx = playerStore.playlist.findIndex(t => t.id === track.id)
      if (existIdx < 0) {
        playerStore.addTrack(track)
        if (firstNewIdx < 0) {
          firstNewIdx = playerStore.playlist.length - 1
        }
      } else if (idx === 0 && firstNewIdx < 0) {
        firstNewIdx = existIdx
      }
    }
  })
  
  // 播放第一首（新添加的或已存在的第一首）
  if (firstNewIdx >= 0) {
    playerStore.playTrack(firstNewIdx)
  } else if (playlistTracks.value[0]) {
    const idx = playerStore.playlist.findIndex(t => t.id === playlistTracks.value[0]!.id)
    if (idx >= 0) playerStore.playTrack(idx)
  }
  
  showPlayMenu.value = false
}

// 解析歌词
interface LyricLine {
  time: number
  text: string
}

function parseLyrics(lrc: string): LyricLine[] {
  if (!lrc) return []
  const lines: LyricLine[] = []
  const regex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\](.*)/g
  let match
  while ((match = regex.exec(lrc)) !== null) {
    const minutes = parseInt(match[1])
    const seconds = parseInt(match[2])
    const ms = match[3] ? parseInt(match[3].padEnd(3, '0')) : 0
    const time = minutes * 60 + seconds + ms / 1000
    const text = match[4].trim()
    lines.push({ time, text })
  }
  return lines.sort((a, b) => a.time - b.time)
}

// 判断是否是当前歌词行（保留以备将来使用）
function _isCurrentLyricLine(lineTime: number): boolean {
  const currentTime = playerStore.currentTime
  const lrc = playerStore.currentTrack?.lrc
  if (!lrc) return false
  
  const lines = parseLyrics(lrc)
  const currentLineIndex = lines.findIndex((line, idx) => {
    const nextLine = lines[idx + 1]
    return currentTime >= line.time && (!nextLine || currentTime < nextLine.time)
  })
  
  if (currentLineIndex === -1) return false
  return lines[currentLineIndex].time === lineTime
}
void _isCurrentLyricLine
</script>

<template>
  <div class="flex-1 p-6 pb-24 md:pb-28 flex flex-col h-full overflow-hidden">
    <!-- 歌单列表 -->
    <template v-if="!selectedPlaylist">
      <!-- 标题栏 -->
      <div class="flex items-center justify-between mb-6 flex-shrink-0">
        <h2 class="text-2xl font-bold text-white">🎵 我的歌单</h2>
        <div class="flex items-center gap-1.5 md:gap-2">
          <!-- 封面模式切换 -->
          <button
            @click="toggleCoverMode"
            :class="['w-7 h-7 md:w-8 md:h-8 rounded-lg flex items-center justify-center transition-colors', 'bg-white/10 hover:bg-white/20 text-white/60']"
            :title="coverMode === 'grid' ? '切换为单图封面' : '切换为网格封面'"
          >
            <svg v-if="coverMode === 'grid'" class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z"/></svg>
            <svg v-else class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M4 4h16v16H4V4z"/></svg>
          </button>
          <!-- 视图切换 -->
          <div class="flex rounded-lg bg-white/10 p-0.5">
            <button
              @click="viewMode = 'grid'"
              :class="['w-7 h-7 md:w-8 md:h-8 rounded-md flex items-center justify-center transition-colors', viewMode === 'grid' ? 'bg-purple-600 text-white' : 'text-white/60']"
            >
              <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z"/></svg>
            </button>
            <button
              @click="viewMode = 'list'"
              :class="['w-7 h-7 md:w-8 md:h-8 rounded-md flex items-center justify-center transition-colors', viewMode === 'list' ? 'bg-purple-600 text-white' : 'text-white/60']"
            >
              <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M3 4h18v2H3V4zm0 7h18v2H3v-2zm0 7h18v2H3v-2z"/></svg>
            </button>
          </div>
          <!-- 新建按钮 -->
          <button
            @click="showCreateModal = true"
            class="w-7 h-7 md:w-auto md:h-auto md:px-3 md:py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm flex items-center justify-center gap-1 transition-colors"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
            <span class="hidden md:inline">新建</span>
          </button>
        </div>
      </div>

      <div v-if="playlistStore.playlists.length === 0" class="text-center py-16 md:py-20">
        <svg class="w-12 h-12 md:w-16 md:h-16 mx-auto text-white/20 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
        </svg>
        <p class="text-white/50 text-sm">还没有歌单</p>
        <button
          @click="showCreateModal = true"
          class="mt-3 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm"
        >
          创建第一个歌单
        </button>
      </div>

      <!-- 网格视图 -->
      <div v-else-if="viewMode === 'grid'" class="flex-1 overflow-y-auto">
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-4">
          <div
            v-for="playlist in playlistStore.playlists"
            :key="playlist.id"
            @click="selectPlaylist(playlist)"
            class="group cursor-pointer"
          >
            <div class="relative aspect-square w-full rounded-xl overflow-hidden bg-white/10 mb-2">
              <!-- 单图模式或有自定义封面 -->
              <template v-if="coverMode === 'single' || playlist.cover">
                <img
                  v-if="getPlaylistCover(playlist)"
                  :src="getPlaylistCover(playlist)"
                  class="w-full h-full object-cover"
                />
                <div v-else class="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-600/50 to-pink-600/50">
                  <svg class="w-10 h-10 md:w-12 md:h-12 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                  </svg>
                </div>
              </template>
              <!-- 网格模式 -->
              <template v-else>
                <!-- 4宫格封面拼接 -->
                <div v-if="getPlaylistCovers(playlist).length >= 4" class="w-full h-full grid grid-cols-2 grid-rows-2">
                  <img
                    v-for="(cover, idx) in getPlaylistCovers(playlist).slice(0, 4)"
                    :key="idx"
                    :src="cover"
                    class="w-full h-full object-cover"
                  />
                </div>
                <!-- 2张封面：上下排列 -->
                <div v-else-if="getPlaylistCovers(playlist).length === 2" class="w-full h-full grid grid-cols-2">
                  <img
                    v-for="(cover, idx) in getPlaylistCovers(playlist)"
                    :key="idx"
                    :src="cover"
                    class="w-full h-full object-cover"
                  />
                </div>
                <!-- 3张封面：1大2小 -->
                <div v-else-if="getPlaylistCovers(playlist).length === 3" class="w-full h-full grid grid-cols-2 grid-rows-2">
                  <img
                    :src="getPlaylistCovers(playlist)[0]"
                    class="w-full h-full object-cover row-span-2"
                  />
                  <img
                    :src="getPlaylistCovers(playlist)[1]"
                    class="w-full h-full object-cover"
                  />
                  <img
                    :src="getPlaylistCovers(playlist)[2]"
                    class="w-full h-full object-cover"
                  />
                </div>
                <!-- 单张封面 -->
                <img
                  v-else-if="getPlaylistCovers(playlist).length === 1"
                  :src="getPlaylistCovers(playlist)[0]"
                  class="w-full h-full object-cover"
                />
                <!-- 无封面 -->
                <div v-else class="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-600/50 to-pink-600/50">
                  <svg class="w-10 h-10 md:w-12 md:h-12 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                  </svg>
                </div>
              </template>
              <!-- 悬浮操作 -->
              <div class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                <button
                  @click.stop="openCoverPicker(playlist.id)"
                  class="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 text-white"
                  title="设置封面"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                </button>
                <button
                  @click.stop="startEdit(playlist)"
                  class="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 text-white"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
                </button>
                <button
                  @click.stop="deletePlaylist(playlist.id)"
                  class="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-red-500/50 text-white"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                </button>
              </div>
              <!-- 歌曲数量 -->
              <div class="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px] md:text-xs">
                {{ playlist.trackIds.length }} 首
              </div>
            </div>
            <!-- 歌单名 -->
            <div v-if="editingId === playlist.id" class="px-1">
              <input
                v-model="editingName"
                @keyup.enter="saveEdit"
                @blur="saveEdit"
                class="w-full px-2 py-1 rounded bg-white/10 text-white text-xs md:text-sm outline-none text-center"
                autofocus
              />
            </div>
            <p v-else class="text-white text-xs md:text-sm font-medium truncate text-center px-1">{{ playlist.name }}</p>
          </div>
        </div>
      </div>

      <!-- 多行列表视图 -->
      <div v-else class="flex-1 overflow-y-auto space-y-1.5 md:space-y-2">
        <div
          v-for="playlist in playlistStore.playlists"
          :key="playlist.id"
          @click="selectPlaylist(playlist)"
          class="group flex items-center gap-3 p-2.5 md:p-3 rounded-xl cursor-pointer hover:bg-white/10 active:bg-white/15 transition-colors"
        >
          <div class="relative w-12 h-12 md:w-14 md:h-14 rounded-lg overflow-hidden bg-white/10 flex-shrink-0">
            <!-- 单图模式或有自定义封面 -->
            <template v-if="coverMode === 'single' || playlist.cover">
              <img
                v-if="getPlaylistCover(playlist)"
                :src="getPlaylistCover(playlist)"
                class="w-full h-full object-cover"
              />
              <div v-else class="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-600/50 to-pink-600/50">
                <svg class="w-6 h-6 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
              </div>
            </template>
            <!-- 网格模式 -->
            <template v-else>
              <!-- 4宫格封面拼接 -->
              <div v-if="getPlaylistCovers(playlist).length >= 4" class="w-full h-full grid grid-cols-2 grid-rows-2">
                <img
                  v-for="(cover, idx) in getPlaylistCovers(playlist).slice(0, 4)"
                  :key="idx"
                  :src="cover"
                  class="w-full h-full object-cover"
                />
              </div>
              <!-- 2张封面 -->
              <div v-else-if="getPlaylistCovers(playlist).length === 2" class="w-full h-full grid grid-cols-2">
                <img
                  v-for="(cover, idx) in getPlaylistCovers(playlist)"
                  :key="idx"
                  :src="cover"
                  class="w-full h-full object-cover"
                />
              </div>
              <!-- 3张封面：1大2小 -->
              <div v-else-if="getPlaylistCovers(playlist).length === 3" class="w-full h-full grid grid-cols-2 grid-rows-2">
                <img
                  :src="getPlaylistCovers(playlist)[0]"
                  class="w-full h-full object-cover row-span-2"
                />
                <img
                  :src="getPlaylistCovers(playlist)[1]"
                  class="w-full h-full object-cover"
                />
                <img
                  :src="getPlaylistCovers(playlist)[2]"
                  class="w-full h-full object-cover"
                />
              </div>
              <!-- 单张封面 -->
              <img
                v-else-if="getPlaylistCovers(playlist).length === 1"
                :src="getPlaylistCovers(playlist)[0]"
                class="w-full h-full object-cover"
              />
              <!-- 无封面 -->
              <div v-else class="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-600/50 to-pink-600/50">
                <svg class="w-6 h-6 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
              </div>
            </template>
          </div>
          <div class="flex-1 min-w-0">
            <div v-if="editingId === playlist.id" class="flex gap-1">
              <input
                v-model="editingName"
                @keyup.enter="saveEdit"
                @blur="saveEdit"
                @click.stop
                class="flex-1 px-2 py-1 rounded bg-white/10 text-white text-sm outline-none"
                autofocus
              />
            </div>
            <p v-else class="text-white text-sm md:text-base font-medium truncate">{{ playlist.name }}</p>
            <p class="text-white/50 text-xs md:text-sm">{{ playlist.trackIds.length }} 首歌曲</p>
          </div>
          <div class="flex items-center gap-1.5 md:gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              @click.stop="openCoverPicker(playlist.id)"
              class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20"
              title="设置封面"
            >
              <svg class="w-4 h-4 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
            </button>
            <button
              @click.stop="startEdit(playlist)"
              class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20"
              title="编辑"
            >
              <svg class="w-4 h-4 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
            </button>
            <button
              @click.stop="deletePlaylist(playlist.id)"
              class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-red-500/50"
              title="删除"
            >
              <svg class="w-4 h-4 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- 歌单详情 -->
    <template v-else>
      <div class="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 mb-4 md:mb-6 flex-shrink-0">
        <!-- 第一行：返回 + 标题 + 播放按钮 -->
        <div class="flex items-center gap-3">
          <button
            @click="backToList"
            class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 flex-shrink-0"
          >
            ←
          </button>
          <div class="flex-1 min-w-0">
            <h2 class="text-lg md:text-2xl font-bold text-white truncate">{{ selectedPlaylist.name }}</h2>
            <p class="text-white/50 text-xs md:text-sm">{{ selectedPlaylist.trackIds.length }} 首歌曲</p>
          </div>
          <!-- 播放按钮 -->
          <button
            v-if="playlistTracks.length > 0"
            @click="showPlayMenu = true"
            class="px-3 md:px-4 py-1.5 md:py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs md:text-sm flex-shrink-0 flex items-center gap-1"
          >
            ▶ 播放
          </button>
        </div>
        <!-- 第二行：视图切换（移动端更紧凑） -->
        <div class="flex rounded-lg bg-white/10 p-0.5 md:p-1 self-start md:self-auto">
          <!-- 列表视图按钮 - 移动端隐藏 -->
          <button
            @click="detailViewMode = 'list'"
            :class="['hidden md:flex px-2 md:px-3 py-1 md:py-1.5 rounded-md text-xs md:text-sm transition-colors items-center justify-center', detailViewMode === 'list' ? 'bg-purple-600 text-white' : 'text-white/60 hover:text-white']"
            title="列表视图"
          >
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M3 4h18v2H3V4zm0 7h18v2H3v-2zm0 7h18v2H3v-2z"/></svg>
          </button>
          <button
            @click="detailViewMode = 'album'"
            :class="['px-2 md:px-3 py-1 md:py-1.5 rounded-md text-xs md:text-sm transition-colors', detailViewMode === 'album' ? 'bg-purple-600 text-white' : 'text-white/60 hover:text-white']"
            title="专辑视图"
          >
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z"/></svg>
          </button>
        </div>
      </div>

      <div v-if="playlistTracks.length === 0" class="text-center py-20">
        <p class="text-white/50">歌单是空的</p>
        <p class="text-white/30 text-sm mt-2">在播放列表中将歌曲添加到此歌单</p>
      </div>

      <!-- 多选操作栏 -->
      <div v-if="isSelectMode && detailViewMode === 'list'" class="flex items-center justify-between mb-4 p-3 rounded-xl bg-purple-600/20 border border-purple-500/30">
        <div class="flex items-center gap-2 flex-shrink-0">
          <button @click="exitSelectMode" class="text-white/60 hover:text-white">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
          <span class="text-white text-sm whitespace-nowrap">已选 {{ selectedCount }}</span>
        </div>
        <div class="flex items-center gap-1.5 md:gap-2 flex-shrink-0">
          <button @click="toggleSelectAll" class="px-2 md:px-3 py-1.5 rounded-lg bg-white/10 text-white text-xs md:text-sm hover:bg-white/20 whitespace-nowrap">
            {{ selectedTrackIds.size === playlistTracks.length ? '取消全选' : '全选' }}
          </button>
          <button @click="batchPlaySelected" :disabled="selectedCount === 0" class="px-2 md:px-3 py-1.5 rounded-lg bg-purple-600 text-white text-xs md:text-sm hover:bg-purple-500 disabled:opacity-50 whitespace-nowrap">
            播放
          </button>
          <button @click="batchAddToPlayerList" :disabled="selectedCount === 0" class="hidden md:block px-2 md:px-3 py-1.5 rounded-lg bg-white/10 text-white text-xs md:text-sm hover:bg-white/20 disabled:opacity-50 whitespace-nowrap">
            加入列表
          </button>
          <button @click="batchRemoveFromPlaylist" :disabled="selectedCount === 0" class="px-2 md:px-3 py-1.5 rounded-lg bg-red-600/80 text-white text-xs md:text-sm hover:bg-red-500 disabled:opacity-50 whitespace-nowrap">
            移除
          </button>
        </div>
      </div>

      <!-- 列表视图 -->
      <div v-else-if="detailViewMode === 'list'" class="flex-1 overflow-y-auto space-y-2">
        <div class="text-white/40 text-sm mb-2 text-right">长按多选</div>
        <div
          v-for="(track, index) in playlistTracks"
          :key="track!.id"
          @click="handleTrackClick(track!.id)"
          @mousedown="handleLongPressStart(track!.id)"
          @mouseup="handleLongPressEnd"
          @mouseleave="handleLongPressEnd"
          @touchstart.passive="handleLongPressStart(track!.id)"
          @touchend="handleLongPressEnd"
          @touchcancel="handleLongPressEnd"
          :class="[
            'group flex items-center gap-4 p-3 rounded-xl cursor-pointer transition-colors',
            selectedTrackIds.has(track!.id) ? 'bg-purple-600/30' : playerStore.currentTrack?.id === track!.id ? 'bg-purple-600/30' : 'hover:bg-white/10'
          ]"
        >
          <!-- 多选框 -->
          <div v-if="isSelectMode" class="w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0"
            :class="selectedTrackIds.has(track!.id) ? 'bg-purple-600 border-purple-600' : 'border-white/30'">
            <svg v-if="selectedTrackIds.has(track!.id)" class="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
            </svg>
          </div>
          <span v-else class="w-6 text-white/30 text-sm text-right">{{ index + 1 }}</span>
          <div class="w-10 h-10 rounded-lg overflow-hidden bg-white/10 flex-shrink-0">
            <img v-if="track!.cover" :src="track!.cover" class="w-full h-full object-cover" />
            <div v-else class="w-full h-full flex items-center justify-center">🎵</div>
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-white text-sm truncate">{{ track!.title }}</p>
            <p class="text-white/50 text-xs truncate">{{ track!.artist }}</p>
          </div>
          <button
            v-if="!isSelectMode"
            @click.stop="removeFromPlaylist(track!.id)"
            class="opacity-0 group-hover:opacity-100 text-white/40 hover:text-red-400 transition-all"
            title="从歌单移除"
          >
            ✕
          </button>
          <span class="text-white/30 text-xs">{{ track!.duration ? formatTime(track!.duration) : '--:--' }}</span>
        </div>
      </div>

      <!-- 专辑视图 -->
      <div v-else-if="detailViewMode === 'album'" class="flex-1 overflow-y-auto">
        <div class="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 md:gap-4">
          <div
            v-for="(track, index) in playlistTracks"
            :key="track!.id"
            @click="playTrack(track!.id)"
            :class="[
              'group cursor-pointer rounded-lg md:rounded-xl p-1.5 md:p-3 transition-colors',
              playerStore.currentTrack?.id === track!.id ? 'bg-purple-600/30' : 'hover:bg-white/10'
            ]"
          >
            <div class="relative aspect-square rounded-md md:rounded-lg overflow-hidden bg-white/10 mb-1.5 md:mb-3">
              <img
                v-if="track!.cover"
                :src="track!.cover"
                class="w-full h-full object-cover"
              />
              <div v-else class="w-full h-full flex items-center justify-center text-2xl md:text-4xl bg-gradient-to-br from-purple-600/50 to-pink-600/50">
                🎵
              </div>
              <!-- 播放状态指示 -->
              <div v-if="playerStore.currentTrack?.id === track!.id" class="absolute inset-0 bg-black/40 flex items-center justify-center">
                <div class="w-8 h-8 md:w-12 md:h-12 rounded-full bg-purple-600 flex items-center justify-center">
                  <span v-if="playerStore.isPlaying" class="text-white text-sm md:text-lg">▶</span>
                  <span v-else class="text-white text-sm md:text-lg">⏸</span>
                </div>
              </div>
              <!-- 悬浮播放按钮 -->
              <div v-else class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <div class="w-8 h-8 md:w-12 md:h-12 rounded-full bg-purple-600 flex items-center justify-center">
                  <span class="text-white text-sm md:text-lg">▶</span>
                </div>
              </div>
              <!-- 序号 -->
              <div class="absolute top-1 left-1 md:top-2 md:left-2 w-5 h-5 md:w-6 md:h-6 rounded-full bg-black/60 flex items-center justify-center text-white text-[10px] md:text-xs">
                {{ index + 1 }}
              </div>
              <!-- 删除按钮 -->
              <button
                @click.stop="removeFromPlaylist(track!.id)"
                class="absolute top-1 right-1 md:top-2 md:right-2 w-5 h-5 md:w-6 md:h-6 rounded-full bg-black/60 flex items-center justify-center text-white/60 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                title="从歌单移除"
              >
                ✕
              </button>
            </div>
            <p class="text-white text-xs md:text-sm font-medium truncate">{{ track!.title }}</p>
            <p class="text-white/50 text-[10px] md:text-xs truncate">{{ track!.artist }}</p>
          </div>
        </div>
      </div>
    </template>

    <!-- 新建歌单弹窗 -->
    <Transition name="fade">
      <div
        v-if="showCreateModal"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        @click.self="showCreateModal = false"
      >
        <div class="bg-neutral-900 rounded-2xl p-6 w-80 border border-white/10">
          <h3 class="text-white font-bold mb-4">新建歌单</h3>
          <input
            v-model="newPlaylistName"
            @keyup.enter="createPlaylist"
            type="text"
            placeholder="输入歌单名称"
            class="w-full h-10 px-3 rounded-lg bg-white/10 text-white placeholder-white/30 outline-none focus:bg-white/15 mb-4"
            autofocus
          />
          <div class="flex gap-2">
            <button
              @click="showCreateModal = false"
              class="flex-1 h-10 rounded-lg bg-white/10 text-white hover:bg-white/20"
            >
              取消
            </button>
            <button
              @click="createPlaylist"
              :disabled="!newPlaylistName.trim()"
              class="flex-1 h-10 rounded-lg bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-50"
            >
              创建
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 封面选择弹窗 -->
    <Transition name="fade">
      <div
        v-if="showCoverPicker"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        @click.self="showCoverPicker = false"
      >
        <div class="bg-neutral-900 rounded-2xl w-[90%] max-w-md max-h-[80vh] border border-white/10 overflow-hidden flex flex-col">
          <div class="p-4 border-b border-white/10 flex-shrink-0">
            <h3 class="text-white font-bold">选择歌单封面</h3>
            <p class="text-white/50 text-sm mt-1">从歌单中的歌曲选择一张专辑封面</p>
          </div>
          
          <!-- 清除封面选项 -->
          <div class="px-4 pt-3">
            <button
              @click="coverPickerPlaylistId && clearCover(coverPickerPlaylistId); showCoverPicker = false"
              class="w-full flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors"
            >
              <div class="w-12 h-12 rounded-lg bg-gradient-to-br from-purple-600/50 to-pink-600/50 flex items-center justify-center">
                <svg class="w-6 h-6 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
              </div>
              <span class="text-white/70">使用默认封面（自动拼接）</span>
            </button>
          </div>
          
          <!-- 歌曲封面列表 -->
          <div class="flex-1 overflow-y-auto p-4">
            <div v-if="coverPickerTracks.length === 0" class="text-center py-8 text-white/40">
              歌单中没有带封面的歌曲
            </div>
            <div v-else class="grid grid-cols-3 gap-3">
              <button
                v-for="track in coverPickerTracks"
                :key="track!.id"
                @click="setCover(track!.cover!)"
                class="group relative aspect-square rounded-xl overflow-hidden bg-white/10 hover:ring-2 hover:ring-purple-500 transition-all"
              >
                <img :src="track!.cover" class="w-full h-full object-cover" />
                <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
                  </svg>
                </div>
                <div class="absolute bottom-0 left-0 right-0 p-1.5 bg-gradient-to-t from-black/80 to-transparent">
                  <p class="text-white text-[10px] truncate">{{ track!.title }}</p>
                </div>
              </button>
            </div>
          </div>
          
          <!-- 关闭按钮 -->
          <div class="p-4 border-t border-white/10 flex-shrink-0">
            <button
              @click="showCoverPicker = false"
              class="w-full h-10 rounded-lg bg-white/10 text-white/60 hover:bg-white/20"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 播放方式选择底部面板 -->
    <Transition name="sheet">
      <div
        v-if="showPlayMenu"
        class="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
        @click.self="showPlayMenu = false"
      >
        <div class="w-full max-w-lg bg-neutral-900 rounded-t-2xl overflow-hidden safe-area-bottom">
          <!-- 标题 -->
          <div class="p-4 text-center border-b border-white/10">
            <div class="w-10 h-1 bg-white/20 rounded-full mx-auto mb-3"></div>
            <h3 class="text-white font-bold">播放方式</h3>
            <p class="text-white/50 text-sm mt-1">{{ playlistTracks.length }} 首歌曲</p>
          </div>
          
          <!-- 选项 -->
          <div class="p-4 space-y-2">
            <button
              @click="playAllReplace"
              class="w-full flex items-center gap-4 p-4 rounded-xl bg-white/5 hover:bg-white/10 active:bg-white/15 transition-colors"
            >
              <div class="w-12 h-12 rounded-full bg-purple-600/20 flex items-center justify-center">
                <svg class="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                </svg>
              </div>
              <div class="flex-1 text-left">
                <p class="text-white font-medium">替换播放</p>
                <p class="text-white/50 text-sm">清空当前列表，播放歌单全部歌曲</p>
              </div>
            </button>
            
            <button
              @click="playAllAdd"
              class="w-full flex items-center gap-4 p-4 rounded-xl bg-white/5 hover:bg-white/10 active:bg-white/15 transition-colors"
            >
              <div class="w-12 h-12 rounded-full bg-blue-600/20 flex items-center justify-center">
                <svg class="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/>
                </svg>
              </div>
              <div class="flex-1 text-left">
                <p class="text-white font-medium">加入列表</p>
                <p class="text-white/50 text-sm">添加到当前播放列表并播放</p>
              </div>
            </button>
          </div>
          
          <!-- 取消按钮 -->
          <div class="p-4 pt-0">
            <button
              @click="showPlayMenu = false"
              class="w-full h-12 rounded-xl bg-white/10 text-white hover:bg-white/20 active:bg-white/25 transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* 底部面板动画 */
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.3s ease;
}
.sheet-enter-active > div:last-child,
.sheet-leave-active > div:last-child {
  transition: transform 0.3s ease;
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from > div:last-child,
.sheet-leave-to > div:last-child {
  transform: translateY(100%);
}

/* 安全区域底部 */
.safe-area-bottom {
  padding-bottom: env(safe-area-inset-bottom, 0);
}

/* 唱片旋转动画 */
@keyframes spin-slow {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.animate-spin-slow {
  animation: spin-slow 20s linear infinite;
}

/* 唱针旋转 */
.-rotate-25 {
  transform: rotate(-25deg);
}

/* 唱片/歌词切换动画 */
.disc-fade-enter-active,
.disc-fade-leave-active {
  transition: opacity 0.3s, transform 0.3s;
}
.disc-fade-enter-from {
  opacity: 0;
  transform: scale(0.95);
}
.disc-fade-leave-to {
  opacity: 0;
  transform: scale(1.05);
}
</style>
