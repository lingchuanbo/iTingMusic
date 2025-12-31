<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { usePlayerStore } from '@/store/player'
import { usePlaylistStore } from '@/store/playlist'
import { setSelectMode } from '@/store/ui'
import { formatTime } from '@/utils/formatTime'
import { trackStorage } from '@/services/TrackStorage'
import DownloadButton from '@/components/DownloadButton.vue'

type ViewMode = 'list' | 'grid' | 'compact'

const store = usePlayerStore()
const playlistStore = usePlaylistStore()
const favoritesKey = ref(0)

// 添加到歌单弹窗
const showAddToPlaylist = ref(false)
const addingTrackId = ref<string | null>(null)
// 移动端不支持紧凑视图，自动切换到列表视图
const isMobile = typeof window !== 'undefined' && window.innerWidth < 768
const savedMode = (localStorage.getItem('playlistViewMode') as ViewMode) || 'list'
const viewMode = ref<ViewMode>(isMobile && savedMode === 'compact' ? 'list' : savedMode)

// 多选模式
const isSelectMode = ref(false)
const selectedIndexes = ref<Set<number>>(new Set())
let longPressTimer: number | null = null

// 同步多选状态到全局
watch(isSelectMode, (val) => setSelectMode(val))

// 长按开始
function handleLongPressStart(index: number) {
  longPressTimer = window.setTimeout(() => {
    isSelectMode.value = true
    selectedIndexes.value.add(index)
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
function handleClick(index: number) {
  if (isSelectMode.value) {
    toggleSelect(index)
  } else {
    playSong(index)
  }
}

// 切换选中
function toggleSelect(index: number) {
  if (selectedIndexes.value.has(index)) {
    selectedIndexes.value.delete(index)
  } else {
    selectedIndexes.value.add(index)
  }
  if (selectedIndexes.value.size === 0) {
    isSelectMode.value = false
  }
}

// 全选/取消全选
function toggleSelectAll() {
  if (selectedIndexes.value.size === store.playlist.length) {
    selectedIndexes.value.clear()
  } else {
    store.playlist.forEach((_, i) => selectedIndexes.value.add(i))
  }
}

// 退出多选模式
function exitSelectMode() {
  isSelectMode.value = false
  selectedIndexes.value.clear()
}

// 批量删除
function batchRemove() {
  if (selectedIndexes.value.size === 0) return
  const indexes = Array.from(selectedIndexes.value).sort((a, b) => b - a)
  indexes.forEach(idx => {
    store.playlist.splice(idx, 1)
    if (store.currentIndex === idx) {
      store.currentIndex = -1
    } else if (store.currentIndex > idx) {
      store.currentIndex--
    }
  })
  exitSelectMode()
}

// 批量添加到喜欢
function batchAddToFavorite() {
  const ids = JSON.parse(localStorage.getItem('favorites') || '[]')
  const favData = JSON.parse(localStorage.getItem('favorites_data') || '[]')
  selectedIndexes.value.forEach(idx => {
    const track = store.playlist[idx]
    if (track && !ids.includes(track.id)) {
      ids.push(track.id)
      if (!favData.some((t: any) => t.id === track.id)) {
        favData.push(track)
      }
    }
  })
  localStorage.setItem('favorites', JSON.stringify(ids))
  localStorage.setItem('favorites_data', JSON.stringify(favData))
  favoritesKey.value++
  exitSelectMode()
}

// 批量播放
function batchPlay() {
  const indexes = Array.from(selectedIndexes.value).sort((a, b) => a - b)
  if (indexes.length > 0) {
    store.playTrack(indexes[0])
  }
  exitSelectMode()
}

// 歌单选择弹窗（批量添加）
const showPlaylistPicker = ref(false)
const newPlaylistName = ref('')

// 打开歌单选择弹窗（批量）
function openPlaylistPicker() {
  if (selectedIndexes.value.size === 0) return
  showPlaylistPicker.value = true
}

// 批量添加到指定歌单
function batchAddToPlaylist(playlistId: string) {
  selectedIndexes.value.forEach(idx => {
    const track = store.playlist[idx]
    if (track) {
      trackStorage.saveTrack(track)
      playlistStore.addToPlaylist(playlistId, track.id)
    }
  })
  showPlaylistPicker.value = false
  exitSelectMode()
}

// 创建新歌单并批量添加
function createAndAddToPlaylist() {
  if (!newPlaylistName.value.trim()) return
  const playlist = playlistStore.createPlaylist(newPlaylistName.value.trim())
  batchAddToPlaylist(playlist.id)
  newPlaylistName.value = ''
}

const selectedCount = computed(() => selectedIndexes.value.size)

function setViewMode(mode: ViewMode) {
  viewMode.value = mode
  localStorage.setItem('playlistViewMode', mode)
}

function playSong(index: number) {
  store.playTrack(index)
}

function isFavorite(id: string) {
  const ids = JSON.parse(localStorage.getItem('favorites') || '[]')
  return ids.includes(id)
}

function toggleFavorite(id: string) {
  const ids = JSON.parse(localStorage.getItem('favorites') || '[]')
  const favData = JSON.parse(localStorage.getItem('favorites_data') || '[]')
  const idx = ids.indexOf(id)
  if (idx >= 0) {
    ids.splice(idx, 1)
    const dataIdx = favData.findIndex((t: any) => t.id === id)
    if (dataIdx >= 0) favData.splice(dataIdx, 1)
  } else {
    ids.push(id)
    // 保存完整歌曲数据
    const track = store.playlist.find(t => t.id === id)
    if (track && !favData.some((t: any) => t.id === id)) {
      favData.push(track)
    }
  }
  localStorage.setItem('favorites', JSON.stringify(ids))
  localStorage.setItem('favorites_data', JSON.stringify(favData))
  favoritesKey.value++
}

function removeTrack(index: number) {
  store.removeTrack(index)
}

// 添加到歌单
function openAddToPlaylist(trackId: string) {
  addingTrackId.value = trackId
  showAddToPlaylist.value = true
}

function addToPlaylist(playlistId: string) {
  if (addingTrackId.value) {
    // 保存歌曲数据到 trackStorage
    const track = store.playlist.find(t => t.id === addingTrackId.value)
    if (track) {
      trackStorage.saveTrack(track)
    }
    playlistStore.addToPlaylist(playlistId, addingTrackId.value)
  }
  showAddToPlaylist.value = false
  addingTrackId.value = null
}

function createAndAdd() {
  const name = prompt('输入新歌单名称')
  if (name && addingTrackId.value) {
    // 保存歌曲数据到 trackStorage
    const track = store.playlist.find(t => t.id === addingTrackId.value)
    if (track) {
      trackStorage.saveTrack(track)
    }
    const pl = playlistStore.createPlaylist(name)
    playlistStore.addToPlaylist(pl.id, addingTrackId.value)
  }
  showAddToPlaylist.value = false
  addingTrackId.value = null
}

// 清空播放列表
const showClearConfirm = ref(false)

function clearPlaylist() {
  store.clearPlaylist()
  showClearConfirm.value = false
}
</script>

<template>
  <div class="flex-1 overflow-y-auto p-6">
    <!-- 标题栏 + 视图切换 -->
    <div class="flex items-center justify-between mb-6">
      <h2 class="text-2xl font-bold text-white">
        播放列表
        <span class="text-white/40 text-base font-normal ml-2">{{ store.playlist.length }} 首</span>
      </h2>

      <div class="flex items-center gap-2">
        <!-- 清空按钮 -->
        <button
          v-if="!isSelectMode && store.playlist.length > 0"
          @click="showClearConfirm = true"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white/50 hover:text-red-400 hover:bg-red-500/10 transition-all text-sm"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
          </svg>
          <span class="hidden sm:inline">清空</span>
        </button>
        <span v-if="!isSelectMode && store.playlist.length > 0" class="text-white/40 text-sm hidden md:block">长按多选</span>
        <!-- 视图切换按钮 -->
        <div class="flex gap-1 bg-white/5 rounded-lg p-1">
          <button
            @click="setViewMode('list')"
            :class="['px-3 py-1.5 rounded text-sm transition-colors', viewMode === 'list' ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white']"
            title="列表视图"
          >
            ☰
          </button>
          <button
            @click="setViewMode('grid')"
            :class="['px-3 py-1.5 rounded text-sm transition-colors', viewMode === 'grid' ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white']"
            title="网格视图"
          >
            ▦
          </button>
          <button
            @click="setViewMode('compact')"
            :class="['hidden md:block px-3 py-1.5 rounded text-sm transition-colors', viewMode === 'compact' ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white']"
            title="紧凑视图"
          >
            ≡
          </button>
        </div>
      </div>
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
              {{ selectedIndexes.size === store.playlist.length ? '取消全选' : '全选' }}
            </button>
          </div>
          <!-- 操作按钮 -->
          <div class="flex items-center justify-around py-3 px-2">
            <button @click="batchPlay" :disabled="selectedCount === 0" class="flex flex-col items-center gap-1 px-4 py-1.5 rounded-xl hover:bg-white/5 disabled:opacity-40 transition-colors group">
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
            <button @click="batchRemove" :disabled="selectedCount === 0" class="flex flex-col items-center gap-1 px-4 py-1.5 rounded-xl hover:bg-white/5 disabled:opacity-40 transition-colors group">
              <div class="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center group-hover:bg-red-600/20 transition-colors">
                <svg class="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </div>
              <span class="text-white/70 text-xs">移除</span>
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 空状态 -->
    <div v-if="store.playlist.length === 0" class="text-white/50 text-center py-20">
      <p class="text-4xl mb-4">🎵</p>
      <p>暂无歌曲，添加一些音乐吧</p>
    </div>

    <!-- 列表视图 -->
    <div v-else-if="viewMode === 'list'" class="space-y-2">
      <div
        v-for="(track, index) in store.playlist"
        :key="track.id"
        @click="handleClick(index)"
        @mousedown="handleLongPressStart(index)"
        @mouseup="handleLongPressEnd"
        @mouseleave="handleLongPressEnd"
        @touchstart.passive="handleLongPressStart(index)"
        @touchend="handleLongPressEnd"
        @touchcancel="handleLongPressEnd"
        :class="[
          'group flex items-center gap-4 p-3 rounded-xl cursor-pointer transition-all duration-200',
          selectedIndexes.has(index) ? 'bg-purple-600/30' : store.currentIndex === index ? 'bg-white/20' : 'hover:bg-white/10'
        ]"
      >
        <!-- 多选框 -->
        <div v-if="isSelectMode" class="w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0"
          :class="selectedIndexes.has(index) ? 'bg-purple-600 border-purple-600' : 'border-white/30'">
          <svg v-if="selectedIndexes.has(index)" class="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
          </svg>
        </div>
        <div class="relative w-12 h-12 rounded-lg overflow-hidden bg-white/10 flex-shrink-0">
          <img v-if="track.cover" :src="track.cover" :alt="track.title" class="w-full h-full object-cover" />
          <div v-else class="w-full h-full flex items-center justify-center text-2xl">🎵</div>
          <div v-if="store.currentIndex === index && store.isPlaying" class="absolute inset-0 bg-black/40 flex items-center justify-center">
            <div class="flex gap-0.5">
              <span class="w-1 h-4 bg-white rounded animate-pulse"></span>
              <span class="w-1 h-4 bg-white rounded animate-pulse" style="animation-delay: 0.2s"></span>
              <span class="w-1 h-4 bg-white rounded animate-pulse" style="animation-delay: 0.4s"></span>
            </div>
          </div>
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-white font-medium truncate">{{ track.title }}</p>
          <p class="text-white/50 text-sm truncate">{{ track.artist }}</p>
        </div>
        <span class="text-white/40 text-sm hidden sm:inline">{{ track.duration ? formatTime(track.duration) : '--:--' }}</span>
        <!-- 下载按钮 -->
        <DownloadButton v-if="!isSelectMode && track.source === 'online'" :track="track" size="sm" />
        <!-- 更多操作按钮（长按进入多选） -->
        <button
          v-if="!isSelectMode"
          @click.stop
          @mousedown="handleLongPressStart(index)"
          @mouseup="handleLongPressEnd"
          @mouseleave="handleLongPressEnd"
          @touchstart.passive="handleLongPressStart(index)"
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

    <!-- 网格视图 (多行网格布局) -->
    <div v-else-if="viewMode === 'grid'" class="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 md:gap-4">
      <div
        v-for="(track, index) in store.playlist"
        :key="track.id"
        @click="handleClick(index)"
        @mousedown="handleLongPressStart(index)"
        @mouseup="handleLongPressEnd"
        @mouseleave="handleLongPressEnd"
        @touchstart.passive="handleLongPressStart(index)"
        @touchend="handleLongPressEnd"
        @touchcancel="handleLongPressEnd"
        :class="[
          'group cursor-pointer rounded-lg md:rounded-xl p-1.5 md:p-3 transition-all duration-200',
          selectedIndexes.has(index) ? 'bg-purple-600/30' : store.currentIndex === index ? 'bg-purple-600/30' : 'hover:bg-white/10'
        ]"
      >
        <div class="relative aspect-square rounded-md md:rounded-lg overflow-hidden bg-white/10 mb-1.5 md:mb-3">
          <img v-if="track.cover" :src="track.cover" :alt="track.title" class="w-full h-full object-cover" />
          <div v-else class="w-full h-full flex items-center justify-center text-2xl md:text-4xl bg-gradient-to-br from-purple-600/50 to-pink-600/50">🎵</div>
          <!-- 多选框 -->
          <div v-if="isSelectMode" class="absolute top-1 left-1 md:top-2 md:left-2 w-5 h-5 md:w-6 md:h-6 rounded-full border-2 flex items-center justify-center"
            :class="selectedIndexes.has(index) ? 'bg-purple-600 border-purple-600' : 'bg-black/40 border-white/50'">
            <svg v-if="selectedIndexes.has(index)" class="w-3 h-3 md:w-4 md:h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
            </svg>
          </div>
          <!-- 播放指示器 -->
          <div v-if="!isSelectMode && store.currentIndex === index" class="absolute inset-0 bg-black/40 flex items-center justify-center">
            <div class="w-8 h-8 md:w-12 md:h-12 rounded-full bg-purple-600 flex items-center justify-center">
              <span v-if="store.isPlaying" class="text-white text-sm md:text-lg">▶</span>
              <span v-else class="text-white text-sm md:text-lg">⏸</span>
            </div>
          </div>
          <!-- 悬浮操作 -->
          <div v-if="!isSelectMode && store.currentIndex !== index" class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1 md:gap-2">
            <button @click.stop="openAddToPlaylist(track.id)" class="w-6 h-6 md:w-8 md:h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 text-xs md:text-base" title="添加到歌单">
              ➕
            </button>
            <button @click.stop="toggleFavorite(track.id)" class="w-6 h-6 md:w-8 md:h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 text-xs md:text-base">
              {{ isFavorite(track.id) ? '❤️' : '🤍' }}
            </button>
            <button @click.stop="removeTrack(index)" class="w-6 h-6 md:w-8 md:h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-red-500/50 text-white/70 text-xs md:text-base">✕</button>
          </div>
          <!-- 序号 -->
          <div v-if="!isSelectMode" class="absolute top-1 left-1 md:top-2 md:left-2 w-5 h-5 md:w-6 md:h-6 rounded-full bg-black/60 flex items-center justify-center text-white text-[10px] md:text-xs">
            {{ index + 1 }}
          </div>
        </div>
        <p class="text-white text-xs md:text-sm font-medium truncate">{{ track.title }}</p>
        <p class="text-white/50 text-[10px] md:text-xs truncate">{{ track.artist }}</p>
      </div>
    </div>

    <!-- 紧凑视图 -->
    <div v-else-if="viewMode === 'compact'" class="space-y-0.5">
      <div
        v-for="(track, index) in store.playlist"
        :key="track.id"
        @click="handleClick(index)"
        @mousedown="handleLongPressStart(index)"
        @mouseup="handleLongPressEnd"
        @mouseleave="handleLongPressEnd"
        @touchstart.passive="handleLongPressStart(index)"
        @touchend="handleLongPressEnd"
        @touchcancel="handleLongPressEnd"
        :class="[
          'group flex items-center gap-3 px-3 py-1.5 rounded cursor-pointer transition-colors',
          selectedIndexes.has(index) ? 'bg-purple-600/30' : store.currentIndex === index ? 'bg-white/20' : 'hover:bg-white/10'
        ]"
      >
        <!-- 多选框 -->
        <div v-if="isSelectMode" class="w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0"
          :class="selectedIndexes.has(index) ? 'bg-purple-600 border-purple-600' : 'border-white/30'">
          <svg v-if="selectedIndexes.has(index)" class="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
          </svg>
        </div>
        <span v-if="!isSelectMode" class="w-6 text-white/30 text-xs text-right">{{ index + 1 }}</span>
        <span v-if="!isSelectMode && store.currentIndex === index && store.isPlaying" class="text-green-400 text-xs">▶</span>
        <span v-else-if="!isSelectMode" class="w-3"></span>
        <span class="flex-1 text-white text-sm truncate">{{ track.title }}</span>
        <span class="text-white/40 text-sm truncate max-w-32">{{ track.artist }}</span>
        <span class="text-white/30 text-xs w-10 text-right">{{ track.duration ? formatTime(track.duration) : '--:--' }}</span>
        <!-- 更多操作按钮（长按进入多选） -->
        <button
          v-if="!isSelectMode"
          @click.stop
          @mousedown="handleLongPressStart(index)"
          @mouseup="handleLongPressEnd"
          @mouseleave="handleLongPressEnd"
          @touchstart.passive="handleLongPressStart(index)"
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

    <!-- 添加到歌单弹窗 -->
    <Transition name="fade">
      <div
        v-if="showAddToPlaylist"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        @click.self="showAddToPlaylist = false"
      >
        <div class="bg-neutral-900 rounded-2xl p-4 w-72 border border-white/10 max-h-80 flex flex-col">
          <h3 class="text-white font-bold mb-3">添加到歌单</h3>
          
          <div class="flex-1 overflow-y-auto space-y-1 mb-3">
            <div
              v-if="playlistStore.playlists.length === 0"
              class="text-white/40 text-sm text-center py-4"
            >
              还没有歌单
            </div>
            <button
              v-for="pl in playlistStore.playlists"
              :key="pl.id"
              @click="addToPlaylist(pl.id)"
              class="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-white/10 text-left"
            >
              <span class="text-lg">📋</span>
              <span class="flex-1 text-white text-sm truncate">{{ pl.name }}</span>
              <span class="text-white/30 text-xs">{{ pl.trackIds.length }}首</span>
            </button>
          </div>
          
          <div class="flex gap-2">
            <button
              @click="createAndAdd"
              class="flex-1 h-9 rounded-lg bg-purple-600 text-white text-sm hover:bg-purple-500"
            >
              + 新建歌单
            </button>
            <button
              @click="showAddToPlaylist = false"
              class="px-4 h-9 rounded-lg bg-white/10 text-white text-sm hover:bg-white/20"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 批量添加到歌单弹窗 -->
    <Transition name="fade">
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
                v-model="newPlaylistName"
                type="text"
                placeholder="新建歌单..."
                class="flex-1 h-10 px-3 rounded-lg bg-white/10 text-white placeholder-white/40 outline-none focus:bg-white/15"
                @keyup.enter="createAndAddToPlaylist"
              />
              <button
                @click="createAndAddToPlaylist"
                :disabled="!newPlaylistName.trim()"
                class="px-4 rounded-lg bg-purple-600 text-white text-sm hover:bg-purple-500 disabled:opacity-50"
              >
                创建
              </button>
            </div>
          </div>
          
          <!-- 歌单列表 -->
          <div class="max-h-60 overflow-y-auto">
            <div v-if="playlistStore.playlists.length === 0" class="p-6 text-center text-white/40">
              暂无歌单，请先创建
            </div>
            <button
              v-for="pl in playlistStore.playlists"
              :key="pl.id"
              @click="batchAddToPlaylist(pl.id)"
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

    <!-- 清空确认弹窗 -->
    <Transition name="fade">
      <div 
        v-if="showClearConfirm"
        class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
        @click.self="showClearConfirm = false"
      >
        <div class="w-full max-w-xs bg-neutral-900 rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
          <!-- 图标 -->
          <div class="pt-6 pb-4 flex justify-center">
            <div class="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center">
              <svg class="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
              </svg>
            </div>
          </div>
          
          <!-- 文字 -->
          <div class="px-6 pb-4 text-center">
            <h3 class="text-white font-bold text-lg mb-2">清空播放列表？</h3>
            <p class="text-white/50 text-sm">将移除全部 {{ store.playlist.length }} 首歌曲，此操作无法撤销</p>
          </div>
          
          <!-- 按钮 -->
          <div class="p-4 flex gap-3 border-t border-white/5">
            <button
              @click="showClearConfirm = false"
              class="flex-1 h-11 rounded-xl bg-white/10 text-white font-medium hover:bg-white/15 transition-colors"
            >
              取消
            </button>
            <button
              @click="clearPlaylist"
              class="flex-1 h-11 rounded-xl bg-red-500 text-white font-medium hover:bg-red-400 transition-colors"
            >
              清空
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
</style>
