<script setup lang="ts">
import { ref, watch, nextTick, onMounted } from 'vue'
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
const viewMode = ref<ViewMode>(
  (localStorage.getItem('playlistViewMode') as ViewMode) || 'list'
)

// 拖拽滚动相关 - 带惯性动画
const gridContainer = ref<HTMLElement>()
const gridItems = ref<HTMLElement[]>([])
const isDragging = ref(false)
const startX = ref(0)
const scrollLeft = ref(0)
const hasDragged = ref(false)

// 惯性滚动相关
const velocity = ref(0)
const lastX = ref(0)
const lastTime = ref(0)
const momentumId = ref<number | null>(null)

// 自动居中相关
const isUserInteracting = ref(false)
const autoCenterTimer = ref<number | null>(null)
const AUTOCENTER_DELAY = 2000 // 2秒无操作后自动居中

// 滚动当前播放歌曲到中间
function scrollToCenter(index: number, smooth = true) {
  if (!gridContainer.value || index < 0) return
  
  const container = gridContainer.value
  const items = container.children
  if (index >= items.length) return
  
  const item = items[index] as HTMLElement
  const containerWidth = container.clientWidth
  const itemLeft = item.offsetLeft
  const itemWidth = item.offsetWidth
  
  // 计算让 item 居中需要的 scrollLeft
  const targetScroll = itemLeft - (containerWidth / 2) + (itemWidth / 2)
  
  if (smooth) {
    container.scrollTo({
      left: targetScroll,
      behavior: 'smooth'
    })
  } else {
    container.scrollLeft = targetScroll
  }
}

// 重置自动居中计时器
function resetAutoCenterTimer() {
  if (autoCenterTimer.value) {
    clearTimeout(autoCenterTimer.value)
  }
  isUserInteracting.value = true
  
  autoCenterTimer.value = window.setTimeout(() => {
    isUserInteracting.value = false
    // 如果在网格视图且有正在播放的歌曲，自动居中
    if (viewMode.value === 'grid' && store.currentIndex >= 0) {
      scrollToCenter(store.currentIndex)
    }
  }, AUTOCENTER_DELAY)
}

function startDrag(e: MouseEvent) {
  if (!gridContainer.value) return
  
  // 用户开始交互，重置计时器
  resetAutoCenterTimer()
  
  // 停止之前的惯性动画
  if (momentumId.value) {
    cancelAnimationFrame(momentumId.value)
    momentumId.value = null
  }
  
  isDragging.value = true
  hasDragged.value = false
  startX.value = e.pageX
  scrollLeft.value = gridContainer.value.scrollLeft
  lastX.value = e.pageX
  lastTime.value = Date.now()
  velocity.value = 0
  
  // 移除平滑滚动以便拖拽
  gridContainer.value.style.scrollBehavior = 'auto'
}

function onDrag(e: MouseEvent) {
  if (!isDragging.value || !gridContainer.value) return
  e.preventDefault()
  
  const x = e.pageX
  const walk = x - startX.value
  
  if (Math.abs(walk) > 5) hasDragged.value = true
  
  // 计算速度
  const now = Date.now()
  const dt = now - lastTime.value
  if (dt > 0) {
    velocity.value = (x - lastX.value) / dt * 15 // 速度系数
  }
  lastX.value = x
  lastTime.value = now
  
  gridContainer.value.scrollLeft = scrollLeft.value - walk
}

function endDrag() {
  if (!isDragging.value || !gridContainer.value) return
  isDragging.value = false
  
  // 启动惯性滚动
  if (Math.abs(velocity.value) > 0.5) {
    startMomentum()
  }
  
  // 重置自动居中计时器
  resetAutoCenterTimer()
}

function startMomentum() {
  const container = gridContainer.value
  if (!container) return
  
  const friction = 0.95 // 摩擦系数
  const minVelocity = 0.5 // 最小速度阈值
  
  function animate() {
    if (Math.abs(velocity.value) < minVelocity) {
      momentumId.value = null
      return
    }
    
    container.scrollLeft -= velocity.value
    velocity.value *= friction
    
    // 边界检测
    if (container.scrollLeft <= 0 || 
        container.scrollLeft >= container.scrollWidth - container.clientWidth) {
      velocity.value = 0
      return
    }
    
    momentumId.value = requestAnimationFrame(animate)
  }
  
  animate()
}

function handleGridClick(index: number) {
  // 如果拖拽过则不触发点击
  if (hasDragged.value) return
  playSong(index)
}

// 鼠标滚轮横向滚动
function handleWheel(e: WheelEvent) {
  if (!gridContainer.value) return
  e.preventDefault()
  
  // 用户交互，重置计时器
  resetAutoCenterTimer()
  
  // 停止惯性动画
  if (momentumId.value) {
    cancelAnimationFrame(momentumId.value)
    momentumId.value = null
  }
  
  // 平滑滚动
  gridContainer.value.scrollBy({
    left: e.deltaY * 2,
    behavior: 'smooth'
  })
}

// 监听当前播放歌曲变化，自动居中
watch(() => store.currentIndex, (index) => {
  if (viewMode.value === 'grid' && index >= 0 && !isUserInteracting.value) {
    nextTick(() => {
      scrollToCenter(index)
    })
  }
})

// 切换到网格视图时，滚动到当前播放歌曲
watch(viewMode, (mode) => {
  if (mode === 'grid' && store.currentIndex >= 0) {
    nextTick(() => {
      scrollToCenter(store.currentIndex, false)
    })
  }
})

// 组件挂载时，如果是网格视图，滚动到当前播放歌曲
onMounted(() => {
  if (viewMode.value === 'grid' && store.currentIndex >= 0) {
    nextTick(() => {
      scrollToCenter(store.currentIndex, false)
    })
  }
})

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
        <button
          @click="setViewMode('compact')"
          :class="['px-3 py-1.5 rounded text-sm transition-colors', viewMode === 'compact' ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white']"
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

    <!-- 网格视图 (单行横向滚动 + 惯性) -->
    <div
      v-else-if="viewMode === 'grid'"
      ref="gridContainer"
      class="flex gap-4 overflow-x-auto pb-4 select-none scroll-smooth"
      :class="isDragging ? 'cursor-grabbing' : 'cursor-grab'"
      @mousedown="startDrag"
      @mousemove="onDrag"
      @mouseup="endDrag"
      @mouseleave="endDrag"
      @wheel="handleWheel"
    >
      <div
        v-for="(track, index) in store.playlist"
        :key="track.id"
        @click="handleGridClick(index)"
        :class="[
          'group cursor-pointer rounded-xl p-3 transition-all duration-200 flex-shrink-0 w-40',
          store.currentIndex === index ? 'bg-white/20' : 'hover:bg-white/10'
        ]"
      >
        <div class="relative w-full aspect-square rounded-lg overflow-hidden bg-white/10 mb-3">
          <img v-if="track.cover" :src="track.cover" :alt="track.title" class="w-full h-full object-cover pointer-events-none" />
          <div v-else class="w-full h-full flex items-center justify-center text-4xl">🎵</div>
          <!-- 播放指示器 -->
          <div v-if="store.currentIndex === index && store.isPlaying" class="absolute inset-0 bg-black/50 flex items-center justify-center">
            <div class="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
              <div class="flex gap-1">
                <span class="w-1 h-5 bg-white rounded animate-pulse"></span>
                <span class="w-1 h-5 bg-white rounded animate-pulse" style="animation-delay: 0.15s"></span>
                <span class="w-1 h-5 bg-white rounded animate-pulse" style="animation-delay: 0.3s"></span>
              </div>
            </div>
          </div>
          <!-- 悬浮操作 -->
          <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
            <button @click.stop="openAddToPlaylist(track.id)" class="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30" title="添加到歌单">
              ➕
            </button>
            <button @click.stop="toggleFavorite(track.id)" class="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30">
              {{ isFavorite(track.id) ? '❤️' : '🤍' }}
            </button>
            <button @click.stop="removeTrack(index)" class="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-red-500/50 text-white/70">✕</button>
          </div>
        </div>
        <p class="text-white text-sm font-medium truncate">{{ track.title }}</p>
        <p class="text-white/50 text-xs truncate">{{ track.artist }}</p>
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
