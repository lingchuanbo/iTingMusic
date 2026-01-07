<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { usePlayerStore } from '@/store/player'
import { usePlaylistStore } from '@/store/playlist'
import { setSelectMode, setModalOpen } from '@/store/ui'
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

// 视图模式: 'grid' 网格视图, 'list' 列表视图
const viewMode = ref<'grid' | 'list'>(
  (localStorage.getItem('playlist_view_mode') as 'grid' | 'list') || 'list'
)

// 监听视图模式变化，保存到本地存储
watch(viewMode, (val) => {
  localStorage.setItem('playlist_view_mode', val)
})

// 封面选择弹窗
const showCoverPicker = ref(false)
const coverPickerPlaylistId = ref<string | null>(null)

// 歌单详情视图模式: 'list' 列表, 'grid' 网格, 'compact' 紧凑
// 移动端不支持紧凑视图，自动切换到列表视图
type DetailViewMode = 'list' | 'grid' | 'compact'
const isMobile = typeof window !== 'undefined' && window.innerWidth < 768
const savedDetailMode = (localStorage.getItem('playlist_detail_view_mode') as DetailViewMode) || 'list'
const detailViewMode = ref<DetailViewMode>(isMobile && savedDetailMode === 'compact' ? 'list' : savedDetailMode)

// 监听详情视图模式变化，保存到本地存储
watch(detailViewMode, (val) => {
  localStorage.setItem('playlist_detail_view_mode', val)
})

// 当前在歌单中播放的歌曲索引（保留以备将来使用）
const _currentPlaylistIndex = computed(() => {
  if (!playerStore.currentTrack) return 0
  const idx = playlistTracks.value.findIndex(t => t?.id === playerStore.currentTrack?.id)
  return idx >= 0 ? idx : 0
})
void _currentPlaylistIndex

// 播放菜单显示状态
const showPlayMenu = ref(false)

// 监听播放菜单状态，同步到全局
watch(showPlayMenu, (val) => {
  setModalOpen(val)
})

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

// 同步多选状态到全局
watch(isSelectMode, (val) => setSelectMode(val))

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

// 批量添加到喜欢
function batchAddToFavorite() {
  const ids = JSON.parse(localStorage.getItem('favorites') || '[]')
  const favData = JSON.parse(localStorage.getItem('favorites_data') || '[]')
  selectedTrackIds.value.forEach(trackId => {
    const track = trackStorage.getTrack(trackId) || playerStore.playlist.find(t => t.id === trackId)
    if (track && !ids.includes(track.id)) {
      ids.push(track.id)
      if (!favData.some((t: any) => t.id === track.id)) {
        favData.push(track)
      }
    }
  })
  localStorage.setItem('favorites', JSON.stringify(ids))
  localStorage.setItem('favorites_data', JSON.stringify(favData))
  exitSelectMode()
}

// 歌单选择弹窗（批量添加到其他歌单）
const showPlaylistPicker = ref(false)
const newPlaylistNameForPicker = ref('')

// 打开歌单选择弹窗
function openPlaylistPicker() {
  if (selectedTrackIds.value.size === 0) return
  showPlaylistPicker.value = true
}

// 批量添加到指定歌单
function batchAddToOtherPlaylist(playlistId: string) {
  selectedTrackIds.value.forEach(trackId => {
    const track = trackStorage.getTrack(trackId) || playerStore.playlist.find(t => t.id === trackId)
    if (track) {
      trackStorage.saveTrack(track)
      playlistStore.addToPlaylist(playlistId, trackId)
    }
  })
  showPlaylistPicker.value = false
  exitSelectMode()
}

// 创建新歌单并批量添加
function createAndAddToOtherPlaylist() {
  if (!newPlaylistNameForPicker.value.trim()) return
  const playlist = playlistStore.createPlaylist(newPlaylistNameForPicker.value.trim())
  batchAddToOtherPlaylist(playlist.id)
  newPlaylistNameForPicker.value = ''
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
        <h2 class="text-2xl font-bold text-white">
          我的歌单
          <span class="text-white/40 text-base font-normal ml-2">{{ playlistStore.playlists.length }} 个</span>
        </h2>
        <div class="flex items-center gap-2">
          <!-- 新建按钮 -->
          <button
            @click="showCreateModal = true"
            class="px-3 py-1.5 rounded text-sm bg-white/10 hover:bg-white/20 text-white/70 hover:text-white flex items-center justify-center gap-1.5 transition-colors"
          >
            <span class="text-base">+</span>
            <span class="hidden md:inline">新建</span>
          </button>
          <!-- 视图切换按钮 -->
          <div v-if="playlistStore.playlists.length > 0" class="flex gap-1 bg-white/5 rounded-lg p-1">
            <button
              @click="viewMode = 'list'"
              :class="['px-3 py-1.5 rounded text-sm transition-colors', viewMode === 'list' ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white']"
              title="列表视图"
            >
              ☰
            </button>
            <button
              @click="viewMode = 'grid'"
              :class="['px-3 py-1.5 rounded text-sm transition-colors', viewMode === 'grid' ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white']"
              title="网格视图"
            >
              ▦
            </button>
          </div>
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

      <!-- 列表视图 -->
      <div v-else-if="viewMode === 'list'" class="flex-1 overflow-y-auto space-y-2">
        <div
          v-for="playlist in playlistStore.playlists"
          :key="playlist.id"
          @click="selectPlaylist(playlist)"
          class="group flex items-center gap-4 p-3 rounded-xl cursor-pointer hover:bg-white/10 active:bg-white/15 transition-colors"
        >
          <!-- 封面 -->
          <div class="relative w-12 h-12 rounded-lg overflow-hidden bg-white/10 flex-shrink-0">
            <template v-if="playlist.cover">
              <img :src="playlist.cover" class="w-full h-full object-cover" />
            </template>
            <template v-else-if="getPlaylistCovers(playlist).length >= 4">
              <div class="w-full h-full grid grid-cols-2 grid-rows-2">
                <img v-for="(cover, idx) in getPlaylistCovers(playlist).slice(0, 4)" :key="idx" :src="cover" class="w-full h-full object-cover" />
              </div>
            </template>
            <template v-else-if="getPlaylistCovers(playlist).length > 0">
              <img :src="getPlaylistCovers(playlist)[0]" class="w-full h-full object-cover" />
            </template>
            <div v-else class="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-600/50 to-pink-600/50">
              <svg class="w-6 h-6 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
            </div>
          </div>
          <!-- 信息 -->
          <div class="flex-1 min-w-0">
            <div v-if="editingId === playlist.id" class="flex gap-1">
              <input v-model="editingName" @keyup.enter="saveEdit" @blur="saveEdit" @click.stop class="flex-1 px-2 py-1 rounded bg-white/10 text-white text-sm outline-none" autofocus />
            </div>
            <p v-else class="text-white font-medium truncate">{{ playlist.name }}</p>
            <p class="text-white/50 text-sm">{{ playlist.trackIds.length }} 首歌曲</p>
          </div>
          <!-- 操作按钮 -->
          <div class="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button @click.stop="openCoverPicker(playlist.id)" class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20" title="设置封面">
              <svg class="w-4 h-4 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
            </button>
            <button @click.stop="startEdit(playlist)" class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20" title="编辑">
              <svg class="w-4 h-4 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
            </button>
            <button @click.stop="deletePlaylist(playlist.id)" class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-red-500/50" title="删除">
              <svg class="w-4 h-4 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
            </button>
          </div>
        </div>
      </div>

      <!-- 网格视图 -->
      <div v-else class="flex-1 overflow-y-auto">
        <div class="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 md:gap-4">
          <div
            v-for="playlist in playlistStore.playlists"
            :key="playlist.id"
            @click="selectPlaylist(playlist)"
            class="group cursor-pointer rounded-lg md:rounded-xl p-1.5 md:p-3 transition-colors hover:bg-white/10"
          >
            <div class="relative aspect-square rounded-md md:rounded-lg overflow-hidden bg-white/10 mb-1.5 md:mb-3">
              <!-- 有自定义封面 -->
              <template v-if="playlist.cover">
                <img :src="playlist.cover" class="w-full h-full object-cover" />
              </template>
              <!-- 4宫格封面拼接 -->
              <template v-else-if="getPlaylistCovers(playlist).length >= 4">
                <div class="w-full h-full grid grid-cols-2 grid-rows-2">
                  <img v-for="(cover, idx) in getPlaylistCovers(playlist).slice(0, 4)" :key="idx" :src="cover" class="w-full h-full object-cover" />
                </div>
              </template>
              <!-- 单张封面 -->
              <template v-else-if="getPlaylistCovers(playlist).length > 0">
                <img :src="getPlaylistCovers(playlist)[0]" class="w-full h-full object-cover" />
              </template>
              <!-- 无封面 -->
              <div v-else class="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-600/50 to-pink-600/50">
                <svg class="w-8 h-8 md:w-10 md:h-10 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
              </div>
              <!-- 悬浮操作 -->
              <div class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
                <button @click.stop="openCoverPicker(playlist.id)" class="w-7 h-7 md:w-8 md:h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 text-white" title="设置封面">
                  <svg class="w-3.5 h-3.5 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                </button>
                <button @click.stop="startEdit(playlist)" class="w-7 h-7 md:w-8 md:h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 text-white" title="编辑">
                  <svg class="w-3.5 h-3.5 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
                </button>
                <button @click.stop="deletePlaylist(playlist.id)" class="w-7 h-7 md:w-8 md:h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-red-500/50 text-white" title="删除">
                  <svg class="w-3.5 h-3.5 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                </button>
              </div>
              <!-- 歌曲数量 -->
              <div class="absolute bottom-1 right-1 md:bottom-1.5 md:right-1.5 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px] md:text-xs">
                {{ playlist.trackIds.length }} 首
              </div>
            </div>
            <!-- 歌单名 -->
            <div v-if="editingId === playlist.id" class="px-0.5">
              <input v-model="editingName" @keyup.enter="saveEdit" @blur="saveEdit" class="w-full px-2 py-1 rounded bg-white/10 text-white text-xs outline-none text-center" autofocus />
            </div>
            <p v-else class="text-white text-xs md:text-sm font-medium truncate">{{ playlist.name }}</p>
            <p class="text-white/50 text-[10px] md:text-xs truncate">{{ playlist.trackIds.length }} 首歌曲</p>
          </div>
        </div>
      </div>
    </template>

    <!-- 歌单详情 -->
    <template v-else>
      <!-- 标题栏 + 视图切换 -->
      <div class="flex items-center justify-between mb-6 flex-shrink-0">
        <div class="flex items-center gap-3 min-w-0">
          <button
            @click="backToList"
            class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 flex-shrink-0"
          >
            ←
          </button>
          <h2 class="text-2xl font-bold text-white truncate">
            {{ selectedPlaylist.name }}
            <span class="text-white/40 text-base font-normal ml-2">{{ selectedPlaylist.trackIds.length }} 首</span>
          </h2>
        </div>

        <div class="flex items-center gap-2">
          <!-- 播放按钮 -->
          <button
            v-if="playlistTracks.length > 0"
            @click="showPlayMenu = true"
            class="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm flex items-center gap-1"
          >
            ▶ 播放
          </button>
          <!-- 视图切换按钮 -->
          <div v-if="playlistTracks.length > 0" class="flex gap-1 bg-white/5 rounded-lg p-1">
            <button
              @click="detailViewMode = 'list'"
              :class="['px-3 py-1.5 rounded text-sm transition-colors', detailViewMode === 'list' ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white']"
              title="列表视图"
            >
              ☰
            </button>
            <button
              @click="detailViewMode = 'grid'"
              :class="['px-3 py-1.5 rounded text-sm transition-colors', detailViewMode === 'grid' ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white']"
              title="网格视图"
            >
              ▦
            </button>
            <button
              @click="detailViewMode = 'compact'"
              :class="['hidden md:block px-3 py-1.5 rounded text-sm transition-colors', detailViewMode === 'compact' ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white']"
              title="紧凑视图"
            >
              ≡
            </button>
          </div>
        </div>
      </div>

      <div v-if="playlistTracks.length === 0" class="text-center py-20">
        <p class="text-white/50">歌单是空的</p>
        <p class="text-white/30 text-sm mt-2">在播放列表中将歌曲添加到此歌单</p>
      </div>

      <!-- 多选操作栏 - 底部悬浮 -->
      <Transition name="slide-up">
        <div v-if="isSelectMode" class="fixed bottom-4 left-0 right-0 z-40 px-4 safe-area-bottom">
          <div class="max-w-xl mx-auto rounded-2xl bg-neutral-900/98 backdrop-blur-xl border border-white/10 shadow-2xl overflow-hidden">
            <!-- 顶部信息栏 -->
            <div class="flex items-center justify-between px-4 py-2.5 border-b border-white/5">
              <div class="flex items-center gap-3">
                <button @click="exitSelectMode" class="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/20 transition-colors">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
                <span class="text-white font-medium">已选 <span class="text-purple-400">{{ selectedCount }}</span> 首</span>
              </div>
              <button @click="toggleSelectAll" class="text-purple-400 text-sm hover:text-purple-300 transition-colors">
                {{ selectedTrackIds.size === playlistTracks.length ? '取消全选' : '全选' }}
              </button>
            </div>
            <!-- 操作按钮 -->
            <div class="flex items-center justify-around py-3 px-2">
              <button @click="batchPlaySelected" :disabled="selectedCount === 0" class="flex flex-col items-center gap-1 px-4 py-1.5 rounded-xl hover:bg-white/5 disabled:opacity-40 transition-colors group">
                <div class="w-10 h-10 rounded-full bg-purple-600 flex items-center justify-center group-hover:bg-purple-500 transition-colors">
                  <svg class="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                </div>
                <span class="text-white/70 text-xs">播放</span>
              </button>
              <button @click="batchAddToFavorite" :disabled="selectedCount === 0" class="flex flex-col items-center gap-1 px-4 py-1.5 rounded-xl hover:bg-white/5 disabled:opacity-40 transition-colors group">
                <div class="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center group-hover:bg-pink-600/20 transition-colors">
                  <svg class="w-5 h-5 text-pink-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                </div>
                <span class="text-white/70 text-xs">喜欢</span>
              </button>
              <button @click="openPlaylistPicker" :disabled="selectedCount === 0" class="flex flex-col items-center gap-1 px-4 py-1.5 rounded-xl hover:bg-white/5 disabled:opacity-40 transition-colors group">
                <div class="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center group-hover:bg-blue-600/20 transition-colors">
                  <svg class="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
                </div>
                <span class="text-white/70 text-xs">歌单</span>
              </button>
              <button @click="batchRemoveFromPlaylist" :disabled="selectedCount === 0" class="flex flex-col items-center gap-1 px-4 py-1.5 rounded-xl hover:bg-white/5 disabled:opacity-40 transition-colors group">
                <div class="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center group-hover:bg-red-600/20 transition-colors">
                  <svg class="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                </div>
                <span class="text-white/70 text-xs">移除</span>
              </button>
            </div>
          </div>
        </div>
      </Transition>

      <!-- 列表视图 -->
      <div v-if="playlistTracks.length > 0 && detailViewMode === 'list'" class="flex-1 overflow-y-auto space-y-2">
        <div
          v-for="track in playlistTracks"
          :key="track!.id"
          @click="handleTrackClick(track!.id)"
          @mousedown="handleLongPressStart(track!.id)"
          @mouseup="handleLongPressEnd"
          @mouseleave="handleLongPressEnd"
          @touchstart.passive="handleLongPressStart(track!.id)"
          @touchend="handleLongPressEnd"
          @touchcancel="handleLongPressEnd"
          :class="[
            'group flex items-center gap-4 p-3 rounded-xl cursor-pointer transition-all duration-200',
            selectedTrackIds.has(track!.id) ? 'bg-purple-600/30' : playerStore.currentTrack?.id === track!.id ? 'bg-white/20' : 'hover:bg-white/10'
          ]"
        >
          <!-- 多选框 -->
          <div v-if="isSelectMode" class="w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0"
            :class="selectedTrackIds.has(track!.id) ? 'bg-purple-600 border-purple-600' : 'border-white/30'">
            <svg v-if="selectedTrackIds.has(track!.id)" class="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
            </svg>
          </div>
          <!-- 封面 -->
          <div class="relative w-12 h-12 rounded-lg overflow-hidden bg-white/10 flex-shrink-0">
            <img v-if="track!.cover" :src="track!.cover" :alt="track!.title" class="w-full h-full object-cover" />
            <div v-else class="w-full h-full flex items-center justify-center text-2xl">🎵</div>
            <div v-if="playerStore.currentTrack?.id === track!.id && playerStore.isPlaying" class="absolute inset-0 bg-black/40 flex items-center justify-center">
              <div class="flex gap-0.5">
                <span class="w-1 h-4 bg-white rounded animate-pulse"></span>
                <span class="w-1 h-4 bg-white rounded animate-pulse" style="animation-delay: 0.2s"></span>
                <span class="w-1 h-4 bg-white rounded animate-pulse" style="animation-delay: 0.4s"></span>
              </div>
            </div>
          </div>
          <!-- 信息 -->
          <div class="flex-1 min-w-0">
            <p class="text-white font-medium truncate">{{ track!.title }}</p>
            <p class="text-white/50 text-sm truncate">{{ track!.artist }}</p>
          </div>
          <!-- 时长 -->
          <span class="text-white/40 text-sm">{{ track!.duration ? formatTime(track!.duration) : '--:--' }}</span>
          <!-- 更多操作按钮 -->
          <button
            v-if="!isSelectMode"
            @click.stop
            @mousedown="handleLongPressStart(track!.id)"
            @mouseup="handleLongPressEnd"
            @mouseleave="handleLongPressEnd"
            @touchstart.passive="handleLongPressStart(track!.id)"
            @touchend="handleLongPressEnd"
            @touchcancel="handleLongPressEnd"
            class="w-8 h-8 flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/10 rounded-lg transition-colors"
          >
            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- 网格视图 -->
      <div v-else-if="playlistTracks.length > 0 && detailViewMode === 'grid'" class="flex-1 overflow-y-auto">
        <div class="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 md:gap-4">
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
              'group cursor-pointer rounded-lg md:rounded-xl p-1.5 md:p-3 transition-all duration-200',
              selectedTrackIds.has(track!.id) ? 'bg-purple-600/30' : playerStore.currentTrack?.id === track!.id ? 'bg-purple-600/30' : 'hover:bg-white/10'
            ]"
          >
            <div class="relative aspect-square rounded-md md:rounded-lg overflow-hidden bg-white/10 mb-1.5 md:mb-3">
              <img v-if="track!.cover" :src="track!.cover" :alt="track!.title" class="w-full h-full object-cover" />
              <div v-else class="w-full h-full flex items-center justify-center text-2xl md:text-4xl bg-gradient-to-br from-purple-600/50 to-pink-600/50">🎵</div>
              <!-- 多选框 -->
              <div v-if="isSelectMode" class="absolute top-1 left-1 md:top-2 md:left-2 w-5 h-5 md:w-6 md:h-6 rounded-full border-2 flex items-center justify-center"
                :class="selectedTrackIds.has(track!.id) ? 'bg-purple-600 border-purple-600' : 'bg-black/40 border-white/50'">
                <svg v-if="selectedTrackIds.has(track!.id)" class="w-3 h-3 md:w-4 md:h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
                </svg>
              </div>
              <!-- 播放指示器 -->
              <div v-if="!isSelectMode && playerStore.currentTrack?.id === track!.id" class="absolute inset-0 bg-black/40 flex items-center justify-center">
                <div class="w-8 h-8 md:w-12 md:h-12 rounded-full bg-purple-600 flex items-center justify-center">
                  <span v-if="playerStore.isPlaying" class="text-white text-sm md:text-lg">▶</span>
                  <span v-else class="text-white text-sm md:text-lg">⏸</span>
                </div>
              </div>
              <!-- 悬浮操作 -->
              <div v-if="!isSelectMode && playerStore.currentTrack?.id !== track!.id" class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1 md:gap-2">
                <button @click.stop="removeFromPlaylist(track!.id)" class="w-6 h-6 md:w-8 md:h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-red-500/50 text-white/70 text-xs md:text-base">✕</button>
              </div>
              <!-- 序号 -->
              <div v-if="!isSelectMode" class="absolute top-1 left-1 md:top-2 md:left-2 w-5 h-5 md:w-6 md:h-6 rounded-full bg-black/60 flex items-center justify-center text-white text-[10px] md:text-xs">
                {{ index + 1 }}
              </div>
            </div>
            <p class="text-white text-xs md:text-sm font-medium truncate">{{ track!.title }}</p>
            <p class="text-white/50 text-[10px] md:text-xs truncate">{{ track!.artist }}</p>
          </div>
        </div>
      </div>

      <!-- 紧凑视图 -->
      <div v-else-if="playlistTracks.length > 0 && detailViewMode === 'compact'" class="flex-1 overflow-y-auto space-y-0.5">
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
            'group flex items-center gap-3 px-3 py-1.5 rounded cursor-pointer transition-colors',
            selectedTrackIds.has(track!.id) ? 'bg-purple-600/30' : playerStore.currentTrack?.id === track!.id ? 'bg-white/20' : 'hover:bg-white/10'
          ]"
        >
          <!-- 多选框 -->
          <div v-if="isSelectMode" class="w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0"
            :class="selectedTrackIds.has(track!.id) ? 'bg-purple-600 border-purple-600' : 'border-white/30'">
            <svg v-if="selectedTrackIds.has(track!.id)" class="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
            </svg>
          </div>
          <span v-if="!isSelectMode" class="w-6 text-white/30 text-xs text-right">{{ index + 1 }}</span>
          <span v-if="!isSelectMode && playerStore.currentTrack?.id === track!.id && playerStore.isPlaying" class="text-green-400 text-xs">▶</span>
          <span v-else-if="!isSelectMode" class="w-3"></span>
          <span class="flex-1 text-white text-sm truncate">{{ track!.title }}</span>
          <span class="text-white/40 text-sm truncate max-w-32">{{ track!.artist }}</span>
          <span class="text-white/30 text-xs w-10 text-right">{{ track!.duration ? formatTime(track!.duration) : '--:--' }}</span>
          <!-- 更多操作按钮 -->
          <button
            v-if="!isSelectMode"
            @click.stop
            @mousedown="handleLongPressStart(track!.id)"
            @mouseup="handleLongPressEnd"
            @mouseleave="handleLongPressEnd"
            @touchstart.passive="handleLongPressStart(track!.id)"
            @touchend="handleLongPressEnd"
            @touchcancel="handleLongPressEnd"
            class="w-6 h-6 flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/10 rounded transition-colors"
          >
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z"/>
            </svg>
          </button>
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

    <!-- 批量添加到歌单弹窗 -->
    <Transition name="modal">
      <div 
        v-if="showPlaylistPicker"
        class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
        @click.self="showPlaylistPicker = false"
      >
        <div class="w-full max-w-sm bg-neutral-900 rounded-2xl overflow-hidden">
          <div class="p-4 border-b border-white/10">
            <h3 class="text-white font-bold text-lg">选择歌单</h3>
            <p class="text-white/50 text-sm">将 {{ selectedCount }} 首歌曲添加到歌单</p>
          </div>
          
          <!-- 创建新歌单 -->
          <div class="p-3 border-b border-white/10">
            <div class="flex gap-2">
              <input
                v-model="newPlaylistNameForPicker"
                type="text"
                placeholder="新建歌单..."
                class="flex-1 h-10 px-3 rounded-lg bg-white/10 text-white placeholder-white/40 outline-none focus:bg-white/15"
                @keyup.enter="createAndAddToOtherPlaylist"
              />
              <button
                @click="createAndAddToOtherPlaylist"
                :disabled="!newPlaylistNameForPicker.trim()"
                class="px-4 rounded-lg bg-purple-600 text-white text-sm hover:bg-purple-500 disabled:opacity-50"
              >
                创建
              </button>
            </div>
          </div>
          
          <!-- 歌单列表（排除当前歌单） -->
          <div class="max-h-60 overflow-y-auto">
            <div v-if="playlistStore.playlists.filter(p => p.id !== selectedPlaylist?.id).length === 0" class="p-6 text-center text-white/40">
              暂无其他歌单，请先创建
            </div>
            <button
              v-for="pl in playlistStore.playlists.filter(p => p.id !== selectedPlaylist?.id)"
              :key="pl.id"
              @click="batchAddToOtherPlaylist(pl.id)"
              class="w-full flex items-center gap-3 p-3 hover:bg-white/10 transition-colors"
            >
              <div class="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center text-lg">
                📁
              </div>
              <div class="flex-1 text-left">
                <p class="text-white">{{ pl.name }}</p>
                <p class="text-white/50 text-xs">{{ pl.trackIds.length }} 首歌曲</p>
              </div>
            </button>
          </div>
          
          <!-- 关闭按钮 -->
          <div class="p-3 border-t border-white/10">
            <button
              @click="showPlaylistPicker = false"
              class="w-full h-10 rounded-lg bg-white/10 text-white/60 hover:bg-white/20"
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

/* 弹窗动画 */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}
.modal-enter-active > div,
.modal-leave-active > div {
  transition: transform 0.2s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from > div,
.modal-leave-to > div {
  transform: scale(0.95);
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

/* 底部滑入动画 */
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s ease;
}
.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
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
