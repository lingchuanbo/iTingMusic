<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { usePlayerStore } from '@/store/player'
import { usePlaylistStore } from '@/store/playlist'
import { setSelectMode, setModalOpen } from '@/store/ui'

import { formatTime } from '@/utils/formatTime'
import type { Track } from '@/types'
import PlaylistPickerDialog from '@/components/common/PlaylistPickerDialog.vue'

const store = usePlayerStore()
const playlistStore = usePlaylistStore()

const FAVORITES_KEY = 'favorites'
const FAVORITES_DATA_KEY = 'favorites_data'

// 喜欢的歌曲列表（完整数据）
const favorites = ref<Track[]>([])

// 多选模式
const isSelectMode = ref(false)
const selectedIds = ref<Set<string>>(new Set())
let longPressTimer: number | null = null
let touchStartPos = { x: 0, y: 0 }
const LONG_PRESS_MOVE_THRESHOLD = 10 // 移动超过10px则取消长按

// 同步多选状态到全局
watch(isSelectMode, (val) => setSelectMode(val))

// 歌单选择弹窗
const pendingPlaylistTracks = ref<Track[]>([])



// 视图模式: 'list' 列表视图, 'grid' 网格视图
const viewMode = ref<'list' | 'grid'>(
  (localStorage.getItem('favorites_view_mode') as 'list' | 'grid') || 'list'
)

function setViewMode(mode: 'list' | 'grid') {
  viewMode.value = mode
  localStorage.setItem('favorites_view_mode', mode)
}

// 加载喜欢的歌曲
function loadFavorites() {
  try {
    const dataStr = localStorage.getItem(FAVORITES_DATA_KEY)
    if (dataStr) {
      favorites.value = JSON.parse(dataStr)
      return
    }
    const ids = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]')
    if (ids.length > 0) {
      favorites.value = store.playlist.filter(t => ids.includes(t.id))
      saveFavoritesData()
    }
  } catch (e) {
    console.error('加载收藏失败:', e)
  }
}

function saveFavoritesData() {
  try {
    localStorage.setItem(FAVORITES_DATA_KEY, JSON.stringify(favorites.value))
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites.value.map(t => t.id)))
  } catch (e) {
    console.error('保存收藏失败:', e)
  }
}

onMounted(loadFavorites)

// 长按开始
function handleLongPressStart(track: Track, event?: TouchEvent | MouseEvent) {
  // 记录触摸开始位置
  if (event && 'touches' in event) {
    touchStartPos = { x: event.touches[0].clientX, y: event.touches[0].clientY }
  } else if (event && 'clientX' in event) {
    touchStartPos = { x: event.clientX, y: event.clientY }
  }
  
  longPressTimer = window.setTimeout(() => {
    isSelectMode.value = true
    selectedIds.value.add(track.id)
  }, 500)
}

// 触摸移动时检测是否取消长按
function handleLongPressMove(event: TouchEvent) {
  if (!longPressTimer) return
  
  const touch = event.touches[0]
  const dx = Math.abs(touch.clientX - touchStartPos.x)
  const dy = Math.abs(touch.clientY - touchStartPos.y)
  
  // 如果移动超过阈值，取消长按
  if (dx > LONG_PRESS_MOVE_THRESHOLD || dy > LONG_PRESS_MOVE_THRESHOLD) {
    handleLongPressEnd()
  }
}

// 长按结束
function handleLongPressEnd() {
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
}

// 点击处理
function handleClick(track: Track) {
  if (isSelectMode.value) {
    toggleSelect(track.id)
  } else {
    playSong(track)
  }
}

// 切换选中
function toggleSelect(id: string) {
  if (selectedIds.value.has(id)) {
    selectedIds.value.delete(id)
  } else {
    selectedIds.value.add(id)
  }
  // 如果没有选中项，退出多选模式
  if (selectedIds.value.size === 0) {
    isSelectMode.value = false
  }
}

// 全选/取消全选
function toggleSelectAll() {
  if (selectedIds.value.size === favorites.value.length) {
    selectedIds.value.clear()
  } else {
    favorites.value.forEach(t => selectedIds.value.add(t.id))
  }
}

// 退出多选模式
function exitSelectMode() {
  isSelectMode.value = false
  selectedIds.value.clear()
}

// 批量删除
function batchRemove() {
  if (selectedIds.value.size === 0) return
  favorites.value = favorites.value.filter(t => !selectedIds.value.has(t.id))
  saveFavoritesData()
  exitSelectMode()
}

// 删除单首歌曲
function removeFavorite(trackId: string) {
  favorites.value = favorites.value.filter(t => t.id !== trackId)
  saveFavoritesData()
}

// 批量添加到播放列表
function batchAddToPlaylist() {
  const selected = favorites.value.filter(t => selectedIds.value.has(t.id))
  selected.forEach(track => {
    if (!store.playlist.some(t => t.id === track.id)) {
      store.addTrack(track)
    }
  })
  exitSelectMode()
}

// 批量播放
function batchPlay() {
  const selected = favorites.value.filter(t => selectedIds.value.has(t.id))
  if (selected.length === 0) return
  selected.forEach((track, idx) => {
    if (!store.playlist.some(t => t.id === track.id)) {
      store.addTrack(track)
    }
    if (idx === 0) {
      const playIdx = store.playlist.findIndex(t => t.id === track.id)
      if (playIdx >= 0) store.playTrack(playIdx)
    }
  })
  exitSelectMode()
}

// 打开歌单选择弹窗
function openPlaylistPicker(track?: Track) {
  if (track) {
    pendingPlaylistTracks.value = [track]
  } else {
    if (selectedIds.value.size === 0) return
    pendingPlaylistTracks.value = favorites.value.filter(t => selectedIds.value.has(t.id))
  }
  showPlaylistPicker.value = true
}

// 确认添加到歌单 (替换原 addToPlaylist)
function confirmAddToPlaylist(playlistId: string) {
  if (pendingPlaylistTracks.value.length === 0) return
  
  pendingPlaylistTracks.value.forEach(track => {
    playlistStore.addToPlaylist(playlistId, track.id)
    // 确保歌曲数据在播放列表中（歌单只存储ID）
    if (!store.playlist.some(t => t.id === track.id)) {
      store.addTrack(track)
    }
  })
  
  showPlaylistPicker.value = false
  pendingPlaylistTracks.value = []
  exitSelectMode()
}

// 在选择器中创建新歌单
function handleCreatePlaylist() {
  const name = prompt('请输入新歌单名称', `我的歌单 ${playlistStore.playlists.length + 1}`)
  if (name && name.trim()) {
    const playlist = playlistStore.createPlaylist(name.trim())
    if (pendingPlaylistTracks.value.length > 0) {
      confirmAddToPlaylist(playlist.id)
    } else {
      showPlaylistPicker.value = false
    }
  }
}


const selectedCount = computed(() => selectedIds.value.size)

function playSong(track: Track) {
  let idx = store.playlist.findIndex(t => t.id === track.id)
  if (idx < 0) {
    store.addTrack(track)
    idx = store.playlist.length - 1
  }
  store.playTrack(idx)
}

const showPlaylistPicker = ref(false)
const showPlayMenu = ref(false)

// 监听弹窗状态
watch([showPlaylistPicker, showPlayMenu], ([picker, menu]) => {
  setModalOpen(picker || menu)
})


function playAllReplace() {
  if (favorites.value.length === 0) return
  store.clearPlaylist()
  favorites.value.forEach(track => store.addTrack(track))
  if (store.playlist.length > 0) store.playTrack(0)
  showPlayMenu.value = false
}

function playAllAdd() {
  if (favorites.value.length === 0) return
  let firstNewIdx = -1
  favorites.value.forEach((track, idx) => {
    const existIdx = store.playlist.findIndex(t => t.id === track.id)
    if (existIdx < 0) {
      store.addTrack(track)
      if (firstNewIdx < 0) firstNewIdx = store.playlist.length - 1
    } else if (idx === 0 && firstNewIdx < 0) {
      firstNewIdx = existIdx
    }
  })
  if (firstNewIdx >= 0) store.playTrack(firstNewIdx)
  showPlayMenu.value = false
}

</script>

<template>
  <div class="flex-1 p-6 pb-24 md:pb-28 flex flex-col h-full overflow-hidden relative">
    <!-- 标题栏 -->
    <div class="flex-shrink-0">


      <div class="flex items-center justify-between mb-6">

      <h2 class="text-2xl font-bold text-white">
        我的喜爱
        <span class="text-white/40 text-base font-normal ml-2">{{ favorites.length }} 首</span>
      </h2>
      <div class="flex items-center gap-2">


        <!-- 视图切换按钮 -->
        <div v-if="favorites.length > 0" class="flex gap-1 bg-white/5 rounded-lg p-1">
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
        </div>
      </div>
    </div>
  </div>

    <!-- 列表容器 -->
    <div class="flex-1 overflow-y-auto space-y-2 mt-2 relative">
      <!-- 底部渐变遮罩 -->
      <div class="pointer-events-none fixed bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-neutral-900 via-neutral-900/80 to-transparent z-20 md:hidden"></div>



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
              {{ selectedIds.size === favorites.length ? '取消全选' : '全选' }}
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
            <button @click="batchAddToPlaylist" :disabled="selectedCount === 0" class="flex flex-col items-center gap-1 px-4 py-1.5 rounded-xl hover:bg-white/5 disabled:opacity-40 transition-colors group">
              <div class="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center group-hover:bg-green-600/20 transition-colors">
                <svg class="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg>
              </div>
              <span class="text-white/70 text-xs">列表</span>
            </button>
            <button @click="openPlaylistPicker()" :disabled="selectedCount === 0" class="flex flex-col items-center gap-1 px-4 py-1.5 rounded-xl hover:bg-white/5 disabled:opacity-40 transition-colors group">
              <div class="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center group-hover:bg-blue-600/20 transition-colors">
                <svg class="w-5 h-5 text-blue-400" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 4v16m8-8H4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
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

    <div v-if="favorites.length === 0" class="text-center py-20">
      <p class="text-4xl mb-4">💔</p>
      <p class="text-white/50">还没有收藏的歌曲</p>
      <p class="text-white/30 text-sm mt-2">在播放列表中点击 ❤️ 收藏歌曲</p>
    </div>

    <!-- 列表视图 -->
    <div v-else-if="viewMode === 'list'" class="space-y-2">
      <div
        v-for="track in favorites"
        :key="track.id"
        :class="[
          'group flex items-center gap-4 p-3 rounded-xl cursor-pointer transition-all duration-200',
          selectedIds.has(track.id) ? 'bg-purple-600/30' : store.currentTrack?.id === track.id ? 'bg-white/20' : 'hover:bg-white/10'
        ]"
        @click="handleClick(track)"
        @mousedown="handleLongPressStart(track, $event)"
        @mouseup="handleLongPressEnd"
        @mouseleave="handleLongPressEnd"
        @touchstart.passive="handleLongPressStart(track, $event)"
        @touchmove.passive="handleLongPressMove"
        @touchend="handleLongPressEnd"
        @touchcancel="handleLongPressEnd"
      >
        <!-- 多选框 -->
        <div v-if="isSelectMode" class="w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0"
          :class="selectedIds.has(track.id) ? 'bg-purple-600 border-purple-600' : 'border-white/30'">
          <svg v-if="selectedIds.has(track.id)" class="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
          </svg>
        </div>

        <!-- 封面 -->
        <div class="relative w-12 h-12 rounded-lg overflow-hidden bg-white/10 flex-shrink-0">
          <img v-if="track.cover" :src="track.cover" :alt="track.title" class="w-full h-full object-cover" />
          <div v-else class="w-full h-full flex items-center justify-center text-2xl">🎵</div>
          <div v-if="store.currentTrack?.id === track.id && store.isPlaying" class="absolute inset-0 bg-black/40 flex items-center justify-center">
            <div class="flex gap-0.5">
              <span class="w-1 h-4 bg-white rounded animate-pulse"></span>
              <span class="w-1 h-4 bg-white rounded animate-pulse" style="animation-delay: 0.2s"></span>
              <span class="w-1 h-4 bg-white rounded animate-pulse" style="animation-delay: 0.4s"></span>
            </div>
          </div>
        </div>

        <!-- 信息 -->
        <div class="flex-1 min-w-0">
          <p class="text-white font-medium truncate">{{ track.title }}</p>
          <p class="text-white/50 text-sm truncate">{{ track.artist }}</p>
        </div>

        <!-- 时长 -->
        <span class="text-white/40 text-sm hidden sm:inline">{{ track.duration ? formatTime(track.duration) : '--:--' }}</span>

        <!-- 添加到歌单按钮 (仅当前歌曲显示) -->
        <button
          v-if="!isSelectMode && store.currentTrack?.id === track.id"
          @click.stop="openPlaylistPicker(track)"
          class="w-6 h-6 flex items-center justify-center text-white/30 hover:text-white hover:bg-white/20 rounded-full transition-colors"
          title="添加到歌单"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
        </button>

        <!-- 删除按钮 (仅当前歌曲显示) -->
        <button
          v-if="!isSelectMode && store.currentTrack?.id === track.id"
          @click.stop="removeFavorite(track.id)"
          class="w-6 h-6 flex items-center justify-center text-white/30 hover:text-white hover:bg-red-500/50 rounded-full transition-colors"
          title="从喜欢中移除"
        >
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>
    </div>


    <!-- 网格视图 -->
    <div v-else class="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 md:gap-4">
      <div
        v-for="track in favorites"
        :key="track.id"
        @click="handleClick(track)"
        @mousedown="handleLongPressStart(track, $event)"
        @mouseup="handleLongPressEnd"
        @mouseleave="handleLongPressEnd"
        @touchstart.passive="handleLongPressStart(track, $event)"
        @touchmove.passive="handleLongPressMove"
        @touchend="handleLongPressEnd"
        @touchcancel="handleLongPressEnd"
        :class="[
          'group cursor-pointer rounded-lg md:rounded-xl p-1.5 md:p-3 transition-colors',
          selectedIds.has(track.id) ? 'bg-purple-600/30' : store.currentTrack?.id === track.id ? 'bg-purple-600/30' : 'hover:bg-white/10'
        ]"
      >
        <div class="relative aspect-square rounded-md md:rounded-lg overflow-hidden bg-white/10 mb-1.5 md:mb-3">
          <img
            v-if="track.cover"
            :src="track.cover"
            class="w-full h-full object-cover"
          />
          <div v-else class="w-full h-full flex items-center justify-center text-2xl md:text-4xl bg-gradient-to-br from-purple-600/50 to-pink-600/50">
            🎵
          </div>
          <!-- 多选框 -->
          <div v-if="isSelectMode" class="absolute top-1 left-1 md:top-2 md:left-2 w-5 h-5 md:w-6 md:h-6 rounded-full border-2 flex items-center justify-center"
            :class="selectedIds.has(track.id) ? 'bg-purple-600 border-purple-600' : 'bg-black/40 border-white/50'">
            <svg v-if="selectedIds.has(track.id)" class="w-3 h-3 md:w-4 md:h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
            </svg>
          </div>
          <!-- 播放状态指示 -->
          <div v-if="store.currentTrack?.id === track.id && !isSelectMode" class="absolute inset-0 bg-black/40 flex items-center justify-center">
            <div class="w-8 h-8 md:w-12 md:h-12 rounded-full bg-purple-600 flex items-center justify-center">
              <span v-if="store.isPlaying" class="text-white text-sm md:text-lg">▶</span>
              <span v-else class="text-white text-sm md:text-lg">⏸</span>
            </div>
          </div>
          <!-- 悬浮操作按钮 -->
          <div v-else-if="!isSelectMode" class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
            <div @click.stop="playSong(track)" class="w-10 h-10 md:w-12 md:h-12 rounded-full bg-purple-600 flex items-center justify-center hover:scale-110 active:scale-95 transition-transform">
              <span class="text-white text-sm md:text-lg">▶</span>
            </div>
            <div @click.stop="openPlaylistPicker(track)" class="w-10 h-10 md:w-12 md:h-12 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center hover:bg-white/30 hover:scale-110 active:scale-95 transition-all">
              <svg class="w-5 h-5 md:w-6 md:h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
            </div>
          </div>
        </div>
        <p class="text-white text-xs md:text-sm font-medium truncate">{{ track.title }}</p>
        <p class="text-white/50 text-[10px] md:text-xs truncate">{{ track.artist }}</p>
      </div>
    </div>
  </div>


    <!-- 歌单选择弹窗 -->
    <PlaylistPickerDialog
      :visible="showPlaylistPicker"
      @close="showPlaylistPicker = false"
      @select="confirmAddToPlaylist"
      @create="handleCreatePlaylist"
    />


    <!-- 播放菜单弹窗 -->
    <Transition name="fade">
      <div v-if="showPlayMenu" class="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" @click.self="showPlayMenu = false">
        <div class="w-full max-w-md bg-stone-900 rounded-t-3xl overflow-hidden shadow-2xl">
          <div class="px-4 py-3 border-b border-white/5 flex items-center justify-between">
            <span class="text-white font-medium">播放选项</span>
            <button @click="showPlayMenu = false" class="text-white/40 hover:text-white">✕</button>
          </div>
          <div class="p-4 space-y-3 pb-safe-bottom">
            <button @click="playAllReplace" class="w-full flex items-center gap-4 p-4 rounded-2xl bg-white/5 hover:bg-white/10 transition-all text-left group">
              <div class="w-12 h-12 rounded-full bg-purple-600/20 flex items-center justify-center group-hover:bg-purple-600/30 transition-colors">
                <svg class="w-6 h-6 text-purple-400" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
              </div>
              <div>
                <p class="text-white font-medium">替换当前列表</p>
                <p class="text-white/40 text-xs mt-1">清空当前播放队列并播放所有收藏歌曲</p>
              </div>
            </button>
            <button @click="playAllAdd" class="w-full flex items-center gap-4 p-4 rounded-2xl bg-white/5 hover:bg-white/10 transition-all text-left group">
              <div class="w-12 h-12 rounded-full bg-blue-600/20 flex items-center justify-center group-hover:bg-blue-600/30 transition-colors">
                <svg class="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
              </div>
              <div>
                <p class="text-white font-medium">加入当前列表</p>
                <p class="text-white/40 text-xs mt-1">将所有收藏歌曲添加到当前播放队列</p>
              </div>
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 播放全部浮动按钮 (移动端) -->
    <Transition name="fab">
      <button
        v-if="favorites.length > 0 && !isSelectMode && !showPlayMenu && !showPlaylistPicker"
        @click="showPlayMenu = true"

        class="fixed left-1/2 -translate-x-1/2 z-[70] h-12 px-6 rounded-full bg-gradient-to-br from-purple-600 to-pink-600 text-white shadow-lg shadow-purple-600/40 flex items-center justify-center gap-2 active:scale-95 hover:shadow-xl hover:shadow-purple-600/50 transition-all group md:hidden whitespace-nowrap"
        style="bottom: calc(3.5rem + 4rem + env(safe-area-inset-bottom, 0px) + 1rem)"
      >
        <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z"/>
        </svg>
        <span class="font-medium text-sm">播放全部</span>
      </button>
    </Transition>

    <!-- 播放全部按钮 (桌面端) -->
    <div v-if="favorites.length > 0 && !isSelectMode" class="hidden md:block absolute right-8 top-8 z-30">
      <button
        @click="showPlayMenu = true"
        class="flex-shrink-0 flex items-center gap-1.5 px-6 py-2.5 rounded-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-medium shadow-lg shadow-purple-900/30 hover:shadow-purple-600/40 hover:scale-105 active:scale-95 transition-all duration-200 whitespace-nowrap"
      >
        <svg class="w-5 h-5 fill-current" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        <span class="text-sm">播放全部</span>
      </button>
    </div>
  </div>
</template>


<style scoped>
/* 悬浮按钮动画 */
.fab-enter-active,
.fab-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}
.fab-enter-from,
.fab-leave-to {
  opacity: 0;
  transform: scale(0.8);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

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
