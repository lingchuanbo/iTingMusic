<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { usePlayerStore } from '@/store/player'
import { audioPlayer } from '@/services/player/AudioPlayer'
import { parseLyrics, getCurrentLyricIndex } from '@/utils/parseLyrics'
import { getLyrics, type MusicSource } from '@/services/source/OnlineApiSource'
import { formatTime } from '@/utils/formatTime'
import { audioCache } from '@/services/cache/AudioCache'
import { trackStorage } from '@/services/TrackStorage'
import { downloadService } from '@/services/DownloadService'

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
const showLyricsSettings = ref(false) // 歌词设置面板

// 歌词设置（从 localStorage 读取）
interface LyricsSettings {
  blur: boolean // 是否启用模糊效果
  align: 'center' | 'left' // 对齐方式
  currentColor: string // 当前歌词颜色
}

const defaultLyricsSettings: LyricsSettings = {
  blur: true,
  align: 'center',
  currentColor: '#ffffff'
}

const lyricsSettings = ref<LyricsSettings>({ ...defaultLyricsSettings })

// 预设颜色
const presetColors = [
  '#ffffff', // 白色
  '#a855f7', // 紫色
  '#ec4899', // 粉色
  '#3b82f6', // 蓝色
  '#22c55e', // 绿色
  '#eab308', // 黄色
  '#f97316', // 橙色
  '#ef4444', // 红色
]

// 加载歌词设置
function loadLyricsSettings() {
  try {
    const saved = localStorage.getItem('lyrics_settings')
    if (saved) {
      lyricsSettings.value = { ...defaultLyricsSettings, ...JSON.parse(saved) }
    }
  } catch {
    // ignore
  }
}

// 保存歌词设置
function saveLyricsSettings() {
  localStorage.setItem('lyrics_settings', JSON.stringify(lyricsSettings.value))
}

// 切换模糊效果
function toggleBlur() {
  lyricsSettings.value.blur = !lyricsSettings.value.blur
  saveLyricsSettings()
}

// 切换对齐方式（保留以备将来使用）
function _toggleAlign() {
  lyricsSettings.value.align = lyricsSettings.value.align === 'center' ? 'left' : 'center'
  saveLyricsSettings()
}
void _toggleAlign

// 设置当前歌词颜色
function setCurrentColor(color: string) {
  lyricsSettings.value.currentColor = color
  saveLyricsSettings()
}

// 初始化加载设置
onMounted(() => {
  loadLyricsSettings()
})

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

// 清空播放列表
function clearPlaylist() {
  if (!confirm('确定清空播放列表？')) return
  store.clearPlaylist()
  showPlaylistDrawer.value = false
  store.toggleLyrics()
}

// 收藏相关
const favoriteVersion = ref(0) // 用于触发响应式更新

const isFavorite = computed(() => {
  // 依赖 favoriteVersion 触发响应式更新
  void favoriteVersion.value
  if (!store.currentTrack) return false
  const ids = JSON.parse(localStorage.getItem('favorites') || '[]')
  return ids.includes(store.currentTrack.id)
})

function toggleFavorite() {
  if (!store.currentTrack) return
  const ids = JSON.parse(localStorage.getItem('favorites') || '[]')
  const favData = JSON.parse(localStorage.getItem('favorites_data') || '[]')
  const idx = ids.indexOf(store.currentTrack.id)
  if (idx >= 0) {
    ids.splice(idx, 1)
    const dataIdx = favData.findIndex((t: any) => t.id === store.currentTrack!.id)
    if (dataIdx >= 0) favData.splice(dataIdx, 1)
  } else {
    ids.push(store.currentTrack.id)
    // 保存完整歌曲数据
    if (!favData.some((t: any) => t.id === store.currentTrack!.id)) {
      favData.push(store.currentTrack)
    }
  }
  localStorage.setItem('favorites', JSON.stringify(ids))
  localStorage.setItem('favorites_data', JSON.stringify(favData))
  // 触发响应式更新
  favoriteVersion.value++
}

// 下载相关
const isDownloading = ref(false)
const downloadProgress = ref(0)

const isDownloaded = computed(() => {
  // 简单判断：本地文件或已缓存
  if (!store.currentTrack) return false
  return store.currentTrack.url.startsWith('blob:') || store.currentTrack._cached === true
})

async function handleDownload() {
  if (!store.currentTrack || isDownloaded.value || isDownloading.value) return
  
  isDownloading.value = true
  downloadProgress.value = 0
  
  // 监听下载进度
  const unsubscribe = downloadService.addListener((task) => {
    if (task.id === store.currentTrack?.id) {
      downloadProgress.value = task.progress
      if (task.status === 'completed' || task.status === 'failed') {
        isDownloading.value = false
        unsubscribe()
      }
    }
  })
  
  await downloadService.download(store.currentTrack)
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
  
  // 保存歌曲数据到 trackStorage
  trackStorage.saveTrack(store.currentTrack)
  
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
let lastScrolledIndex = -1 // 记录上次滚动的索引，避免重复滚动

// 自动滚动到当前歌词 - 优化：减少不必要的滚动
watch(currentLyricIndex, (index) => {
  // 用户正在滚动时不自动滚动，或者歌词面板未显示歌词视图
  if (isUserScrolling.value || !showLyrics.value) return
  // 避免重复滚动到同一行
  if (index === lastScrolledIndex) return
  if (index >= 0 && lyricsContainer.value) {
    lastScrolledIndex = index
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
    seekingLyricIndex.value = -1
    // 延迟恢复自动滚动，避免跳转后立即被自动滚动覆盖
    userScrollTimer.value = window.setTimeout(() => {
      isUserScrolling.value = false
    }, 500)
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

// 根据歌词距离当前行的远近计算样式（透明度和模糊）
function getLyricStyle(index: number) {
  // 用户滚动时不应用距离效果
  if (isUserScrolling.value) {
    return {}
  }

  const distance = Math.abs(index - currentLyricIndex.value)

  // 当前行
  if (distance === 0) {
    return {
      opacity: 1,
      filter: 'blur(0px)',
      fontSize: '1.25rem',
      color: lyricsSettings.value.currentColor
    }
  }

  // 根据距离计算透明度和模糊度
  const opacity = Math.max(0.15, 1 - distance * 0.15)
  const blur =
    lyricsSettings.value.blur && distance > 2
      ? Math.min((distance - 2) * 0.5, 2)
      : 0
  const fontSize = distance <= 1 ? '1rem' : '0.95rem'

  return {
    opacity,
    filter: `blur(${blur}px)`,
    fontSize
  }
}

// 加载歌词的函数（可复用）
async function loadLyricsForTrack(forceRefresh = false) {
  const track = store.currentTrack
  if (!track || (!track._platform && !track._songId)) return
  
  // 如果不是强制刷新且已有歌词，则跳过
  if (!forceRefresh && track.lrc) return
  
  loadingLyrics.value = true
  try {
    // 强制刷新时跳过缓存
    if (!forceRefresh) {
      const cachedLrc = await audioCache.getLyrics(track.id)
      if (cachedLrc) {
        track.lrc = cachedLrc
        return
      }
    }
    
    // 从网络获取并缓存
    if (track._platform && track._songId) {
      const lrc = await getLyrics(track._platform as MusicSource, track._songId)
      if (lrc) {
        track.lrc = lrc
        audioCache.cacheLyrics(track.id, lrc)
      }
    }
  } finally {
    loadingLyrics.value = false
  }
}

// 刷新歌词
async function refreshLyrics() {
  await loadLyricsForTrack(true)
}

// 当打开歌词面板时，如果没有歌词则尝试加载
watch(() => store.showLyrics, async (show) => {
  if (show && store.currentTrack && !store.currentTrack.lrc) {
    await loadLyricsForTrack()
  }
  // 重置为唱片视图
  if (show) showLyrics.value = false
})

// 当切换到歌词视图时，滚动到当前歌词位置
watch(showLyrics, (show) => {
  if (show) {
    // 重置用户滚动状态
    isUserScrolling.value = false
  }
})

// Transition 进入时立即滚动
function onLyricsEnter() {
  if (showLyrics.value) {
    // 立即滚动，不等待动画
    scrollToCurrentLyric()
    // 再次确保位置正确
    requestAnimationFrame(() => {
      scrollToCurrentLyric()
    })
  }
}

// 滚动到当前歌词位置
function scrollToCurrentLyric() {
  const index = currentLyricIndex.value
  if (index >= 0 && lyricsContainer.value && lyricsContainer.value.children[index]) {
    const el = lyricsContainer.value.children[index] as HTMLElement
    // 直接设置 scrollTop 实现即时滚动
    const scrollArea = lyricsScrollArea.value
    if (scrollArea && el.offsetTop !== undefined) {
      const elTop = el.offsetTop
      const elHeight = el.offsetHeight
      const scrollAreaHeight = scrollArea.clientHeight
      scrollArea.scrollTop = elTop - scrollAreaHeight / 2 + elHeight / 2
    }
  }
}

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
        <!-- 动态渐变光效 -->
        <div class="absolute inset-0 lyrics-panel-glow opacity-30"></div>
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
        <!-- 歌词设置 -->
        <button 
          @click.stop="showLyricsSettings = true"
          class="w-10 h-10 rounded-full flex items-center justify-center text-white/60 hover:text-white transition-colors"
          title="歌词设置"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
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
        <Transition name="disc-fade" mode="out-in" @enter="onLyricsEnter">
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
                      <button @click.stop="handleDownload" :disabled="isDownloading" :class="isDownloaded ? 'text-green-400' : isDownloading ? 'text-purple-400' : 'text-white/60 hover:text-white'" class="transition-colors relative">
                        <svg v-if="isDownloaded" class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                        </svg>
                        <template v-else-if="isDownloading">
                          <svg class="w-6 h-6 -rotate-90" viewBox="0 0 24 24">
                            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.5" class="opacity-20"/>
                            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
                              :stroke-dasharray="62.83" :stroke-dashoffset="62.83 * (1 - downloadProgress / 100)"/>
                          </svg>
                          <span class="absolute inset-0 flex items-center justify-center text-[8px] font-bold">{{ downloadProgress }}</span>
                        </template>
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
            <!-- 黑胶唱片 + 唱针容器 -->
            <div class="relative mt-6">
              <!-- 唱针 - 定位在唱片右上角 -->
              <div class="absolute -top-14 -right-6 md:-top-16 md:-right-4 z-20 drop-shadow-lg">
                <svg 
                  :class="[
                    'w-24 h-32 md:w-28 md:h-36 origin-[20%_15%]',
                    store.isPlaying ? 'needle-playing' : 'needle-idle'
                  ]"
                  viewBox="0 0 60 90"
                >
                  <defs>
                    <!-- 底座渐变 - 金属质感 -->
                    <radialGradient id="needleBaseGrad" cx="30%" cy="30%">
                      <stop offset="0%" style="stop-color:#c0c0c0"/>
                      <stop offset="50%" style="stop-color:#808080"/>
                      <stop offset="100%" style="stop-color:#404040"/>
                    </radialGradient>
                    <!-- 唱臂渐变 - 拉丝金属 -->
                    <linearGradient id="needleArmGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" style="stop-color:#d0d0d0"/>
                      <stop offset="30%" style="stop-color:#a0a0a0"/>
                      <stop offset="70%" style="stop-color:#909090"/>
                      <stop offset="100%" style="stop-color:#707070"/>
                    </linearGradient>
                    <!-- 唱头渐变 -->
                    <linearGradient id="needleHeadGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" style="stop-color:#a0a0a0"/>
                      <stop offset="100%" style="stop-color:#505050"/>
                    </linearGradient>
                    <!-- 阴影滤镜 -->
                    <filter id="needleShadow" x="-20%" y="-20%" width="140%" height="140%">
                      <feDropShadow dx="2" dy="3" stdDeviation="2" flood-opacity="0.4"/>
                    </filter>
                  </defs>
                  <!-- 底座阴影 -->
                  <circle cx="13" cy="14" r="10" fill="rgba(0,0,0,0.3)"/>
                  <!-- 底座外圈 -->
                  <circle cx="12" cy="12" r="10" fill="url(#needleBaseGrad)"/>
                  <!-- 底座内圈 -->
                  <circle cx="12" cy="12" r="7" fill="#505050"/>
                  <!-- 底座高光 -->
                  <circle cx="10" cy="10" r="3" fill="rgba(255,255,255,0.2)"/>
                  <!-- 底座中心螺丝 -->
                  <circle cx="12" cy="12" r="3" fill="#303030"/>
                  <circle cx="11" cy="11" r="1" fill="rgba(255,255,255,0.15)"/>
                  <!-- 唱臂阴影 -->
                  <path d="M13 19 Q 23 46, 39 73" stroke="rgba(0,0,0,0.3)" stroke-width="5" fill="none" stroke-linecap="round"/>
                  <!-- 唱臂主体 -->
                  <path d="M12 18 Q 22 45, 38 72" stroke="url(#needleArmGrad)" stroke-width="4" fill="none" stroke-linecap="round" filter="url(#needleShadow)"/>
                  <!-- 唱臂高光线 -->
                  <path d="M12 17 Q 21 43, 36 69" stroke="rgba(255,255,255,0.15)" stroke-width="1" fill="none" stroke-linecap="round"/>
                  <!-- 唱头外壳 -->
                  <ellipse cx="40" cy="76" rx="5" ry="7" fill="url(#needleHeadGrad)"/>
                  <!-- 唱头高光 -->
                  <ellipse cx="38" cy="74" rx="2" ry="3" fill="rgba(255,255,255,0.1)"/>
                  <!-- 唱针 -->
                  <ellipse cx="40" cy="82" rx="1" ry="2.5" fill="#303030"/>
                  <ellipse cx="40" cy="84" rx="0.5" ry="1" fill="#c0c0c0"/>
                </svg>
              </div>

              <!-- 黑胶唱片 -->
              <div 
                :class="['w-64 h-64 md:w-72 md:h-72 rounded-full relative vinyl-record', store.isPlaying ? 'animate-spin-slow' : '']"
              >
                <!-- 底部外发光 -->
                <div 
                  :class="['absolute -inset-4 rounded-full pointer-events-none transition-opacity duration-500', store.isPlaying ? 'opacity-100' : 'opacity-40']"
                  style="background: radial-gradient(ellipse 80% 50% at 50% 100%, rgba(168, 85, 247, 0.4) 0%, rgba(139, 92, 246, 0.2) 30%, transparent 70%); filter: blur(20px);"
                ></div>
                <!-- 外圈玻璃效果 -->
                <div class="absolute -inset-2 rounded-full" style="background: linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.03) 50%, rgba(255,255,255,0.08) 100%); box-shadow: inset 0 1px 1px rgba(255,255,255,0.2), inset 0 -1px 1px rgba(0,0,0,0.1), 0 0 20px rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1);"></div>
                <!-- 唱片主体 - 多层渐变 -->
                <div class="absolute inset-0 rounded-full bg-gradient-to-br from-zinc-800 via-black to-zinc-900"></div>
                <!-- 唱片边缘高光 -->
                <div class="absolute inset-0 rounded-full" style="background: conic-gradient(from 0deg, transparent 0%, rgba(255,255,255,0.08) 10%, transparent 20%, rgba(255,255,255,0.05) 30%, transparent 40%, rgba(255,255,255,0.08) 50%, transparent 60%, rgba(255,255,255,0.05) 70%, transparent 80%, rgba(255,255,255,0.08) 90%, transparent 100%);"></div>
                <!-- 唱片纹路 - 更细腻 -->
                <div class="absolute inset-[2%] rounded-full border border-zinc-700/50"></div>
                <div class="absolute inset-[4%] rounded-full border border-zinc-600/30"></div>
                <div class="absolute inset-[6%] rounded-full border border-zinc-700/40"></div>
                <div class="absolute inset-[8%] rounded-full border border-zinc-600/25"></div>
                <div class="absolute inset-[10%] rounded-full border border-zinc-700/35"></div>
                <div class="absolute inset-[12%] rounded-full border border-zinc-600/30"></div>
                <div class="absolute inset-[14%] rounded-full border border-zinc-700/40"></div>
                <div class="absolute inset-[16%] rounded-full border border-zinc-600/25"></div>
                <div class="absolute inset-[18%] rounded-full border border-zinc-700/35"></div>
                <div class="absolute inset-[20%] rounded-full border border-zinc-600/30"></div>
                <div class="absolute inset-[22%] rounded-full border border-zinc-700/40"></div>
                <!-- 封面区域 -->
                <div class="absolute inset-[26%] rounded-full overflow-hidden shadow-inner" style="box-shadow: inset 0 2px 8px rgba(0,0,0,0.5), 0 0 0 3px #404040, 0 0 0 5px #303030;">
                  <img v-if="store.currentTrack?.cover" :src="store.currentTrack.cover" class="w-full h-full object-cover" draggable="false"/>
                  <div v-else class="w-full h-full flex items-center justify-center text-4xl bg-gradient-to-br from-purple-600/50 to-pink-600/50">🎵</div>
                </div>
                <!-- 中心轴 - 金属质感 -->
                <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 md:w-5 md:h-5 rounded-full" style="background: radial-gradient(circle at 30% 30%, #e0e0e0, #808080 50%, #404040); box-shadow: inset 0 1px 2px rgba(255,255,255,0.3), 0 1px 3px rgba(0,0,0,0.5);"></div>
                <!-- 中心轴孔 -->
                <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-zinc-900"></div>
                <!-- 顶部光泽 -->
                <div class="absolute inset-0 rounded-full pointer-events-none" style="background: linear-gradient(135deg, rgba(255,255,255,0.12) 0%, transparent 40%, transparent 60%, rgba(0,0,0,0.1) 100%);"></div>
                <!-- 边缘阴影 -->
                <div class="absolute inset-0 rounded-full pointer-events-none" style="box-shadow: inset 0 0 20px rgba(0,0,0,0.5), 0 8px 32px rgba(0,0,0,0.4);"></div>
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
                <button @click.stop="handleDownload" :disabled="isDownloading" :class="isDownloaded ? 'text-green-400' : isDownloading ? 'text-purple-400' : 'text-white/60 hover:text-white'" class="transition-colors relative">
                  <svg v-if="isDownloaded" class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                  </svg>
                  <template v-else-if="isDownloading">
                    <svg class="w-6 h-6 -rotate-90" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.5" class="opacity-20"/>
                      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
                        :stroke-dasharray="62.83" :stroke-dashoffset="62.83 * (1 - downloadProgress / 100)"/>
                    </svg>
                    <span class="absolute inset-0 flex items-center justify-center text-[8px] font-bold">{{ downloadProgress }}</span>
                  </template>
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
              :class="[
                'flex-1 w-full overflow-y-auto px-6 md:px-12 lyrics-scroll relative',
                lyricsSettings.align === 'center' ? 'text-center' : 'text-left'
              ]"
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
                <button 
                  v-if="store.currentTrack?._platform && store.currentTrack?._songId"
                  @click.stop="refreshLyrics"
                  class="mt-4 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white/60 hover:text-white text-sm flex items-center gap-2 transition-colors"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                  </svg>
                  重新加载
                </button>
              </div>
              <div v-else ref="lyricsContainer" class="py-[40vh]">
                <p
                  v-for="(line, index) in lyrics"
                  :key="index"
                  :class="[
                    'transition-all duration-300 leading-relaxed py-3',
                    currentLyricIndex === index 
                      ? 'text-white text-xl md:text-2xl font-bold' 
                      : isUserScrolling && seekingLyricIndex === index
                        ? 'text-purple-400 text-lg font-medium'
                        : 'text-white/60'
                  ]"
                  :style="getLyricStyle(index)"
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
        
        <!-- 歌词显示区域（卡片/黑胶模式下显示，绝对定位在底部） -->
        <div v-if="!showLyrics && lyrics.length > 0" class="absolute bottom-[80px] left-0 right-0 px-6 text-center pointer-events-none">
          <p class="text-white/90 text-sm font-medium truncate transition-all duration-300">
            {{ currentLyricIndex >= 0 ? lyrics[currentLyricIndex]?.text : '♪ ♪ ♪' }}
          </p>
          <p v-if="currentLyricIndex >= 0 && currentLyricIndex + 1 < lyrics.length" class="text-white/50 text-xs truncate transition-all duration-300 mt-1">
            {{ lyrics[currentLyricIndex + 1]?.text }}
          </p>
        </div>
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
              <!-- 缓冲进度（灰色） -->
              <div 
                class="absolute h-full bg-white/30 rounded-full transition-all duration-300"
                :style="{ width: `${store.buffered}%` }"
              ></div>
              <!-- 播放进度（白色） -->
              <div 
                class="absolute h-full bg-white rounded-full"
                :style="{ width: `${store.progress}%` }"
              ></div>
              <!-- 拖动手柄 -->
              <div 
                class="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg transition-transform"
                :class="isDragging ? 'scale-125' : ''"
                :style="{ left: `calc(${store.progress}% - 6px)` }"
              ></div>
              <!-- 缓存完成指示（绿色小点 + 点亮动画） -->
              <Transition name="cache-dot">
                <div
                  v-if="store.isCached"
                  class="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-green-500 cache-dot-glow"
                ></div>
              </Transition>
            </div>
          </div>
          <span class="text-white/50 text-xs w-10 font-mono flex items-center gap-1">
            <Transition name="cache-dot-small">
              <span v-if="store.isCached" class="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0 cache-dot-glow-small"></span>
            </Transition>
            {{ formatTime(store.duration) }}
          </span>
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
            <button 
              @click="clearPlaylist" 
              class="text-white/50 hover:text-red-400 text-xs px-2 py-1 rounded bg-white/10 hover:bg-red-500/20 transition-colors"
            >
              清空
            </button>
            <button 
              @click="store.togglePlayMode()" 
              class="text-white/50 hover:text-purple-400 text-xs px-2 py-1 rounded bg-white/10 hover:bg-purple-500/20 transition-colors"
            >
              {{ playModeText }}
            </button>
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

  <!-- 歌词设置面板 -->
  <Transition name="slide-up">
    <div 
      v-if="showLyricsSettings" 
      class="fixed inset-0 z-[60] bg-black/60 flex items-end justify-center"
      @click="showLyricsSettings = false"
    >
      <div 
        class="w-full max-w-md bg-zinc-900 rounded-t-2xl p-4 pb-8"
        @click.stop
      >
        <div class="flex items-center justify-between mb-6">
          <h3 class="text-white font-medium">歌词设置</h3>
          <button @click="showLyricsSettings = false" class="text-white/50 hover:text-white">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
        
        <!-- 模糊效果 -->
        <div class="flex items-center justify-between py-3 border-b border-white/10">
          <div>
            <p class="text-white text-sm">歌词模糊</p>
            <p class="text-white/40 text-xs">远离当前行的歌词逐渐模糊</p>
          </div>
          <button 
            @click="toggleBlur"
            :class="[
              'w-12 h-7 rounded-full transition-colors relative',
              lyricsSettings.blur ? 'bg-purple-500' : 'bg-white/20'
            ]"
          >
            <span 
              :class="[
                'absolute top-1 w-5 h-5 bg-white rounded-full transition-transform',
                lyricsSettings.blur ? 'left-6' : 'left-1'
              ]"
            ></span>
          </button>
        </div>
        
        <!-- 对齐方式 -->
        <div class="flex items-center justify-between py-3 border-b border-white/10">
          <div>
            <p class="text-white text-sm">对齐方式</p>
            <p class="text-white/40 text-xs">歌词文字的对齐方式</p>
          </div>
          <div class="flex gap-2">
            <button 
              @click="lyricsSettings.align = 'center'; saveLyricsSettings()"
              :class="[
                'px-3 py-1.5 rounded-lg text-xs transition-colors',
                lyricsSettings.align === 'center' ? 'bg-purple-500 text-white' : 'bg-white/10 text-white/60'
              ]"
            >
              居中
            </button>
            <button 
              @click="lyricsSettings.align = 'left'; saveLyricsSettings()"
              :class="[
                'px-3 py-1.5 rounded-lg text-xs transition-colors',
                lyricsSettings.align === 'left' ? 'bg-purple-500 text-white' : 'bg-white/10 text-white/60'
              ]"
            >
              左对齐
            </button>
          </div>
        </div>
        
        <!-- 当前歌词颜色 -->
        <div class="py-3">
          <div class="flex items-center justify-between mb-3">
            <div>
              <p class="text-white text-sm">当前歌词颜色</p>
              <p class="text-white/40 text-xs">正在播放的歌词高亮颜色</p>
            </div>
          </div>
          <div class="flex flex-wrap gap-3">
            <button
              v-for="color in presetColors"
              :key="color"
              @click="setCurrentColor(color)"
              :class="[
                'w-8 h-8 rounded-full transition-transform hover:scale-110',
                lyricsSettings.currentColor === color ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-900' : ''
              ]"
              :style="{ backgroundColor: color }"
            ></button>
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

/* 缓存完成小绿点动画 */
.cache-dot-glow {
  box-shadow: 0 0 8px rgba(34, 197, 94, 0.8);
}

.cache-dot-glow-small {
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.6);
}

@keyframes cache-dot-pulse {
  0% {
    transform: translateY(-50%) scale(0);
    opacity: 0;
    box-shadow: 0 0 0 rgba(34, 197, 94, 0);
  }
  50% {
    transform: translateY(-50%) scale(1.8);
    box-shadow: 0 0 16px rgba(34, 197, 94, 1);
  }
  100% {
    transform: translateY(-50%) scale(1);
    opacity: 1;
    box-shadow: 0 0 8px rgba(34, 197, 94, 0.8);
  }
}

@keyframes cache-dot-pulse-small {
  0% {
    transform: scale(0);
    opacity: 0;
  }
  50% {
    transform: scale(1.5);
    box-shadow: 0 0 10px rgba(34, 197, 94, 1);
  }
  100% {
    transform: scale(1);
    opacity: 1;
    box-shadow: 0 0 6px rgba(34, 197, 94, 0.6);
  }
}

.cache-dot-enter-active {
  animation: cache-dot-pulse 0.5s ease-out forwards;
}
.cache-dot-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}
.cache-dot-leave-to {
  opacity: 0;
  transform: translateY(-50%) scale(0);
}

.cache-dot-small-enter-active {
  animation: cache-dot-pulse-small 0.5s ease-out forwards;
}
.cache-dot-small-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}
.cache-dot-small-leave-to {
  opacity: 0;
  transform: scale(0);
}

/* 动态渐变光效 */
.lyrics-panel-glow {
  background: linear-gradient(
    135deg,
    rgba(139, 92, 246, 0.6),
    rgba(236, 72, 153, 0.5),
    rgba(59, 130, 246, 0.5),
    rgba(16, 185, 129, 0.4),
    rgba(245, 158, 11, 0.5),
    rgba(239, 68, 68, 0.5),
    rgba(139, 92, 246, 0.6)
  );
  background-size: 400% 400%;
  animation: lyrics-glow-shift 15s ease infinite;
}

@keyframes lyrics-glow-shift {
  0% {
    background-position: 0% 50%;
  }
  25% {
    background-position: 50% 100%;
  }
  50% {
    background-position: 100% 50%;
  }
  75% {
    background-position: 50% 0%;
  }
  100% {
    background-position: 0% 50%;
  }
}

/* 唱针动画 */
.needle-idle {
  transform: rotate(0deg);
  transition: transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.needle-playing {
  animation: needle-wobble 3s ease-in-out infinite;
}

@keyframes needle-wobble {
  0%, 100% {
    transform: rotate(24deg);
  }
  25% {
    transform: rotate(25.5deg);
  }
  50% {
    transform: rotate(23.5deg);
  }
  75% {
    transform: rotate(25deg);
  }
}
</style>
