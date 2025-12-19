<script setup lang="ts">
import { ref } from 'vue'
import { usePlayerStore } from '@/store/player'
import { usePlaylistStore } from '@/store/playlist'
import { formatTime } from '@/utils/formatTime'

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

// 网格视图不再需要横向滚动相关功能，已改为多行网格布局

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
  const idx = ids.indexOf(id)
  if (idx >= 0) {
    ids.splice(idx, 1)
  } else {
    ids.push(id)
  }
  localStorage.setItem('favorites', JSON.stringify(ids))
  favoritesKey.value++
}

function removeTrack(index: number) {
  store.playlist.splice(index, 1)
  if (store.currentIndex === index) {
    store.currentIndex = -1
  } else if (store.currentIndex > index) {
    store.currentIndex--
  }
}

// 添加到歌单
function openAddToPlaylist(trackId: string) {
  addingTrackId.value = trackId
  showAddToPlaylist.value = true
}

function addToPlaylist(playlistId: string) {
  if (addingTrackId.value) {
    playlistStore.addToPlaylist(playlistId, addingTrackId.value)
  }
  showAddToPlaylist.value = false
  addingTrackId.value = null
}

function createAndAdd() {
  const name = prompt('输入新歌单名称')
  if (name && addingTrackId.value) {
    const pl = playlistStore.createPlaylist(name)
    playlistStore.addToPlaylist(pl.id, addingTrackId.value)
  }
  showAddToPlaylist.value = false
  addingTrackId.value = null
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
        <!-- 紧凑视图 - 移动端隐藏 -->
        <button
          @click="setViewMode('compact')"
          :class="['hidden md:block px-3 py-1.5 rounded text-sm transition-colors', viewMode === 'compact' ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white']"
          title="紧凑视图"
        >
          ≡
        </button>
      </div>
    </div>

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
        @click="playSong(index)"
        :class="[
          'group flex items-center gap-4 p-3 rounded-xl cursor-pointer transition-all duration-200',
          store.currentIndex === index ? 'bg-white/20' : 'hover:bg-white/10'
        ]"
      >
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
        <button @click.stop="openAddToPlaylist(track.id)" class="opacity-0 group-hover:opacity-100 transition-opacity" title="添加到歌单">
          ➕
        </button>
        <button :key="favoritesKey" @click.stop="toggleFavorite(track.id)" class="opacity-0 group-hover:opacity-100 transition-opacity">
          {{ isFavorite(track.id) ? '❤️' : '🤍' }}
        </button>
        <button @click.stop="removeTrack(index)" class="opacity-0 group-hover:opacity-100 text-white/40 hover:text-red-400 transition-all">✕</button>
        <span class="text-white/40 text-sm">{{ track.duration ? formatTime(track.duration) : '--:--' }}</span>
      </div>
    </div>

    <!-- 网格视图 (多行网格布局) -->
    <div v-else-if="viewMode === 'grid'" class="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 md:gap-4">
      <div
        v-for="(track, index) in store.playlist"
        :key="track.id"
        @click="playSong(index)"
        :class="[
          'group cursor-pointer rounded-lg md:rounded-xl p-1.5 md:p-3 transition-all duration-200',
          store.currentIndex === index ? 'bg-purple-600/30' : 'hover:bg-white/10'
        ]"
      >
        <div class="relative aspect-square rounded-md md:rounded-lg overflow-hidden bg-white/10 mb-1.5 md:mb-3">
          <img v-if="track.cover" :src="track.cover" :alt="track.title" class="w-full h-full object-cover" />
          <div v-else class="w-full h-full flex items-center justify-center text-2xl md:text-4xl bg-gradient-to-br from-purple-600/50 to-pink-600/50">🎵</div>
          <!-- 播放指示器 -->
          <div v-if="store.currentIndex === index" class="absolute inset-0 bg-black/40 flex items-center justify-center">
            <div class="w-8 h-8 md:w-12 md:h-12 rounded-full bg-purple-600 flex items-center justify-center">
              <span v-if="store.isPlaying" class="text-white text-sm md:text-lg">▶</span>
              <span v-else class="text-white text-sm md:text-lg">⏸</span>
            </div>
          </div>
          <!-- 悬浮操作 -->
          <div v-else class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1 md:gap-2">
            <button @click.stop="openAddToPlaylist(track.id)" class="w-6 h-6 md:w-8 md:h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 text-xs md:text-base" title="添加到歌单">
              ➕
            </button>
            <button @click.stop="toggleFavorite(track.id)" class="w-6 h-6 md:w-8 md:h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 text-xs md:text-base">
              {{ isFavorite(track.id) ? '❤️' : '🤍' }}
            </button>
            <button @click.stop="removeTrack(index)" class="w-6 h-6 md:w-8 md:h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-red-500/50 text-white/70 text-xs md:text-base">✕</button>
          </div>
          <!-- 序号 -->
          <div class="absolute top-1 left-1 md:top-2 md:left-2 w-5 h-5 md:w-6 md:h-6 rounded-full bg-black/60 flex items-center justify-center text-white text-[10px] md:text-xs">
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
        @click="playSong(index)"
        :class="[
          'group flex items-center gap-3 px-3 py-1.5 rounded cursor-pointer transition-colors',
          store.currentIndex === index ? 'bg-white/20' : 'hover:bg-white/10'
        ]"
      >
        <span class="w-6 text-white/30 text-xs text-right">{{ index + 1 }}</span>
        <span v-if="store.currentIndex === index && store.isPlaying" class="text-green-400 text-xs">▶</span>
        <span v-else class="w-3"></span>
        <span class="flex-1 text-white text-sm truncate">{{ track.title }}</span>
        <span class="text-white/40 text-sm truncate max-w-32">{{ track.artist }}</span>
        <button @click.stop="openAddToPlaylist(track.id)" class="opacity-0 group-hover:opacity-100 text-xs transition-opacity" title="添加到歌单">➕</button>
        <button :key="favoritesKey" @click.stop="toggleFavorite(track.id)" class="opacity-0 group-hover:opacity-100 text-xs transition-opacity">
          {{ isFavorite(track.id) ? '❤️' : '🤍' }}
        </button>
        <button @click.stop="removeTrack(index)" class="opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-400 text-xs transition-all">✕</button>
        <span class="text-white/30 text-xs w-10 text-right">{{ track.duration ? formatTime(track.duration) : '--:--' }}</span>
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
</style>
