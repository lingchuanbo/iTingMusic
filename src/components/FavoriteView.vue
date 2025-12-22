<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { usePlayerStore } from '@/store/player'
import { formatTime } from '@/utils/formatTime'
import type { Track } from '@/types'

const store = usePlayerStore()

const FAVORITES_KEY = 'favorites'
const FAVORITES_DATA_KEY = 'favorites_data'

// 喜欢的歌曲列表（完整数据）
const favorites = ref<Track[]>([])

// 多选模式
const isSelectMode = ref(false)
const selectedIds = ref<Set<string>>(new Set())
let longPressTimer: number | null = null

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
function handleLongPressStart(track: Track) {
  longPressTimer = window.setTimeout(() => {
    isSelectMode.value = true
    selectedIds.value.add(track.id)
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

const selectedCount = computed(() => selectedIds.value.size)

function toggleFavorite(id: string) {
  const idx = favorites.value.findIndex(t => t.id === id)
  if (idx >= 0) {
    favorites.value.splice(idx, 1)
    saveFavoritesData()
  }
}

function playSong(track: Track) {
  let idx = store.playlist.findIndex(t => t.id === track.id)
  if (idx < 0) {
    store.addTrack(track)
    idx = store.playlist.length - 1
  }
  store.playTrack(idx)
}
</script>

<template>
  <div class="flex-1 overflow-y-auto p-6">
    <!-- 标题栏 -->
    <div class="flex items-center justify-between mb-6">
      <h2 class="text-2xl font-bold text-white">❤️ 我的喜爱</h2>
      <span v-if="!isSelectMode && favorites.length > 0" class="text-white/40 text-sm">长按多选</span>
    </div>

    <!-- 多选操作栏 -->
    <div v-if="isSelectMode" class="flex items-center justify-between mb-4 p-3 rounded-xl bg-purple-600/20 border border-purple-500/30">
      <div class="flex items-center gap-3">
        <button @click="exitSelectMode" class="text-white/60 hover:text-white">✕</button>
        <span class="text-white">已选 {{ selectedCount }} 首</span>
      </div>
      <div class="flex items-center gap-2">
        <button @click="toggleSelectAll" class="px-3 py-1.5 rounded-lg bg-white/10 text-white text-sm hover:bg-white/20">
          {{ selectedIds.size === favorites.length ? '取消全选' : '全选' }}
        </button>
        <button @click="batchPlay" :disabled="selectedCount === 0" class="px-3 py-1.5 rounded-lg bg-purple-600 text-white text-sm hover:bg-purple-500 disabled:opacity-50">
          播放
        </button>
        <button @click="batchAddToPlaylist" :disabled="selectedCount === 0" class="px-3 py-1.5 rounded-lg bg-white/10 text-white text-sm hover:bg-white/20 disabled:opacity-50">
          加入列表
        </button>
        <button @click="batchRemove" :disabled="selectedCount === 0" class="px-3 py-1.5 rounded-lg bg-red-600/80 text-white text-sm hover:bg-red-500 disabled:opacity-50">
          移除
        </button>
      </div>
    </div>

    <div v-if="favorites.length === 0" class="text-center py-20">
      <p class="text-4xl mb-4">💔</p>
      <p class="text-white/50">还没有收藏的歌曲</p>
      <p class="text-white/30 text-sm mt-2">在播放列表中点击 ❤️ 收藏歌曲</p>
    </div>

    <div v-else class="space-y-2">
      <div
        v-for="track in favorites"
        :key="track.id"
        :class="[
          'flex items-center gap-4 p-3 rounded-xl group cursor-pointer transition-colors',
          selectedIds.has(track.id) ? 'bg-purple-600/30' : 'hover:bg-white/10'
        ]"
        @click="handleClick(track)"
        @mousedown="handleLongPressStart(track)"
        @mouseup="handleLongPressEnd"
        @mouseleave="handleLongPressEnd"
        @touchstart.passive="handleLongPressStart(track)"
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
        <div class="w-12 h-12 rounded-lg overflow-hidden bg-white/10 flex-shrink-0">
          <img v-if="track.cover" :src="track.cover" :alt="track.title" class="w-full h-full object-cover" />
          <div v-else class="w-full h-full flex items-center justify-center text-2xl">🎵</div>
        </div>

        <!-- 信息 -->
        <div class="flex-1 min-w-0">
          <p class="text-white font-medium truncate">{{ track.title }}</p>
          <p class="text-white/50 text-sm truncate">{{ track.artist }}</p>
        </div>

        <!-- 取消收藏 -->
        <button v-if="!isSelectMode" @click.stop="toggleFavorite(track.id)" class="text-red-400 hover:scale-110 transition-transform">
          ❤️
        </button>

        <!-- 时长 -->
        <span class="text-white/40 text-sm">{{ track.duration ? formatTime(track.duration) : '--:--' }}</span>
      </div>
    </div>
  </div>
</template>
