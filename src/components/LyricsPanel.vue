<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { usePlayerStore } from '@/store/player'
import { audioPlayer } from '@/services/player/AudioPlayer'
import { parseLyrics, getCurrentLyricIndex } from '@/utils/parseLyrics'
import { getLyrics, type MusicSource } from '@/services/source/OnlineApiSource'
import { formatTime } from '@/utils/formatTime'
import { audioCache } from '@/services/cache/AudioCache'

const store = usePlayerStore()

// 处理浏览器返回按钮
function handlePopState(e: PopStateEvent) {
  if (store.showLyrics) {
    e.preventDefault()
    store.toggleLyrics()
    // 重新添加历史记录，防止再次返回时退出应用
    window.history.pushState({ lyricsOpen: false }, '')
  }
}

// 监听歌词面板打开/关闭，管理历史记录
watch(() => store.showLyrics, (isOpen) => {
  if (isOpen) {
    // 打开时添加历史记录
    window.history.pushState({ lyricsOpen: true }, '')
  }
})

onMounted(() => {
  window.addEventListener('popstate', handlePopState)
})

onUnmounted(() => {
  window.removeEventListener('popstate', handlePopState)
})
const lyricsContainer = ref<HTMLElement>()
const loadingLyrics = ref(false)
const showLyrics = ref(false) // 是否显示歌词（点击切换）
const displayMode = ref<'card' | 'vinyl'>('card') // 展示模式：卡片 / 黑胶唱片
const showPlaylistDrawer = ref(false) // 播放列表抽屉

// 播放模式文本
const playModeText = computed(() => {
  const modes: Record<string, string> = {
    sequence: '顺序播放',
    loop: '列表循环',
    single: '单曲循环',
    shuffle: '随机播放'
  }
  return modes[store.playMode] || '顺序播放'
})

function toggleDisplayMode() {
  displayMode.value = displayMode.value === 'card' ? 'vinyl' : 'card'
}

// 播放列表中播放指定歌曲
function playFromList(index: number) {
  store.playTrack(index)
}

// 从播放列表移除歌曲
function removeFromList(index: number) {
  const newPlaylist = [...store.playlist]
  newPlaylist.splice(index, 1)
  store.setPlaylist(newPlaylist)
  
  // 调整当前索引
  if (index < store.currentIndex) {
    store.playTrack(store.currentIndex - 1)
  } else if (index === store.currentIndex && newPlaylist.length > 0) {
    store.playTrack(Math.min(index, newPlaylist.length - 1))
  }
  
  if (newPlaylist.length === 0) {
    showPlaylistDrawer.value = false
    store.toggleLyrics()
  }
}

// 收藏相关
const isFavorite = computed(() => {
  if (!store.currentTrack) return false
  const ids = JSON.parse(localStorage.getItem('favorites') || '[]')
  return ids.includes(store.currentTrack.id)
})

function toggleFavorite() {
  if (!store.currentTrack) return
  const ids = JSON.parse(localStorage.getItem('favorites') || '[]')
  const idx = ids.indexOf(store.currentTrack.id)
  if (idx >= 0) {
    ids.splice(idx, 1)
  } else {
    ids.push(store.currentTrack.id)
  }
  localStorage.setItem('favorites', JSON.stringify(ids))
}

// 下载相关
const isDownloaded = computed(() => {
  // 简单判断：本地文件或已缓存
  if (!store.currentTrack) return false
  return store.currentTrack.url.startsWith('blob:') || store.currentTrack._cached === true
})

async function handleDownload() {
  if (!store.currentTrack || isDownloaded.value) return
  // 这里可以实现下载逻辑，暂时只是提示
  alert('下载功能开发中')
}

// 添加到歌单
const showPlaylistPicker = ref(false)

function handleAddToPlaylist() {
  showPlaylistPicker.value = true
}

// 获取用户歌单列表
const userPlaylists = computed(() => {
  const data = localStorage.getItem('zen_playlists')
  if (!data) return []
  try {
    const playlists = JSON.parse(data)
    return playlists.map((p: any) => ({ id: p.id, name: p.name }))
  } catch {
    return []
  }
})

function addToPlaylist(playlistId: string) {
  if (!store.currentTrack) return
  const data = localStorage.getItem('zen_playlists')
  if (!data) return
  
  try {
    const playlists = JSON.parse(data)
    const playlist = playlists.find((p: any) => p.id === playlistId)
    if (playlist && !playlist.trackIds.includes(store.currentTrack.id)) {
      playlist.trackIds.push(store.currentTrack.id)
      playlist.updatedAt = Date.now()
      localStorage.setItem('zen_playlists', JSON.stringify(playlists))
    }
  } catch (e) {
    console.error('添加到歌单失败', e)
  }
  
  showPlaylistPicker.value = false
}

// 滑动切歌相关
const swipeStartX = ref(0)
const swipeStartY = ref(0)
const swipeCurrentX = ref(0)
const isSwiping = ref(false)
const isHorizontalSwipe = ref(false)
const swipeThreshold = 100
const isAnimating = ref(false)
const slideDirection = ref<'left' | 'right' | null>(null)
const disableTransition = ref(false) // 禁用过渡动画

const swipeOffset = computed(() => {
  if (!isSwiping.value || !isHorizontalSwipe.value) return 0
  const offset = swipeCurrentX.value - swipeStartX.value
  // 添加阻尼效果
  const maxOffset = window.innerWidth * 0.6
  if (Math.abs(offset) > maxOffset) {
    const sign = offset > 0 ? 1 : -1
    return sign * (maxOffset + (Math.abs(offset) - maxOffset) * 0.3)
  }
  return offset
})

function handleSwipeStart(e: TouchEvent | MouseEvent) {
  if (isAnimating.value) return
  isSwiping.value = true
  isHorizontalSwipe.value = false
  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
  const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
  swipeStartX.value = clientX
  swipeStartY.value = clientY
  swipeCurrentX.value = clientX
}

function handleSwipeMove(e: TouchEvent | MouseEvent) {
  if (!isSwiping.value || isAnimating.value) return
  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
  const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
  
  // 判断滑动方向
  if (!isHorizontalSwipe.value) {
    const deltaX = Math.abs(clientX - swipeStartX.value)
    const deltaY = Math.abs(clientY - swipeStartY.value)
    if (deltaX > 10 || deltaY > 10) {
      isHorizontalSwipe.value = deltaX > deltaY
    }
  }
  
  if (isHorizontalSwipe.value) {
    e.preventDefault()
    swipeCurrentX.value = clientX
  }
}

function handleSwipeEnd() {
  if (!isSwiping.value || isAnimating.value) return
  const diff = swipeCurrentX.value - swipeStartX.value
  
  if (isHorizontalSwipe.value && Math.abs(diff) > swipeThreshold) {
    isAnimating.value = true
    if (diff > 0 && store.currentIndex > 0) {
      slideDirection.value = 'right'
      setTimeout(() => {
        store.prevTrack()
        resetSwipe()
      }, 250)
    } else if (diff < 0 && store.currentIndex < store.playlist.length - 1) {
      slideDirection.value = 'left'
      setTimeout(() => {
        store.nextTrack()
        resetSwipe()
      }, 250)
    } else {
      resetSwipe()
    }
  } else {
    resetSwipe()
  }
}

function resetSwipe() {
  // 禁用过渡，立即重置位置
  disableTransition.value = true
  isSwiping.value = false
  isHorizontalSwipe.value = false
  swipeStartX.value = 0
  swipeStartY.value = 0
  swipeCurrentX.value = 0
  slideDirection.value = null
  
  // 下一帧恢复过渡
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      disableTransition.value = false
      isAnimating.value = false
    })
  })
}

// 获取上一首/下一首
const prevTrack = computed(() => {
  if (store.currentIndex > 0) {
    return store.playlist[store.currentIndex - 1]
  }
  return null
})

const nextTrack = computed(() => {
  if (store.currentIndex < store.playlist.length - 1) {
    return store.playlist[store.currentIndex + 1]
  }
  return null
})

// 计算卡片样式 - 需要包含 translate(-50%, -50%) 来保持居中
const currentCardStyle = computed(() => {
  if (slideDirection.value === 'left') {
    return { transform: 'translate(calc(-50% - 120vw), -50%) scale(0.9)', opacity: 0 }
  }
  if (slideDirection.value === 'right') {
    return { transform: 'translate(calc(-50% + 120vw), -50%) scale(0.9)', opacity: 0 }
  }
  const scale = 1 - Math.abs(swipeOffset.value) * 0.0005
  return {
    transform: `translate(calc(-50% + ${swipeOffset.value}px), -50%) scale(${scale})`,
    opacity: 1 - Math.abs(swipeOffset.value) * 0.002
  }
})

const prevCardStyle = computed(() => {
  const progress = Math.max(0, swipeOffset.value / swipeThreshold)
  if (slideDirection.value === 'right') {
    return { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 }
  }
  const offsetX = -100 + progress * 100
  return {
    transform: `translate(calc(-50% + ${offsetX}%), -50%) scale(${0.8 + progress * 0.2})`,
    opacity: 0.3 + progress * 0.7
  }
})

const nextCardStyle = computed(() => {
  const progress = Math.max(0, -swipeOffset.value / swipeThreshold)
  if (slideDirection.value === 'left') {
    return { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 }
  }
  const offsetX = 100 - progress * 100
  return {
    transform: `translate(calc(-50% + ${offsetX}%), -50%) scale(${0.8 + progress * 0.2})`,
    opacity: 0.3 + progress * 0.7
  }
})

const lyrics = computed(() => {
  return store.currentTrack?.lrc ? parseLyrics(store.currentTrack.lrc) : []
})

const currentLyricIndex = computed(() => {
  return getCurrentLyricIndex(lyrics.value, store.currentTime)
})

// 歌词滚动相关
const lyricsScrollArea = ref<HTMLElement>()
const isUserScrolling = ref(false)
const userScrollTimer = ref<number>()
const seekingLyricIndex = ref(-1) // 用户滚动时选中的歌词索引
const isTouching = ref(false) // 手指是否在触摸

// 自动滚动到当前歌词
watch(currentLyricIndex, (index) => {
  // 用户正在滚动时不自动滚动
  if (isUserScrolling.value) return
  if (index >= 0 && lyricsContainer.value) {
    const el = lyricsContainer.value.children[index] as HTMLElement
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
})

// 手指触摸开始
function handleLyricsTouchStart() {
  isTouching.value = true
  isUserScrolling.value = true
  if (userScrollTimer.value) {
    clearTimeout(userScrollTimer.value)
  }
}

// 手指触摸结束 - 自动跳转
function handleLyricsTouchEnd() {
  isTouching.value = false
  // 延迟一点确保滚动位置稳定
  setTimeout(() => {
    if (seekingLyricIndex.value >= 0 && seekingLyricIndex.value < lyrics.value.length) {
      const targetTime = lyrics.value[seekingLyricIndex.value].time
      audioPlayer.seek(targetTime)
      store.setCurrentTime(targetTime)
    }
    // 跳转后恢复自动滚动
    isUserScrolling.value = false
    seekingLyricIndex.value = -1
  }, 100)
}

// 处理歌词区域滚动
function handleLyricsScroll() {
  if (!isTouching.value) return
  isUserScrolling.value = true
  // 计算当前滚动位置对应的歌词
  updateSeekingLyric()
}

// 计算滚动位置对应的歌词索引
function updateSeekingLyric() {
  if (!lyricsScrollArea.value || !lyricsContainer.value || lyrics.value.length === 0) return
  
  const scrollArea = lyricsScrollArea.value
  const centerY = scrollArea.scrollTop + scrollArea.clientHeight / 2
  
  let closestIndex = 0
  let closestDistance = Infinity
  
  for (let i = 0; i < lyricsContainer.value.children.length; i++) {
    const el = lyricsContainer.value.children[i] as HTMLElement
    const elCenter = el.offsetTop + el.offsetHeight / 2
    const distance = Math.abs(elCenter - centerY)
    if (distance < closestDistance) {
      closestDistance = distance
      closestIndex = i
    }
  }
  
  seekingLyricIndex.value = closestIndex
}



// 当打开歌词面板时，如果没有歌词则尝试加载
watch(() => store.showLyrics, async (show) => {
  const track = store.currentTrack
  if (show && track && !track.lrc && track._platform && track._songId) {
    loadingLyrics.value = true
    try {
      // 先尝试从缓存获取歌词
      const cachedLrc = await audioCache.getLyrics(track.id)
      if (cachedLrc) {
        track.lrc = cachedLrc
      } else {
        // 从网络获取并缓存
        const lrc = await getLyrics(track._platform as MusicSource, track._songId)
        if (lrc) {
          track.lrc = lrc
          // 缓存歌词
          audioCache.cacheLyrics(track.id, lrc)
        }
      }
    } finally {
      loadingLyrics.value = false
    }
  }
  // 重置为唱片视图
  if (show) showLyrics.value = false
})

function handleToggle() {
  audioPlayer.toggle()
  store.togglePlay()
}

// 是否为原生平台（Web 环境下始终为 false）
const isNative = false

// 切换息屏播放
function toggleBackgroundPlay() {
  audioPlayer.setBackgroundPlay(!store.backgroundPlayEnabled)
}

// 进度条拖动
const progressBar = ref<HTMLElement>()
const isDragging = ref(false)

function handleProgressStart(e: TouchEvent | MouseEvent) {
  e.stopPropagation()
  isDragging.value = true
  updateProgress(e)
}

function handleProgressMove(e: TouchEvent | MouseEvent) {
  if (!isDragging.value) return
  e.stopPropagation()
  updateProgress(e)
}

function handleProgressEnd(e: TouchEvent | MouseEvent) {
  if (!isDragging.value) return
  e.stopPropagation()
  isDragging.value = false
}

function updateProgress(e: TouchEvent | MouseEvent) {
  if (!progressBar.value || store.duration <= 0) return
  const rect = progressBar.value.getBoundingClientRect()
  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
  const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  const newTime = percent * store.duration
  audioPlayer.seek(newTime)
  store.setCurrentTime(newTime)
}
</script>

<template>
  <Transition name="slide">
    <div 
      v-if="store.showLyrics && store.currentTrack"
      class="fixed inset-0 z-50 flex flex-col overflow-hidden"
    >
      <!-- 动态模糊背景 -->
      <div class="absolute inset-0 z-0">
        <div 
          v-if="store.currentTrack?.cover"
          class="absolute inset-0 bg-cover bg-center transition-all duration-1000"
          :style="{ backgroundImage: `url(${store.currentTrack.cover})` }"
        ></div>
        <div class="absolute inset-0 bg-black/60 backdrop-blur-3xl"></div>
      </div>

      <!-- 顶部栏 - 添加安全区域顶部间距 -->
      <div class="flex items-center justify-between px-4 pt-safe-top pb-2 flex-shrink-0 relative z-10">
        <button 
          @click="store.toggleLyrics()"
          class="w-10 h-10 rounded-full flex items-center justify-center text-white/60 hover:text-white transition-colors"
        >
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
          </svg>
        </button>
        <div class="flex-1"></div>
        <!-- 切换展示模式 -->
        <button 
          @click.stop="toggleDisplayMode"
          class="w-10 h-10 rounded-full flex items-center justify-center text-white/60 hover:text-white transition-colors"
          :title="displayMode === 'card' ? '切换到黑胶唱片' : '切换到卡片'"
        >
          <!-- 黑胶唱片图标 -->
          <svg v-if="displayMode === 'card'" class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.5"/>
            <circle cx="12" cy="12" r="3" fill="currentColor"/>
            <circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="0.5"/>
          </svg>
          <!-- 卡片图标 -->
          <svg v-else class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <rect x="3" y="5" width="18" height="14" rx="2" stroke-width="1.5"/>
            <rect x="6" y="8" width="6" height="6" rx="1" stroke-width="1"/>
          </svg>
        </button>
      </div>

      <!-- 主内容区 -->
      <div 
        class="flex-1 flex flex-col items-center overflow-hidden cursor-pointer select-none relative z-10"
        @touchstart="handleSwipeStart"
        @touchmove.passive="handleSwipeMove"
        @touchend="handleSwipeEnd"
        @mousedown="handleSwipeStart"
        @mousemove="handleSwipeMove"
        @mouseup="handleSwipeEnd"
        @mouseleave="handleSwipeEnd"
        @click="!isSwiping && Math.abs(swipeOffset) < 10 && (showLyrics = !showLyrics)"
      >
        <Transition name="disc-fade" mode="out-in">
          <!-- 卡片视图 -->
          <div v-if="!showLyrics && displayMode === 'card'" key="card" class="w-full h-full relative overflow-hidden flex items-center justify-center">
            <div class="relative w-full h-full flex items-center justify-center">
              <!-- 上一首卡片 -->
              <div 
                v-if="prevTrack"
                class="absolute left-1/2 top-1/2 w-[85%] max-w-[320px] pointer-events-none"
                :class="[disableTransition ? 'transition-none' : 'transition-all duration-300']"
                :style="prevCardStyle"
              >
                <div class="swipe-card bg-gradient-to-b from-white/10 to-white/5 backdrop-blur-xl rounded-3xl p-5">
                  <div class="flex flex-col items-center">
                    <div class="w-44 h-44 md:w-52 md:h-52 rounded-2xl overflow-hidden shadow-2xl mb-3">
                      <img v-if="prevTrack.cover" :src="prevTrack.cover" class="w-full h-full object-cover" draggable="false"/>
                      <div v-else class="w-full h-full flex items-center justify-center text-5xl bg-gradient-to-br from-purple-600/50 to-pink-600/50">🎵</div>
                    </div>
                    <p class="text-white/80 font-medium text-base truncate max-w-full">{{ prevTrack.title }}</p>
                    <p class="text-white/40 text-sm">{{ prevTrack.artist }}</p>
                  </div>
                </div>
              </div>

              <!-- 当前卡片 -->
              <div 
                class="absolute left-1/2 top-1/2 w-[85%] max-w-[320px] z-10"
                :class="[disableTransition ? 'transition-none' : 'transition-all', isSwiping && isHorizontalSwipe ? 'duration-0' : 'duration-300']"
                :style="currentCardStyle"
              >
                <div class="swipe-card bg-gradient-to-b from-white/15 to-white/5 backdrop-blur-xl rounded-3xl p-5 shadow-2xl">
                  <div class="flex flex-col items-center">
                    <div :class="['w-48 h-48 md:w-56 md:h-56 rounded-2xl overflow-hidden shadow-2xl mb-4 relative', store.isPlaying ? 'cover-playing' : '']">
                      <img v-if="store.currentTrack?.cover" :src="store.currentTrack.cover" class="w-full h-full object-cover" draggable="false"/>
                      <div v-else class="w-full h-full flex items-center justify-center text-6xl bg-gradient-to-br from-purple-600/50 to-pink-600/50">🎵</div>
                      <div v-if="store.isPlaying" class="absolute inset-0 bg-black/10 flex items-center justify-center">
                        <div class="flex items-end gap-1 h-8">
                          <span class="w-1 bg-white/80 rounded-full animate-eq-1"></span>
                          <span class="w-1 bg-white/80 rounded-full animate-eq-2"></span>
                          <span class="w-1 bg-white/80 rounded-full animate-eq-3"></span>
                          <span class="w-1 bg-white/80 rounded-full animate-eq-4"></span>
                        </div>
                      </div>
                    </div>
                    <p class="text-white font-bold text-lg md:text-xl mb-1 truncate max-w-full text-center">{{ store.currentTrack?.title }}</p>
                    <p class="text-white/50 text-sm">{{ store.currentTrack?.artist }}</p>
                    <p class="text-white/30 text-xs mt-2">{{ store.currentIndex + 1 }} / {{ store.playlist.length }}</p>
                    
                    <!-- 功能按钮 -->
                    <div class="flex items-center justify-center gap-8 mt-4">
                      <button @click.stop="toggleFavorite" class="text-white/60 hover:text-white transition-colors">
                        <svg class="w-6 h-6" :class="isFavorite ? 'text-red-500 fill-red-500' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/>
                        </svg>
                      </button>
                      <button @click.stop="showLyrics = true" class="text-white/60 hover:text-white transition-colors">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                        </svg>
                      </button>
                      <button @click.stop="handleAddToPlaylist" class="text-white/60 hover:text-white transition-colors">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"/>
                        </svg>
                      </button>
                      <button @click.stop="handleDownload" :class="isDownloaded ? 'text-green-400' : 'text-white/60 hover:text-white'" class="transition-colors">
                        <svg v-if="isDownloaded" class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                        </svg>
                        <svg v-else class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 下一首卡片 -->
              <div 
                v-if="nextTrack"
                class="absolute left-1/2 top-1/2 w-[85%] max-w-[320px] pointer-events-none"
                :class="[disableTransition ? 'transition-none' : 'transition-all duration-300']"
                :style="nextCardStyle"
              >
                <div class="swipe-card bg-gradient-to-b from-white/10 to-white/5 backdrop-blur-xl rounded-3xl p-5">
                  <div class="flex flex-col items-center">
                    <div class="w-44 h-44 md:w-52 md:h-52 rounded-2xl overflow-hidden shadow-2xl mb-3">
                      <img v-if="nextTrack.cover" :src="nextTrack.cover" class="w-full h-full object-cover" draggable="false"/>
                      <div v-else class="w-full h-full flex items-center justify-center text-5xl bg-gradient-to-br from-purple-600/50 to-pink-600/50">🎵</div>
                    </div>
                    <p class="text-white/80 font-medium text-base truncate max-w-full">{{ nextTrack.title }}</p>
                    <p class="text-white/40 text-sm">{{ nextTrack.artist }}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 黑胶唱片视图 -->
          <div v-else-if="!showLyrics && displayMode === 'vinyl'" key="vinyl" class="w-full h-full relative overflow-hidden flex flex-col items-center justify-center">
            <!-- 唱针 -->
            <div class="absolute top-8 md:top-12 right-1/2 translate-x-[120px] md:translate-x-[160px] z-20">
              <svg 
                :class="['w-20 h-28 md:w-24 md:h-32 transition-transform duration-500 origin-top', store.isPlaying ? 'rotate-[18deg]' : 'rotate-[-15deg]']"
                viewBox="0 0 60 90"
              >
                <defs>
                  <linearGradient id="needleBase" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:#888"/>
                    <stop offset="100%" style="stop-color:#444"/>
                  </linearGradient>
                  <linearGradient id="needleArm" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:#aaa"/>
                    <stop offset="100%" style="stop-color:#666"/>
                  </linearGradient>
                </defs>
                <circle cx="12" cy="12" r="10" fill="url(#needleBase)"/>
                <circle cx="12" cy="12" r="6" fill="#555"/>
                <path d="M12 18 Q 20 40, 35 70" stroke="url(#needleArm)" stroke-width="4" fill="none" stroke-linecap="round"/>
                <ellipse cx="37" cy="75" rx="5" ry="8" fill="#888"/>
                <ellipse cx="37" cy="82" rx="2" ry="3" fill="#666"/>
              </svg>
            </div>

            <!-- 黑胶唱片 -->
            <div class="relative mt-6">
              <div 
                :class="['w-64 h-64 md:w-72 md:h-72 rounded-full shadow-2xl vinyl-disc', store.isPlaying ? 'animate-spin-vinyl' : '']"
                :style="{ animationPlayState: store.isPlaying ? 'running' : 'paused' }"
              >
                <!-- 唱片外圈 -->
                <div class="w-full h-full rounded-full bg-gradient-to-br from-zinc-900 via-zinc-800 to-black p-1 relative">
                  <!-- 光泽效果 -->
                  <div class="absolute inset-0 rounded-full bg-gradient-to-tr from-transparent via-white/5 to-transparent"></div>
                  <!-- 唱片纹路 -->
                  <div class="absolute inset-[6%] rounded-full border border-zinc-600/30"></div>
                  <div class="absolute inset-[10%] rounded-full border border-zinc-600/20"></div>
                  <div class="absolute inset-[14%] rounded-full border border-zinc-600/30"></div>
                  <div class="absolute inset-[18%] rounded-full border border-zinc-600/20"></div>
                  <div class="absolute inset-[22%] rounded-full border border-zinc-600/30"></div>
                  <!-- 封面区域 -->
                  <div class="absolute inset-[26%] rounded-full overflow-hidden border-4 border-zinc-700/50 shadow-inner">
                    <img v-if="store.currentTrack?.cover" :src="store.currentTrack.cover" class="w-full h-full object-cover" draggable="false"/>
                    <div v-else class="w-full h-full flex items-center justify-center text-4xl bg-gradient-to-br from-purple-600/50 to-pink-600/50">🎵</div>
                  </div>
                  <!-- 中心轴 -->
                  <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 md:w-5 md:h-5 rounded-full bg-zinc-400 shadow-inner z-10"></div>
                </div>
              </div>
            </div>

            <!-- 歌曲信息 -->
            <div class="mt-6 text-center px-6">
              <p class="text-white font-bold text-xl md:text-2xl mb-1 truncate max-w-[280px]">{{ store.currentTrack?.title }}</p>
              <p class="text-white/50 text-sm md:text-base">{{ store.currentTrack?.artist }}</p>
              
              <!-- 功能按钮 -->
              <div class="flex items-center justify-center gap-8 mt-4">
                <button @click.stop="toggleFavorite" class="text-white/60 hover:text-white transition-colors">
                  <svg class="w-6 h-6" :class="isFavorite ? 'text-red-500 fill-red-500' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/>
                  </svg>
                </button>
                <button @click.stop="showLyrics = true" class="text-white/60 hover:text-white transition-colors">
                  <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                  </svg>
                </button>
                <button @click.stop="handleAddToPlaylist" class="text-white/60 hover:text-white transition-colors">
                  <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"/>
                  </svg>
                </button>
                <button @click.stop="handleDownload" :class="isDownloaded ? 'text-green-400' : 'text-white/60 hover:text-white'" class="transition-colors">
                  <svg v-if="isDownloaded" class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                  </svg>
                  <svg v-else class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <!-- 歌词视图 -->
          <div v-else key="lyrics" class="flex flex-col items-center w-full h-full pt-4 relative">
            <!-- 顶部歌曲信息 -->
            <div class="flex items-center gap-3 px-4 mb-4 flex-shrink-0">
              <div 
                :class="[
                  'w-12 h-12 md:w-14 md:h-14 rounded-full overflow-hidden bg-white/10 flex-shrink-0 border-2 border-zinc-700',
                  store.isPlaying ? 'animate-spin-slow' : ''
                ]"
              >
                <img
                  v-if="store.currentTrack.cover"
                  :src="store.currentTrack.cover"
                  class="w-full h-full object-cover"
                />
                <div v-else class="w-full h-full flex items-center justify-center text-xl">🎵</div>
              </div>
              <div>
                <p class="text-white font-medium text-sm md:text-base truncate max-w-[200px]">
                  {{ store.currentTrack.title }}
                </p>
                <p class="text-white/50 text-xs truncate max-w-[180px]">
                  {{ store.currentTrack.artist }}
                </p>
              </div>
            </div>

            <!-- 歌词滚动区域 -->
            <div 
              ref="lyricsScrollArea"
              class="flex-1 w-full overflow-y-auto text-center px-6 md:px-12 lyrics-scroll relative"
              @scroll="handleLyricsScroll"
              @touchstart="handleLyricsTouchStart"
              @touchend="handleLyricsTouchEnd"
              @mousedown="handleLyricsTouchStart"
              @mouseup="handleLyricsTouchEnd"
            >
              <p v-if="loadingLyrics" class="text-white/40 text-lg py-20">
                加载歌词中...
              </p>
              <div v-else-if="lyrics.length === 0" class="flex flex-col items-center justify-center h-full text-white/30">
                <p class="text-4xl mb-3">🎵</p>
                <p>暂无歌词</p>
              </div>
              <div v-else ref="lyricsContainer" class="py-[40vh]">
                <p
                  v-for="(line, index) in lyrics"
                  :key="index"
                  :class="[
                    'transition-all duration-300 leading-relaxed py-3',
                    currentLyricIndex === index 
                      ? 'text-white text-lg md:text-xl font-medium scale-105' 
                      : isUserScrolling && seekingLyricIndex === index
                        ? 'text-purple-400 text-lg font-medium'
                        : 'text-white/40 text-base'
                  ]"
                >
                  {{ line.text || '♪' }}
                </p>
              </div>
            </div>

            <!-- 中间指示线（用户滚动时显示） -->
            <Transition name="fade">
              <div 
                v-if="isUserScrolling && lyrics.length > 0"
                class="absolute left-0 right-0 top-1/2 -translate-y-1/2 flex items-center pointer-events-none z-20 px-4"
              >
                <div class="flex-1 h-[1px] bg-purple-500/60"></div>
                <div 
                  class="mx-2 px-3 py-1 bg-purple-500/80 text-white text-xs rounded-full flex items-center gap-1"
                >
                  <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                  {{ seekingLyricIndex >= 0 ? formatTime(lyrics[seekingLyricIndex]?.time || 0) : '' }}
                </div>
                <div class="flex-1 h-[1px] bg-purple-500/60"></div>
              </div>
            </Transition>

            <p class="py-3 text-white/30 text-xs flex-shrink-0">松手跳转 · 点击返回唱片</p>
          </div>
        </Transition>
      </div>

      <!-- 底部播放控制 -->
      <div class="w-full px-6 pb-8 flex-shrink-0 bg-gradient-to-t from-black/50 to-transparent pt-4 relative z-10">
        <!-- 进度条 -->
        <div class="flex items-center gap-3 mb-6">
          <span class="text-white/50 text-xs w-10 text-right font-mono">{{ formatTime(store.currentTime) }}</span>
          <div 
            ref="progressBar"
            class="flex-1 h-6 flex items-center cursor-pointer"
            @touchstart="handleProgressStart"
            @touchmove="handleProgressMove"
            @touchend="handleProgressEnd"
            @mousedown="handleProgressStart"
            @mousemove="handleProgressMove"
            @mouseup="handleProgressEnd"
            @mouseleave="handleProgressEnd"
          >
            <div class="w-full h-1 bg-white/20 rounded-full relative">
              <div 
                class="h-full bg-white rounded-full"
                :style="{ width: `${store.progress}%` }"
              ></div>
              <!-- 拖动手柄 -->
              <div 
                class="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg transition-transform"
                :class="isDragging ? 'scale-125' : ''"
                :style="{ left: `calc(${store.progress}% - 6px)` }"
              ></div>
            </div>
          </div>
          <span class="text-white/50 text-xs w-10 font-mono">{{ formatTime(store.duration) }}</span>
        </div>

        <!-- 控制按钮 -->
        <div class="flex items-center justify-center gap-8">
          <!-- 循环模式 -->
          <button 
            @click.stop="store.togglePlayMode()"
            :class="['w-10 h-10 flex items-center justify-center transition-colors relative', store.playMode === 'sequence' ? 'text-white/50 hover:text-white' : 'text-purple-400']"
            :title="playModeText"
          >
            <!-- 顺序播放 -->
            <svg v-if="store.playMode === 'sequence'" class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>
            </svg>
            <!-- 单曲循环 -->
            <svg v-else-if="store.playMode === 'single'" class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>
              <text x="12" y="14" text-anchor="middle" font-size="8" fill="currentColor">1</text>
            </svg>
            <!-- 列表循环 -->
            <svg v-else-if="store.playMode === 'loop'" class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>
            </svg>
            <!-- 随机播放 -->
            <svg v-else class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>
            </svg>
          </button>
          <!-- 上一首 -->
          <button 
            @click.stop="store.prevTrack()"
            class="control-btn w-12 h-12 aspect-square flex-shrink-0 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 active:scale-95 transition-all"
          >
            <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
            </svg>
          </button>
          <!-- 播放/暂停 -->
          <button 
            @click.stop="handleToggle"
            :class="[
              'play-btn w-16 h-16 aspect-square flex-shrink-0 rounded-full flex items-center justify-center transition-all active:scale-95',
              store.isPlaying ? 'bg-white text-black shadow-[0_0_30px_rgba(255,255,255,0.3)]' : 'bg-gradient-to-br from-purple-500 to-pink-500 text-white shadow-[0_0_30px_rgba(168,85,247,0.4)]'
            ]"
          >
            <svg v-if="store.isPlaying" class="w-7 h-7" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="5" width="4" height="14" rx="1"/>
              <rect x="14" y="5" width="4" height="14" rx="1"/>
            </svg>
            <svg v-else class="w-7 h-7 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5.14v14l11-7-11-7z"/>
            </svg>
          </button>
          <!-- 下一首 -->
          <button 
            @click.stop="store.nextTrack()"
            class="control-btn w-12 h-12 aspect-square flex-shrink-0 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 active:scale-95 transition-all"
          >
            <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
            </svg>
          </button>
          <!-- 息屏播放（仅移动端显示） -->
          <button 
            v-if="isNative"
            @click.stop="toggleBackgroundPlay"
            :class="[
              'w-10 h-10 flex items-center justify-center transition-colors',
              store.backgroundPlayEnabled ? 'text-purple-400' : 'text-white/50 hover:text-white'
            ]"
            :title="store.backgroundPlayEnabled ? '息屏播放已开启' : '息屏播放已关闭'"
          >
            <!-- 息屏播放图标 -->
            <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M17 1H7c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-2-2-2zm0 18H7V5h10v14z"/>
              <path v-if="store.backgroundPlayEnabled" d="M10 8v8l5-4z"/>
              <path v-else d="M10 8h1.5v8H10zm2.5 0H14v8h-1.5z"/>
            </svg>
          </button>
          <!-- 播放列表 -->
          <button 
            v-else
            @click.stop="showPlaylistDrawer = true"
            class="w-10 h-10 flex items-center justify-center text-white/50 hover:text-white transition-colors"
          >
            <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  </Transition>

  <!-- 添加到歌单弹窗 -->
  <Transition name="fade">
    <div 
      v-if="showPlaylistPicker" 
      class="fixed inset-0 z-[60] bg-black/60 flex items-end justify-center"
      @click="showPlaylistPicker = false"
    >
      <div 
        class="w-full max-w-md bg-zinc-900 rounded-t-2xl p-4 pb-8"
        @click.stop
      >
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-white font-medium">添加到歌单</h3>
          <button @click="showPlaylistPicker = false" class="text-white/50 hover:text-white">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
        
        <div v-if="userPlaylists.length === 0" class="text-center py-8 text-white/50">
          <p>暂无歌单</p>
          <p class="text-sm mt-1">请先在"我的歌单"中创建歌单</p>
        </div>
        
        <div v-else class="space-y-2 max-h-60 overflow-y-auto">
          <button
            v-for="pl in userPlaylists"
            :key="pl.id"
            @click="addToPlaylist(pl.id)"
            class="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-white/10 transition-colors text-left"
          >
            <div class="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
              <svg class="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/>
              </svg>
            </div>
            <span class="text-white">{{ pl.name }}</span>
          </button>
        </div>
      </div>
    </div>
  </Transition>

  <!-- 播放列表抽屉 -->
  <Transition name="slide-up">
    <div 
      v-if="showPlaylistDrawer" 
      class="fixed inset-0 z-[60] bg-black/60 flex items-end justify-center"
      @click="showPlaylistDrawer = false"
    >
      <div 
        class="w-full max-w-md bg-zinc-900 rounded-t-2xl max-h-[70vh] flex flex-col"
        @click.stop
      >
        <!-- 头部 -->
        <div class="flex items-center justify-between p-4 border-b border-white/10 flex-shrink-0">
          <div class="flex items-center gap-2">
            <h3 class="text-white font-medium">播放列表</h3>
            <span class="text-white/40 text-sm">({{ store.playlist.length }}首)</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-white/50 text-xs px-2 py-1 rounded bg-white/10">{{ playModeText }}</span>
            <button @click="showPlaylistDrawer = false" class="text-white/50 hover:text-white p-1">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>
        
        <!-- 列表 -->
        <div class="flex-1 overflow-y-auto">
          <div
            v-for="(track, index) in store.playlist"
            :key="track.id"
            @click="playFromList(index)"
            :class="[
              'flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors',
              store.currentIndex === index ? 'bg-purple-600/20' : 'hover:bg-white/5'
            ]"
          >
            <!-- 序号/播放指示 -->
            <div class="w-6 text-center flex-shrink-0">
              <span v-if="store.currentIndex === index" class="text-purple-400 text-sm">▶</span>
              <span v-else class="text-white/30 text-sm">{{ index + 1 }}</span>
            </div>
            <!-- 歌曲信息 -->
            <div class="flex-1 min-w-0">
              <p :class="['text-sm truncate', store.currentIndex === index ? 'text-purple-400' : 'text-white']">
                {{ track.title }}
              </p>
              <p class="text-white/40 text-xs truncate">{{ track.artist }}</p>
            </div>
            <!-- 删除按钮 -->
            <button 
              @click.stop="removeFromList(index)"
              class="text-white/30 hover:text-red-400 p-1 transition-colors"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* 安全区域顶部间距 */
.pt-safe-top {
  padding-top: calc(env(safe-area-inset-top, 0px) + 0.75rem);
}

.slide-enter-active,
.slide-leave-active {
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}
.slide-enter-from,
.slide-leave-to {
  opacity: 0;
  transform: translateY(100%);
}

/* 抽屉动画 */
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s ease;
}
.slide-up-enter-active > div:last-child,
.slide-up-leave-active > div:last-child {
  transition: transform 0.3s ease;
}
.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
}
.slide-up-enter-from > div:last-child,
.slide-up-leave-to > div:last-child {
  transform: translateY(100%);
}

/* 唱片旋转动画 */
@keyframes spin-slow {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.animate-spin-slow {
  animation: spin-slow 20s linear infinite;
}

/* 黑胶唱片旋转 */
@keyframes spin-vinyl {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.animate-spin-vinyl {
  animation: spin-vinyl 4s linear infinite;
}

/* 黑胶唱片样式 */
.vinyl-disc {
  box-shadow: 
    0 0 0 2px rgba(255,255,255,0.1),
    0 10px 40px rgba(0,0,0,0.5),
    inset 0 0 30px rgba(0,0,0,0.3);
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

/* 滑动卡片样式 */
.swipe-card {
  border: 1px solid rgba(255, 255, 255, 0.1);
}

/* 封面播放动效 */
.cover-playing {
  box-shadow: 0 0 40px rgba(168, 85, 247, 0.3);
}

/* 音频均衡器动画 */
@keyframes eq-1 {
  0%, 100% { height: 8px; }
  50% { height: 24px; }
}
@keyframes eq-2 {
  0%, 100% { height: 16px; }
  50% { height: 8px; }
}
@keyframes eq-3 {
  0%, 100% { height: 12px; }
  50% { height: 28px; }
}
@keyframes eq-4 {
  0%, 100% { height: 20px; }
  50% { height: 12px; }
}

.animate-eq-1 {
  animation: eq-1 0.8s ease-in-out infinite;
}
.animate-eq-2 {
  animation: eq-2 0.6s ease-in-out infinite 0.1s;
}
.animate-eq-3 {
  animation: eq-3 0.7s ease-in-out infinite 0.2s;
}
.animate-eq-4 {
  animation: eq-4 0.5s ease-in-out infinite 0.3s;
}

/* 淡入淡出动画 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* 播放控制按钮样式 */
.control-btn {
  backdrop-filter: blur(10px);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.control-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.2);
}

/* 播放按钮脉冲动画 */
.play-btn {
  position: relative;
}
.play-btn::before {
  content: '';
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  background: inherit;
  opacity: 0;
  z-index: -1;
  animation: pulse-ring 2s ease-out infinite;
}
@keyframes pulse-ring {
  0% {
    transform: scale(0.9);
    opacity: 0.5;
  }
  100% {
    transform: scale(1.2);
    opacity: 0;
  }
}
</style>
