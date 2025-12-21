<script setup lang="ts">
import { ref, computed } from 'vue'
import { usePlayerStore } from '@/store/player'
import { usePlaylistStore } from '@/store/playlist'
import { formatTime } from '@/utils/formatTime'
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

// 歌单详情视图模式: 'list' 列表, 'album' 专辑展示, 'albumLyrics' 专辑+歌词, 'swipe' 滑动切歌
// 移动端默认使用专辑视图（列表视图在移动端隐藏）
const isMobile = typeof window !== 'undefined' && window.innerWidth < 768
const detailViewMode = ref<'list' | 'album' | 'albumLyrics' | 'swipe'>(isMobile ? 'album' : 'list')

// 滑动视图相关
const swipeStartX = ref(0)
const swipeCurrentX = ref(0)
const isSwiping = ref(false)
const swipeThreshold = 80 // 滑动阈值

// 唱片播放视图：是否显示歌词
const showDiscLyrics = ref(false)

// 当前在歌单中播放的歌曲索引
const currentPlaylistIndex = computed(() => {
  if (!playerStore.currentTrack) return 0
  const idx = playlistTracks.value.findIndex(t => t?.id === playerStore.currentTrack?.id)
  return idx >= 0 ? idx : 0
})

function handleSwipeStart(e: TouchEvent | MouseEvent) {
  isSwiping.value = true
  swipeStartX.value = 'touches' in e ? e.touches[0].clientX : e.clientX
  swipeCurrentX.value = swipeStartX.value
}

function handleSwipeMove(e: TouchEvent | MouseEvent) {
  if (!isSwiping.value) return
  swipeCurrentX.value = 'touches' in e ? e.touches[0].clientX : e.clientX
}

function handleSwipeEnd() {
  if (!isSwiping.value) return
  const diff = swipeCurrentX.value - swipeStartX.value
  
  if (Math.abs(diff) > swipeThreshold) {
    if (diff > 0) {
      // 向右滑 - 上一首
      playPrevInPlaylist()
    } else {
      // 向左滑 - 下一首
      playNextInPlaylist()
    }
  }
  
  isSwiping.value = false
  swipeStartX.value = 0
  swipeCurrentX.value = 0
}

function playPrevInPlaylist() {
  const idx = currentPlaylistIndex.value
  if (idx > 0) {
    const prevTrack = playlistTracks.value[idx - 1]
    if (prevTrack) playTrack(prevTrack.id)
  }
}

function playNextInPlaylist() {
  const idx = currentPlaylistIndex.value
  if (idx < playlistTracks.value.length - 1) {
    const nextTrack = playlistTracks.value[idx + 1]
    if (nextTrack) playTrack(nextTrack.id)
  }
}

// 计算滑动偏移
const swipeOffset = computed(() => {
  if (!isSwiping.value) return 0
  return swipeCurrentX.value - swipeStartX.value
})

// 获取歌单中的歌曲
const playlistTracks = computed(() => {
  if (!selectedPlaylist.value) return []
  return selectedPlaylist.value.trackIds
    .map(id => playerStore.playlist.find(t => t.id === id))
    .filter(Boolean)
})

// 获取歌单封面（使用第一首歌的封面）
function getPlaylistCover(playlist: Playlist): string | undefined {
  if (playlist.cover) return playlist.cover
  const firstTrackId = playlist.trackIds[0]
  if (firstTrackId) {
    const track = playerStore.playlist.find(t => t.id === firstTrackId)
    return track?.cover
  }
  return undefined
}

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
  const idx = playerStore.playlist.findIndex(t => t.id === trackId)
  if (idx >= 0) {
    playerStore.playTrack(idx)
  }
}

function removeFromPlaylist(trackId: string) {
  if (selectedPlaylist.value) {
    playlistStore.removeFromPlaylist(selectedPlaylist.value.id, trackId)
  }
}

function playAll() {
  if (playlistTracks.value.length > 0) {
    const firstTrack = playlistTracks.value[0]
    if (firstTrack) {
      const idx = playerStore.playlist.findIndex(t => t.id === firstTrack.id)
      if (idx >= 0) playerStore.playTrack(idx)
    }
  }
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

// 判断是否是当前歌词行
function isCurrentLyricLine(lineTime: number): boolean {
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
</script>

<template>
  <div class="flex-1 p-6 flex flex-col h-full overflow-hidden">
    <!-- 歌单列表 -->
    <template v-if="!selectedPlaylist">
      <!-- 标题栏 -->
      <div class="flex items-center justify-between mb-6 flex-shrink-0">
        <h2 class="text-2xl font-bold text-white">🎵 我的歌单</h2>
        <div class="flex items-center gap-1.5 md:gap-2">
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
              <!-- 悬浮操作 -->
              <div class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
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
              @click.stop="startEdit(playlist)"
              class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20"
              title="编辑"
            >
              ✏️
            </button>
            <button
              @click.stop="deletePlaylist(playlist.id)"
              class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-red-500/50"
              title="删除"
            >
              🗑️
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
          <button
            v-if="playlistTracks.length > 0"
            @click="playAll"
            class="px-3 md:px-4 py-1.5 md:py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs md:text-sm flex-shrink-0"
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
            ☰
          </button>
          <button
            @click="detailViewMode = 'album'"
            :class="['px-2 md:px-3 py-1 md:py-1.5 rounded-md text-xs md:text-sm transition-colors', detailViewMode === 'album' ? 'bg-purple-600 text-white' : 'text-white/60 hover:text-white']"
            title="专辑视图"
          >
            💿
          </button>
          <button
            @click="detailViewMode = 'albumLyrics'"
            :class="['px-2 md:px-3 py-1 md:py-1.5 rounded-md text-xs md:text-sm transition-colors', detailViewMode === 'albumLyrics' ? 'bg-purple-600 text-white' : 'text-white/60 hover:text-white']"
            title="专辑+歌词"
          >
            📝
          </button>
          <button
            @click="detailViewMode = 'swipe'"
            :class="['px-2 md:px-3 py-1 md:py-1.5 rounded-md text-xs md:text-sm transition-colors', detailViewMode === 'swipe' ? 'bg-purple-600 text-white' : 'text-white/60 hover:text-white']"
            title="滑动切歌"
          >
            👆
          </button>
        </div>
      </div>

      <div v-if="playlistTracks.length === 0" class="text-center py-20">
        <p class="text-white/50">歌单是空的</p>
        <p class="text-white/30 text-sm mt-2">在播放列表中将歌曲添加到此歌单</p>
      </div>

      <!-- 列表视图 -->
      <div v-else-if="detailViewMode === 'list'" class="flex-1 overflow-y-auto space-y-2">
        <div
          v-for="(track, index) in playlistTracks"
          :key="track!.id"
          @click="playTrack(track!.id)"
          :class="[
            'group flex items-center gap-4 p-3 rounded-xl cursor-pointer transition-colors',
            playerStore.currentTrack?.id === track!.id ? 'bg-purple-600/30' : 'hover:bg-white/10'
          ]"
        >
          <span class="w-6 text-white/30 text-sm text-right">{{ index + 1 }}</span>
          <div class="w-10 h-10 rounded-lg overflow-hidden bg-white/10 flex-shrink-0">
            <img v-if="track!.cover" :src="track!.cover" class="w-full h-full object-cover" />
            <div v-else class="w-full h-full flex items-center justify-center">🎵</div>
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-white text-sm truncate">{{ track!.title }}</p>
            <p class="text-white/50 text-xs truncate">{{ track!.artist }}</p>
          </div>
          <button
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

      <!-- 唱片播放视图（网易云风格） -->
      <div v-else-if="detailViewMode === 'albumLyrics'" class="flex-1 overflow-hidden flex flex-col relative">
        <!-- 点击切换唱片/歌词 -->
        <div 
          class="flex-1 w-full flex flex-col items-center cursor-pointer overflow-hidden"
          @click="showDiscLyrics = !showDiscLyrics"
        >
          <!-- 唱片视图 -->
          <Transition name="disc-fade" mode="out-in">
            <div v-if="!showDiscLyrics" key="disc" class="flex flex-col items-center pt-4 md:pt-8 relative w-full">
              <!-- 唱针（右上角弯曲） -->
              <div class="absolute top-2 md:top-4 right-1/2 translate-x-[120px] md:translate-x-[160px] z-20">
                <svg 
                  :class="[
                    'w-16 h-24 md:w-20 md:h-28 transition-transform duration-500 origin-top',
                    playerStore.isPlaying ? 'rotate-[15deg]' : 'rotate-[-10deg]'
                  ]"
                  viewBox="0 0 60 90"
                >
                  <!-- 唱针底座 -->
                  <circle cx="12" cy="12" r="10" fill="url(#needleBase)" />
                  <circle cx="12" cy="12" r="6" fill="#555" />
                  <!-- 唱针臂（弯曲） -->
                  <path 
                    d="M12 18 Q 20 40, 35 70" 
                    stroke="url(#needleArm)" 
                    stroke-width="4" 
                    fill="none"
                    stroke-linecap="round"
                  />
                  <!-- 唱针头 -->
                  <ellipse cx="37" cy="75" rx="5" ry="8" fill="#888" />
                  <ellipse cx="37" cy="82" rx="2" ry="3" fill="#666" />
                  <!-- 渐变定义 -->
                  <defs>
                    <linearGradient id="needleBase" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" style="stop-color:#888" />
                      <stop offset="100%" style="stop-color:#444" />
                    </linearGradient>
                    <linearGradient id="needleArm" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" style="stop-color:#aaa" />
                      <stop offset="100%" style="stop-color:#666" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>

              <!-- 圆形唱片 -->
              <div class="relative mt-8 md:mt-12">
                <div 
                  :class="[
                    'w-56 h-56 md:w-72 md:h-72 rounded-full shadow-2xl',
                    playerStore.isPlaying ? 'animate-spin-slow' : ''
                  ]"
                  :style="{ animationPlayState: playerStore.isPlaying ? 'running' : 'paused' }"
                >
                  <!-- 唱片黑胶部分 -->
                  <div class="w-full h-full rounded-full bg-gradient-to-br from-zinc-900 via-zinc-800 to-black p-1 relative">
                    <!-- 外圈光泽 -->
                    <div class="absolute inset-0 rounded-full bg-gradient-to-tr from-transparent via-white/5 to-transparent"></div>
                    <!-- 纹路 -->
                    <div class="absolute inset-[8%] rounded-full border border-zinc-600/20"></div>
                    <div class="absolute inset-[12%] rounded-full border border-zinc-600/10"></div>
                    <div class="absolute inset-[16%] rounded-full border border-zinc-600/20"></div>
                    <div class="absolute inset-[20%] rounded-full border border-zinc-600/10"></div>
                    
                    <!-- 中心封面（大圆） -->
                    <div class="absolute inset-[22%] rounded-full overflow-hidden border-4 border-zinc-700/50">
                      <img
                        v-if="playerStore.currentTrack?.cover"
                        :src="playerStore.currentTrack.cover"
                        class="w-full h-full object-cover"
                      />
                      <div v-else class="w-full h-full flex items-center justify-center text-4xl md:text-5xl bg-gradient-to-br from-purple-600/50 to-pink-600/50">
                        🎵
                      </div>
                    </div>
                    
                    <!-- 中心小圆点 -->
                    <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 md:w-4 md:h-4 rounded-full bg-zinc-500 shadow-inner z-10"></div>
                  </div>
                </div>
              </div>

              <!-- 歌曲信息 -->
              <div class="mt-8 md:mt-10 text-center px-6 w-full">
                <p class="text-white font-bold text-lg md:text-xl mb-2 truncate">
                  {{ playerStore.currentTrack?.title || '未播放' }}
                </p>
                <p class="text-white/50 text-sm">
                  {{ playerStore.currentTrack?.artist || '-' }}
                </p>
              </div>

              <!-- 点击提示 -->
              <p class="mt-6 text-white/30 text-xs">点击查看歌词</p>
            </div>

            <!-- 歌词视图 -->
            <div v-else key="lyrics" class="flex flex-col items-center w-full h-full pt-4">
              <!-- 顶部歌曲信息 -->
              <div class="flex items-center gap-3 px-4 mb-4 flex-shrink-0">
                <div 
                  :class="[
                    'w-12 h-12 md:w-14 md:h-14 rounded-full overflow-hidden bg-white/10 flex-shrink-0 border-2 border-zinc-700',
                    playerStore.isPlaying ? 'animate-spin-slow' : ''
                  ]"
                >
                  <img
                    v-if="playerStore.currentTrack?.cover"
                    :src="playerStore.currentTrack.cover"
                    class="w-full h-full object-cover"
                  />
                  <div v-else class="w-full h-full flex items-center justify-center text-xl">🎵</div>
                </div>
                <div>
                  <p class="text-white font-medium text-sm md:text-base truncate max-w-[200px]">
                    {{ playerStore.currentTrack?.title || '未播放' }}
                  </p>
                  <p class="text-white/50 text-xs truncate max-w-[180px]">
                    {{ playerStore.currentTrack?.artist || '-' }}
                  </p>
                </div>
              </div>

              <!-- 歌词滚动区域 -->
              <div class="flex-1 w-full overflow-y-auto text-center px-6 md:px-12">
                <div v-if="playerStore.currentTrack?.lrc" class="space-y-4 py-4">
                  <p
                    v-for="(line, idx) in parseLyrics(playerStore.currentTrack.lrc)"
                    :key="idx"
                    :class="[
                      'transition-all duration-300 leading-relaxed',
                      isCurrentLyricLine(line.time) 
                        ? 'text-white text-lg md:text-xl font-medium' 
                        : 'text-white/40 text-base'
                    ]"
                  >
                    {{ line.text || '♪' }}
                  </p>
                </div>
                <div v-else class="flex flex-col items-center justify-center h-full text-white/30">
                  <p class="text-4xl mb-3">🎵</p>
                  <p>暂无歌词</p>
                </div>
              </div>

              <!-- 点击提示 -->
              <p class="py-3 text-white/30 text-xs flex-shrink-0">点击返回唱片</p>
            </div>
          </Transition>
        </div>

        <!-- 底部播放控制 -->
        <div class="w-full px-6 pb-4 flex-shrink-0 bg-gradient-to-t from-black/20 to-transparent pt-4">
          <!-- 进度条 -->
          <div class="flex items-center gap-3 mb-4">
            <span class="text-white/50 text-xs w-10 text-right font-mono">{{ formatTime(playerStore.currentTime) }}</span>
            <div class="flex-1 h-1 bg-white/20 rounded-full overflow-hidden">
              <div 
                class="h-full bg-white rounded-full transition-all duration-100"
                :style="{ width: `${playerStore.progress}%` }"
              ></div>
            </div>
            <span class="text-white/50 text-xs w-10 font-mono">{{ formatTime(playerStore.duration) }}</span>
          </div>

          <!-- 控制按钮 -->
          <div class="flex items-center justify-center gap-8">
            <!-- 循环模式 -->
            <button 
              @click.stop="playerStore.togglePlayMode()"
              class="w-8 h-8 flex items-center justify-center text-white/50 hover:text-white transition-colors"
            >
              <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>
              </svg>
            </button>
            <!-- 上一首 -->
            <button 
              @click.stop="playPrevInPlaylist"
              :disabled="currentPlaylistIndex === 0"
              class="w-10 h-10 flex items-center justify-center text-white/70 hover:text-white disabled:opacity-30 transition-colors"
            >
              <svg class="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
              </svg>
            </button>
            <!-- 播放/暂停 -->
            <button 
              @click.stop="playerStore.togglePlay()"
              class="w-16 h-16 rounded-full border-2 border-white/80 flex items-center justify-center text-white hover:border-white hover:scale-105 transition-all"
            >
              <svg v-if="playerStore.isPlaying" class="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
              </svg>
              <svg v-else class="w-8 h-8 ml-1" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </button>
            <!-- 下一首 -->
            <button 
              @click.stop="playNextInPlaylist"
              :disabled="currentPlaylistIndex >= playlistTracks.length - 1"
              class="w-10 h-10 flex items-center justify-center text-white/70 hover:text-white disabled:opacity-30 transition-colors"
            >
              <svg class="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
              </svg>
            </button>
            <!-- 播放列表 -->
            <button 
              @click.stop
              class="w-8 h-8 flex items-center justify-center text-white/50 hover:text-white transition-colors"
            >
              <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/>
              </svg>
            </button>
          </div>
        </div>
      </div>

      <!-- 滑动切歌视图（网易云风格） -->
      <div 
        v-else-if="detailViewMode === 'swipe'" 
        class="flex-1 overflow-hidden flex flex-col relative"
        @touchstart="handleSwipeStart"
        @touchmove="handleSwipeMove"
        @touchend="handleSwipeEnd"
        @mousedown="handleSwipeStart"
        @mousemove="handleSwipeMove"
        @mouseup="handleSwipeEnd"
        @mouseleave="handleSwipeEnd"
      >
        <!-- 点击切换唱片/歌词 -->
        <div 
          class="flex-1 w-full flex flex-col items-center cursor-pointer overflow-hidden"
          @click="showDiscLyrics = !showDiscLyrics"
        >
          <Transition name="disc-fade" mode="out-in">
            <!-- 唱片视图 -->
            <div v-if="!showDiscLyrics" key="disc" class="flex flex-col items-center pt-4 md:pt-8 relative w-full select-none">
              <!-- 唱针 -->
              <div class="absolute top-2 md:top-4 right-1/2 translate-x-[100px] md:translate-x-[140px] z-20">
                <svg 
                  :class="[
                    'w-14 h-20 md:w-20 md:h-28 transition-transform duration-500 origin-top',
                    playerStore.isPlaying ? 'rotate-[15deg]' : 'rotate-[-10deg]'
                  ]"
                  viewBox="0 0 60 90"
                >
                  <circle cx="12" cy="12" r="10" fill="url(#needleBase2)" />
                  <circle cx="12" cy="12" r="6" fill="#555" />
                  <path d="M12 18 Q 20 40, 35 70" stroke="url(#needleArm2)" stroke-width="4" fill="none" stroke-linecap="round"/>
                  <ellipse cx="37" cy="75" rx="5" ry="8" fill="#888" />
                  <ellipse cx="37" cy="82" rx="2" ry="3" fill="#666" />
                  <defs>
                    <linearGradient id="needleBase2" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" style="stop-color:#888" />
                      <stop offset="100%" style="stop-color:#444" />
                    </linearGradient>
                    <linearGradient id="needleArm2" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" style="stop-color:#aaa" />
                      <stop offset="100%" style="stop-color:#666" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>

              <!-- 滑动提示 -->
              <div class="absolute top-2 left-4 text-white/30 text-[10px] md:text-xs">
                ← 滑动切歌 →
              </div>

              <!-- 圆形唱片（可滑动） -->
              <div class="relative mt-8 md:mt-12">
                <div 
                  class="transition-transform duration-150"
                  :style="{ transform: `translateX(${swipeOffset * 0.3}px) scale(${1 - Math.abs(swipeOffset) * 0.001})` }"
                >
                  <div 
                    :class="[
                      'w-52 h-52 md:w-72 md:h-72 rounded-full shadow-2xl',
                      playerStore.isPlaying ? 'animate-spin-slow' : ''
                    ]"
                    :style="{ animationPlayState: playerStore.isPlaying ? 'running' : 'paused' }"
                  >
                    <div class="w-full h-full rounded-full bg-gradient-to-br from-zinc-900 via-zinc-800 to-black p-1 relative">
                      <div class="absolute inset-0 rounded-full bg-gradient-to-tr from-transparent via-white/5 to-transparent"></div>
                      <div class="absolute inset-[8%] rounded-full border border-zinc-600/20"></div>
                      <div class="absolute inset-[12%] rounded-full border border-zinc-600/10"></div>
                      <div class="absolute inset-[16%] rounded-full border border-zinc-600/20"></div>
                      <div class="absolute inset-[20%] rounded-full border border-zinc-600/10"></div>
                      <div class="absolute inset-[22%] rounded-full overflow-hidden border-4 border-zinc-700/50">
                        <img
                          v-if="playerStore.currentTrack?.cover"
                          :src="playerStore.currentTrack.cover"
                          class="w-full h-full object-cover"
                          draggable="false"
                        />
                        <div v-else class="w-full h-full flex items-center justify-center text-4xl md:text-5xl bg-gradient-to-br from-purple-600/50 to-pink-600/50">
                          🎵
                        </div>
                      </div>
                      <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 md:w-4 md:h-4 rounded-full bg-zinc-500 shadow-inner z-10"></div>
                    </div>
                  </div>
                </div>

                <!-- 上一首提示 -->
                <div 
                  v-if="currentPlaylistIndex > 0"
                  :class="['absolute left-[-60px] md:left-[-80px] top-1/2 -translate-y-1/2 transition-opacity', swipeOffset > 30 ? 'opacity-100' : 'opacity-30']"
                >
                  <div class="w-12 h-12 md:w-16 md:h-16 rounded-full overflow-hidden bg-white/10 border-2 border-zinc-700/50">
                    <img v-if="playlistTracks[currentPlaylistIndex - 1]?.cover" :src="playlistTracks[currentPlaylistIndex - 1]?.cover" class="w-full h-full object-cover opacity-60"/>
                    <div v-else class="w-full h-full flex items-center justify-center text-lg">🎵</div>
                  </div>
                </div>

                <!-- 下一首提示 -->
                <div 
                  v-if="currentPlaylistIndex < playlistTracks.length - 1"
                  :class="['absolute right-[-60px] md:right-[-80px] top-1/2 -translate-y-1/2 transition-opacity', swipeOffset < -30 ? 'opacity-100' : 'opacity-30']"
                >
                  <div class="w-12 h-12 md:w-16 md:h-16 rounded-full overflow-hidden bg-white/10 border-2 border-zinc-700/50">
                    <img v-if="playlistTracks[currentPlaylistIndex + 1]?.cover" :src="playlistTracks[currentPlaylistIndex + 1]?.cover" class="w-full h-full object-cover opacity-60"/>
                    <div v-else class="w-full h-full flex items-center justify-center text-lg">🎵</div>
                  </div>
                </div>
              </div>

              <!-- 歌曲信息 -->
              <div class="mt-6 md:mt-8 text-center px-6 w-full">
                <p class="text-white font-bold text-lg md:text-xl mb-2 truncate">
                  {{ playerStore.currentTrack?.title || '未播放' }}
                </p>
                <p class="text-white/50 text-sm">
                  {{ playerStore.currentTrack?.artist || '-' }}
                </p>
              </div>

              <p class="mt-4 text-white/30 text-xs">点击查看歌词</p>
            </div>

            <!-- 歌词视图 -->
            <div v-else key="lyrics" class="flex flex-col items-center w-full h-full pt-4">
              <div class="flex items-center gap-3 px-4 mb-4 flex-shrink-0">
                <div :class="['w-12 h-12 rounded-full overflow-hidden bg-white/10 flex-shrink-0 border-2 border-zinc-700', playerStore.isPlaying ? 'animate-spin-slow' : '']">
                  <img v-if="playerStore.currentTrack?.cover" :src="playerStore.currentTrack.cover" class="w-full h-full object-cover"/>
                  <div v-else class="w-full h-full flex items-center justify-center text-xl">🎵</div>
                </div>
                <div>
                  <p class="text-white font-medium text-sm truncate max-w-[200px]">{{ playerStore.currentTrack?.title || '未播放' }}</p>
                  <p class="text-white/50 text-xs truncate max-w-[180px]">{{ playerStore.currentTrack?.artist || '-' }}</p>
                </div>
              </div>
              <div class="flex-1 w-full overflow-y-auto text-center px-6">
                <div v-if="playerStore.currentTrack?.lrc" class="space-y-4 py-4">
                  <p
                    v-for="(line, idx) in parseLyrics(playerStore.currentTrack.lrc)"
                    :key="idx"
                    :class="['transition-all duration-300 leading-relaxed', isCurrentLyricLine(line.time) ? 'text-white text-lg font-medium' : 'text-white/40 text-base']"
                  >
                    {{ line.text || '♪' }}
                  </p>
                </div>
                <div v-else class="flex flex-col items-center justify-center h-full text-white/30">
                  <p class="text-4xl mb-3">🎵</p>
                  <p>暂无歌词</p>
                </div>
              </div>
              <p class="py-3 text-white/30 text-xs flex-shrink-0">点击返回唱片</p>
            </div>
          </Transition>
        </div>

        <!-- 底部播放控制 -->
        <div class="w-full px-6 pb-4 flex-shrink-0 bg-gradient-to-t from-black/20 to-transparent pt-4">
          <div class="flex items-center gap-3 mb-4">
            <span class="text-white/50 text-xs w-10 text-right font-mono">{{ formatTime(playerStore.currentTime) }}</span>
            <div class="flex-1 h-1 bg-white/20 rounded-full overflow-hidden">
              <div class="h-full bg-white rounded-full transition-all duration-100" :style="{ width: `${playerStore.progress}%` }"></div>
            </div>
            <span class="text-white/50 text-xs w-10 font-mono">{{ formatTime(playerStore.duration) }}</span>
          </div>
          <div class="flex items-center justify-center gap-8">
            <button @click.stop="playerStore.togglePlayMode()" class="w-8 h-8 flex items-center justify-center text-white/50 hover:text-white transition-colors">
              <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>
            </button>
            <button @click.stop="playPrevInPlaylist" :disabled="currentPlaylistIndex === 0" class="w-10 h-10 flex items-center justify-center text-white/70 hover:text-white disabled:opacity-30 transition-colors">
              <svg class="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
            </button>
            <button @click.stop="playerStore.togglePlay()" class="w-16 h-16 rounded-full border-2 border-white/80 flex items-center justify-center text-white hover:border-white hover:scale-105 transition-all">
              <svg v-if="playerStore.isPlaying" class="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
              <svg v-else class="w-8 h-8 ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
            </button>
            <button @click.stop="playNextInPlaylist" :disabled="currentPlaylistIndex >= playlistTracks.length - 1" class="w-10 h-10 flex items-center justify-center text-white/70 hover:text-white disabled:opacity-30 transition-colors">
              <svg class="w-8 h-8" fill="currentColor" viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
            </button>
            <button @click.stop class="w-8 h-8 flex items-center justify-center text-white/50 hover:text-white transition-colors">
              <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/></svg>
            </button>
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
