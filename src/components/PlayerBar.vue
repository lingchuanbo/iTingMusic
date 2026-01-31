<script setup lang="ts">
import { ref, computed, onMounted, watch, onUnmounted } from 'vue'
import { usePlayerStore } from '@/store/player'
import { usePlaylistStore } from '@/store/playlist'
import { isSelectMode, isModalOpen, setPlayerExpanded, showPlaylist, showPlaylistPicker, registerCollapsePlayer } from '@/store/ui'
import { audioPlayer } from '@/services/player/AudioPlayer'
import { Capacitor } from '@capacitor/core'
import { formatTime } from '@/utils/formatTime'
import { parseLyrics, getCurrentLyricIndex } from '@/utils/parseLyrics'
import { trackStorage } from '@/services/TrackStorage'
import { behaviorService } from '@/services/BehaviorService'
import CachedImage from '@/components/common/CachedImage.vue'
import PlaylistPickerDialog from '@/components/common/PlaylistPickerDialog.vue'
import EqualizerView from '@/components/EqualizerView.vue'

const store = usePlayerStore()
const playlistStore = usePlaylistStore()
const playlistDragY = ref(0)
const isDraggingPlaylist = ref(false)
let playlistTouchStartY = 0

// EQ 状态
const showEQ = ref(false)

// Favorite functionality
const favoriteVersion = ref(0)

const isFavorite = computed(() => {
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
    if (!favData.some((t: any) => t.id === store.currentTrack!.id)) {
      favData.push(store.currentTrack)
    }
  }
  localStorage.setItem('favorites', JSON.stringify(ids))
  localStorage.setItem('favorites_data', JSON.stringify(favData))
  favoriteVersion.value++
}

// Playlist picker (使用全局状态 showPlaylistPicker)

function addToPlaylist(playlistId: string) {
  if (!store.currentTrack) return
  // 先保存歌曲数据到 trackStorage
  trackStorage.saveTrack(store.currentTrack)
  // 使用 playlistStore 添加歌曲到歌单
  playlistStore.addToPlaylist(playlistId, store.currentTrack.id)
  showPlaylistPicker.value = false
}

function handleCreatePlaylist() {
  const name = prompt('请输入歌单名称')
  if (!name || !name.trim()) return
  
  // 创建歌单
  const newPlaylist = playlistStore.createPlaylist(name.trim())
  
  // 如果有当前歌曲，直接添加到新歌单
  if (store.currentTrack) {
    trackStorage.saveTrack(store.currentTrack)
    playlistStore.addToPlaylist(newPlaylist.id, store.currentTrack.id)
  }
  
  showPlaylistPicker.value = false
}

// 推荐反馈
const currentFeedback = ref<'positive' | 'negative' | null>(null)
const feedbackToast = ref({ show: false, message: '' })

function updateCurrentFeedback() {
  if (!store.currentTrack) {
    currentFeedback.value = null
    return
  }
  currentFeedback.value = behaviorService.getLatestFeedback(store.currentTrack.id)
}

function handleFeedbackLike() {
  if (!store.currentTrack) return
  
  // 如果已经是正面反馈，再次点击取消 (Toggle behavior)
  if (currentFeedback.value === 'positive') {
    // 这里 BehaviorService 还没支持取消反馈，先记录一个新的中性行为或保持现状
    // 根据用户要求 "这2个只能选一个"，我们实现互斥
  }
  
  behaviorService.recordFeedback(store.currentTrack, true)
  currentFeedback.value = 'positive'
  feedbackToast.value = { show: true, message: '👍 已记录，会更多推荐类似歌曲' }
  setTimeout(() => { feedbackToast.value.show = false }, 2000)
}

function handleFeedbackDislike() {
  if (!store.currentTrack) return
  
  behaviorService.recordFeedback(store.currentTrack, false)
  currentFeedback.value = 'negative'
  feedbackToast.value = { show: true, message: '👎 已记录，会减少推荐类似歌曲' }
  setTimeout(() => { feedbackToast.value.show = false }, 2000)
}

// Play mode text
const playModeText = computed(() => {
  const modes: Record<string, string> = {
    sequence: '顺序播放',
    loop: '列表循环',
    single: '单曲循环',
    shuffle: '随机播放'
  }
  return modes[store.playMode] || '顺序播放'
})

// Progress bar dragging
const progressBarRef = ref<HTMLElement>()
const isDraggingProgress = ref(false)

function handleProgressStart(e: TouchEvent | MouseEvent) {
  e.stopPropagation()
  isDraggingProgress.value = true
  updateProgressFromEvent(e)
}

function handleProgressMove(e: TouchEvent | MouseEvent) {
  if (!isDraggingProgress.value) return
  e.stopPropagation()
  updateProgressFromEvent(e)
}

function handleProgressEnd(e: TouchEvent | MouseEvent) {
  if (!isDraggingProgress.value) return
  e.stopPropagation()
  isDraggingProgress.value = false
}

function updateProgressFromEvent(e: TouchEvent | MouseEvent) {
  if (!progressBarRef.value || store.duration <= 0) return
  const rect = progressBarRef.value.getBoundingClientRect()
  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
  const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  const newTime = percent * store.duration
  audioPlayer.seek(newTime)
  store.setCurrentTime(newTime)
}

// -------------------------------------------------------------
// Dynamic Background Color (从专辑封面提取主色调)
// -------------------------------------------------------------
const dominantColor = ref({ r: 88, g: 28, b: 135 }) // 默认紫色
const colorCache = new Map<string, { r: number, g: number, b: number }>()

// 从图片提取主色调
function extractDominantColor(imageUrl: string) {
  // 检查缓存
  const cached = colorCache.get(imageUrl)
  if (cached) {
    dominantColor.value = cached
    return
  }
  
  const img = new Image()
  img.crossOrigin = 'Anonymous'
  
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      
      // 缩小到很小的尺寸提取平均颜色
      canvas.width = 20
      canvas.height = 20
      ctx.drawImage(img, 0, 0, 20, 20)
      
      const imageData = ctx.getImageData(0, 0, 20, 20)
      const data = imageData.data
      
      let r = 0, g = 0, b = 0, count = 0
      
      // 计算平均颜色，排除太暗和太亮的像素
      for (let i = 0; i < data.length; i += 4) {
        const pr = data[i]
        const pg = data[i + 1]
        const pb = data[i + 2]
        const brightness = (pr + pg + pb) / 3
        
        // 排除太暗（<30）和太亮（>225）的像素
        if (brightness >= 30 && brightness <= 225) {
          r += pr
          g += pg
          b += pb
          count++
        }
      }
      
      if (count > 0) {
        const newColor = {
          r: Math.round(r / count),
          g: Math.round(g / count),
          b: Math.round(b / count)
        }
        // 缓存颜色
        colorCache.set(imageUrl, newColor)
        dominantColor.value = newColor
      }
    } catch (e) {
      // 跨域错误等，使用默认颜色
      console.warn('Failed to extract color:', e)
    }
  }
  
  img.onerror = () => {
    // 加载失败，使用默认颜色
    dominantColor.value = { r: 88, g: 28, b: 135 }
  }
  
  img.src = imageUrl
}

// 当歌曲切换时提取颜色并检查缓存状态
watch(() => store.currentTrack, async (newTrack, oldTrack) => {
  // 只有当歌曲真正变化时才更新
  if (newTrack?.id !== oldTrack?.id) {
    // 提取封面颜色
    if (newTrack?.cover) {
      extractDominantColor(newTrack.cover)
    } else {
      // 没有封面时使用默认紫色
      dominantColor.value = { r: 88, g: 28, b: 135 }
    }
    
    // 检查缓存状态 (使用前端缓存追踪)
    store.checkAndSetCached()
    
    // 更新推荐反馈状态
    updateCurrentFeedback()
  }
}, { immediate: true, deep: false })

// 动态背景样式
const dynamicBackgroundStyle = computed(() => {
  const { r, g, b } = dominantColor.value
  const progress = dragProgress.value
  
  if (progress < 0.1) {
    // 收起状态 - 使用固定深色背景
    return {
      transition: 'background 0.8s ease-out'
    }
  }
  
  // 展开状态 - 使用渐变背景
  return {
    background: `linear-gradient(to bottom, 
      rgba(${r}, ${g}, ${b}, 0.6) 0%, 
      rgba(${Math.round(r * 0.3)}, ${Math.round(g * 0.3)}, ${Math.round(b * 0.3)}, 0.9) 40%, 
      rgba(24, 24, 27, 1) 100%)`,
    transition: 'background 0.8s ease-out'
  }
})

// -------------------------------------------------------------
// Animation & Gesture State
// -------------------------------------------------------------
// 窗口尺寸 (用于计算)
const screenHeight = ref(window.innerHeight)
const screenWidth = ref(window.innerWidth)

// 核心状态
const sheetOffset = ref(0) // 0 = minimized, 1 = expanded
const isDragging = ref(false)
const dragStartY = ref(0)
const dragStartSheetOffset = ref(0)
const initialHeight = 64 // 底部播放条高度

// 手势锁定
const isAxisLocked = ref(false)
const lockedAxis = ref<'x' | 'y' | null>(null)
const dragStartX = ref(0)

// 动画常数
const COLLAPSED_HEIGHT = initialHeight

// 更新窗口尺寸
const updateScreenSize = () => {
  screenHeight.value = window.innerHeight
  screenWidth.value = window.innerWidth
}

onMounted(() => {
  window.addEventListener('resize', updateScreenSize)
  // 初始化 lyrics setting
  const saved = localStorage.getItem(PLAYER_BAR_LYRICS_KEY)
  if (saved !== null) {
    showLyrics.value = saved === 'true'
  }
  
  // 注册收起播放器的回调，用于返回键处理
  registerCollapsePlayer(() => {
    sheetOffset.value = 0
  })
})

onUnmounted(() => {
  window.removeEventListener('resize', updateScreenSize)
})

// -------------------------------------------------------------
// Computed Animation Styles
// -------------------------------------------------------------

// 拖拽进度 (用于驱动动画)
const dragProgress = computed(() => {
  return sheetOffset.value
})

/**
 * 1. Main Container Style
 * Grows from bottom up.
 */
const containerStyle = computed(() => {
  const currentHeight = COLLAPSED_HEIGHT + dragProgress.value * (screenHeight.value - COLLAPSED_HEIGHT)
  const borderRadius = Math.max(0, dragProgress.value * 24) 

  // Desktop adaptation: Start at left-20 (5rem) to clear sidebar when minimized, full screen when expanded
  const isDesktop = screenWidth.value >= 768
  // When expanded (dragProgress > 0.5), immediately go fullscreen
  const currentLeft = isDesktop && dragProgress.value < 0.5 ? (5 * 16) : 0

  // Mobile: 计算动态 bottom 值 - 展开时从导航栏上方过渡到 0
  // 收起时 bottom = 3.5rem (56px) + safe-area，展开时 bottom = 0
  // 需要使用 CSS calc 来包含安全区域，因为 safe-area 只能在 CSS 中获取
  const mobileNavHeight = isDesktop ? 0 : 56 // 3.5rem = 56px
  const currentBottomBase = mobileNavHeight * (1 - dragProgress.value)
  
  // 当收起或正在展开时，需要包含安全区域
  // 展开完成时(dragProgress >= 1)，不需要安全区域
  const needsSafeArea = !isDesktop && dragProgress.value < 1
  const bottomValue = needsSafeArea
    ? `calc(${currentBottomBase}px + env(safe-area-inset-bottom, 0px) * ${1 - dragProgress.value})`
    : `${currentBottomBase}px`

  const style: any = {
    height: `${currentHeight}px`,
    left: `${currentLeft}px`,
    bottom: bottomValue,
    borderTopLeftRadius: `${borderRadius}px`,
    borderTopRightRadius: `${borderRadius}px`,
    willChange: 'height, left, bottom, border-radius',
    transform: 'translateZ(0)'
  }

  if (isDragging.value) {
    style.transition = 'none'
  } else {
    style.transition = 'all 0.28s cubic-bezier(0.25, 1.15, 0.5, 1)' 
  }
  
  return style
})

/**
 * 2. Floating Cover Style (The "Morph" Effect)
 */
const floatingCoverStyle = computed(() => {
  const p = dragProgress.value
  
  // Size: 40px -> 280px (封面大小)
  const startSize = 40
  const endSize = 300
  const currentSize = startSize + p * (endSize - startSize)
  
  // Position Left: 16px -> Center
  const startLeft = 16 
  const endLeft = (screenWidth.value - endSize) / 2
  const currentLeft = startLeft + p * (endLeft - startLeft)

  // Position Bottom: 12px -> Calculated endBottom (封面位置 50%)
  const startBottom = 12
  const endBottom = screenHeight.value * 0.50
  const currentBottom = startBottom + p * (endBottom - startBottom)

  // Border Radius: 50% (of 40px = 20px) -> 12px
  // Interpolate pixels: 20px -> 12px
  const currentRadiusVal = 20 * (1-p) + 12 * p
  
  const shadowOpacity = p * 0.6

  return {
    width: `${currentSize}px`,
    height: `${currentSize}px`,
    left: `${currentLeft}px`,
    bottom: `${currentBottom}px`,
    borderRadius: `${currentRadiusVal}px`,
    boxShadow: `0 12px 50px rgba(0,0,0,${shadowOpacity}), 0 4px 20px rgba(139,92,246,${p * 0.15})`,
    position: 'absolute', 
    zIndex: 20,
    willChange: 'width, height, left, bottom, border-radius',
    transition: isDragging.value ? 'none' : 'all 0.28s cubic-bezier(0.25, 1.15, 0.5, 1)',
  } as any
})

/**
 * 3. Content Cross-Fade
 */
const miniControlStyle = computed(() => {
  const opacity = Math.max(0, 1 - dragProgress.value * 3)
  return { 
    opacity,
    pointerEvents: opacity < 0.1 ? 'none' : 'auto',
    transition: isDragging.value ? 'none' : 'opacity 0.3s ease'
  } as any
})

const expandedControlStyle = computed(() => {
  const opacity = Math.max(0, (dragProgress.value - 0.3) * 1.5)
  return { 
    opacity: dragProgress.value < 0.1 ? 0 : opacity, 
    pointerEvents: opacity < 0.9 ? 'none' : 'auto',
    zIndex: 30, // 确保控件在封面之上可点击
    transition: isDragging.value ? 'none' : 'opacity 0.3s ease'
  } as any
})


// -------------------------------------------------------------
// Gesture Logic
// -------------------------------------------------------------

// 速度感知变量
let lastTouchY = 0
let lastTouchTime = 0
let velocity = 0

function handleTouchStart(e: TouchEvent) {
  if (isSelectMode.value || isModalOpen.value) return
  
  isDragging.value = true
  dragStartY.value = e.touches[0].clientY
  dragStartX.value = e.touches[0].clientX
  dragStartSheetOffset.value = sheetOffset.value
  
  // 初始化速度追踪
  lastTouchY = e.touches[0].clientY
  lastTouchTime = Date.now()
  velocity = 0
  
  isAxisLocked.value = false
  lockedAxis.value = null
}

function handleTouchMove(e: TouchEvent) {
  if (!isDragging.value) return

  const currentY = e.touches[0].clientY
  const currentTime = Date.now()
  const dy = currentY - dragStartY.value
  const dx = e.touches[0].clientX - dragStartX.value

  // 计算速度 (px/ms)
  const timeDelta = currentTime - lastTouchTime
  if (timeDelta > 0) {
    velocity = (lastTouchY - currentY) / timeDelta
  }
  lastTouchY = currentY
  lastTouchTime = currentTime

  // Axis Locking
  if (!isAxisLocked.value) {
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
      lockedAxis.value = 'x'
      isAxisLocked.value = true
      isDragging.value = false 
      return 
    } else if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
      lockedAxis.value = 'y'
      isAxisLocked.value = true
    }
  }

  if (lockedAxis.value === 'x') return 

  const deltaHeight = -dy
  const maxDragDistance = screenHeight.value - COLLAPSED_HEIGHT
  
  // 增加拖拽灵敏度 1.5 倍，让单手操作更轻松
  const sensitivity = 1.5
  let newProgress = dragStartSheetOffset.value + (deltaHeight * sensitivity) / maxDragDistance
  newProgress = Math.max(0, Math.min(1, newProgress))
  sheetOffset.value = newProgress
}

function handleTouchEnd() {
  if (!isDragging.value) return
  isDragging.value = false

  const endProgress = sheetOffset.value
  
  // 速度阈值：快速滑动时更容易触发
  const velocityThreshold = 0.3 // px/ms
  const isQuickSwipeUp = velocity > velocityThreshold
  const isQuickSwipeDown = velocity < -velocityThreshold
  
  // 基于位置和速度的智能判断
  if (isQuickSwipeUp) {
    // 快速向上滑动 -> 展开
    sheetOffset.value = 1
  } else if (isQuickSwipeDown) {
    // 快速向下滑动 -> 收起
    sheetOffset.value = 0
  } else {
    // 慢速滑动，使用更低的阈值
    // 展开阈值：12%（从收起状态拉开）
    // 收起阈值：70%（从展开状态往下拉）
    if (dragStartSheetOffset.value < 0.5) {
      // 从收起状态开始拖拽
      sheetOffset.value = endProgress > 0.12 ? 1 : 0
    } else {
      // 从展开状态开始拖拽
      sheetOffset.value = endProgress > 0.7 ? 1 : 0
    }
  }
}

function toggleExpand() {
  sheetOffset.value = sheetOffset.value > 0.5 ? 0 : 1
}

// Sync player expansion state with global UI state
watch(sheetOffset, (value) => {
  setPlayerExpanded(value > 0.5)
})

// 歌词显示开关
const showLyrics = ref(false)
const PLAYER_BAR_LYRICS_KEY = 'player_bar_lyrics_visible'

function toggleLyrics() {
  // If expanded, toggle lyrics view? For now keep simple
  showLyrics.value = !showLyrics.value
  localStorage.setItem(PLAYER_BAR_LYRICS_KEY, String(showLyrics.value))
}

const currentLyrics = computed(() => {
  if (!store.currentTrack?.lrc) return []
  return parseLyrics(store.currentTrack.lrc)
})

const currentLyricIndex = computed(() => {
  return getCurrentLyricIndex(currentLyrics.value, store.currentTime)
})

const displayLyrics = computed(() => {
  if (currentLyrics.value.length === 0) return { current: '', next: '' }
  const idx = currentLyricIndex.value
  const current = idx >= 0 ? currentLyrics.value[idx]?.text || '' : ''
  const next = idx >= 0 && idx + 1 < currentLyrics.value.length ? currentLyrics.value[idx + 1]?.text || '' : ''
  return { current, next }
})

// 播放控制
function handleToggle() {
  // Android ExoPlayer 场景：audioPlayer.toggle() 会异步处理所有逻辑
  // 包括检查是否有媒体、加载歌曲、更新 isPlaying 状态
  const toggled = audioPlayer.toggle()
  
  // 如果 toggle 返回 false（没有当前歌曲），使用 playTrack 启动播放
  if (!toggled && store.currentTrack) {
    store.playTrack(store.currentIndex)
    return
  }
  
  // 对于 Android，audioPlayer.toggle() 的异步回调会更新 store.isPlaying
  // 这里检查是否是 Web 端（通过检查 Capacitor）
  if (!Capacitor.isNativePlatform()) {
    store.togglePlay()
  }
}

// 切换播放列表浮窗
function togglePlaylist() {
  showPlaylist.value = !showPlaylist.value
}

// 播放指定歌曲
function playSong(index: number) {
  store.playTrack(index)
}

// 播放播放列表中的上一首
function playPrev() {
  store.prevTrack()
}

// 播放播放列表中的下一首
function playNext() {
  store.nextTrack()
}

// 播放列表手势逻辑
function handlePlaylistTouchStart(e: TouchEvent) {
  // 我们只监听标题栏或者列表滚到顶部的滑动？
  // 先简单处理：检查是不是点击了顶部的标题区域
  const target = e.target as HTMLElement
  const isTitleBar = target.closest('.playlist-header')
  
  // 或者如果列表在顶部
  const listContainer = target.closest('.playlist-list')
  const isAtTop = listContainer ? listContainer.scrollTop <= 0 : true

  if (isTitleBar || isAtTop) {
    isDraggingPlaylist.value = true
    playlistTouchStartY = e.touches[0].clientY
    playlistDragY.value = 0
  }
}

function handlePlaylistTouchMove(e: TouchEvent) {
  if (!isDraggingPlaylist.value) return

  const dy = e.touches[0].clientY - playlistTouchStartY
  
  // 只允许向下拖拽
  if (dy > 0) {
    playlistDragY.value = dy
    // 阻止原生滚动
    if (e.cancelable) e.preventDefault()
  } else {
    playlistDragY.value = 0
  }
}

function handlePlaylistTouchEnd() {
  if (!isDraggingPlaylist.value) return
  isDraggingPlaylist.value = false

  // 超过阈值则关闭
  if (playlistDragY.value > 100) {
    showPlaylist.value = false
  }
  
  // 重置位置
  playlistDragY.value = 0
}
// 从列表移除
function removeTrack(index: number) {
  store.removeTrack(index)
}

// 清空播放列表
function clearPlaylist() {
  store.clearPlaylist()
  showPlaylist.value = false
}
</script>

<template>
  <!-- 简洁播放条 - 移动端在底部导航上方，多选模式时隐藏 -->
  <Transition name="player-bar">

    <div
      v-if="!isSelectMode && !isModalOpen"
      :class="[
        'fixed left-0 right-0 backdrop-blur-xl border-t border-white/10 bottom-0 overflow-hidden mobile-player-bar',
        sheetOffset > 0 ? '' : 'bg-zinc-900/98'
      ]"
      :style="{ ...containerStyle, ...dynamicBackgroundStyle, zIndex: sheetOffset > 0 ? 100 : 50 }"
      @touchstart="handleTouchStart"
      @touchmove="handleTouchMove"
      @touchend="handleTouchEnd"
      @click="!isDragging && sheetOffset < 0.5 && toggleExpand()"
    >

    <!-- ------------------------------------------------ -->
    <!--  1. Floating Cover (Morphs from Mini to Giant)   -->
    <!-- ------------------------------------------------ -->
    <template v-if="store.currentTrack">
      <div
        :style="floatingCoverStyle"
        class="overflow-hidden flex-shrink-0 bg-zinc-800"
      >
        <CachedImage
          v-if="store.currentTrack.cover"
          :src="store.currentTrack.cover"
          :alt="store.currentTrack.title"
          class="w-full h-full"
        />
        <div v-else class="w-full h-full bg-purple-100 dark:bg-purple-900/50 flex items-center justify-center">
          <span class="text-purple-500 text-2xl">🎵</span>
        </div>
      </div>
    </template>

    <!-- ------------------------------------------------ -->
    <!--  2. Mini Player Controls (Fades Out)             -->
    <!-- ------------------------------------------------ -->
    <div 
       class="absolute inset-0 flex flex-col"
       :style="miniControlStyle"
    >
        <!-- 进度条（顶部渐变色细线） -->
        <div class="h-[2px] bg-white/5 relative z-10 flex-shrink-0">
          <template v-if="store.currentTrack">
            <!-- 播放进度（根据缓存状态变色） -->
            <div
              :class="[
                'absolute h-full transition-all duration-100',
                store.isCached 
                  ? 'bg-gradient-to-r from-green-400 to-emerald-500' 
                  : 'bg-gradient-to-r from-purple-500 to-pink-500'
              ]"
              :style="{ width: `${store.progress}%` }"
            ></div>
          </template>
        </div>

        <div class="flex items-center gap-3 px-4 py-2 relative z-10 h-[64px] flex-shrink-0">
          <!-- Spacer for the floating cover (width 40px + gap) -->
          <div class="w-10 h-10 flex-shrink-0 opacity-0"></div> <!-- Placeholder for layout -->

          <!-- 有歌曲时显示 -->
          <template v-if="store.currentTrack">
            <!-- 歌曲信息 -->
            <div class="flex-1 min-w-0" @click.stop="toggleLyrics()">
              <!-- 歌词模式 -->
              <template v-if="showLyrics && store.currentTrack?.lrc">
                <p class="text-white text-sm font-medium truncate transition-all duration-300">
                  {{ displayLyrics.current || '♪ ♪ ♪' }}
                </p>
                <p class="text-white/50 text-xs truncate transition-all duration-300">
                  {{ displayLyrics.next || store.currentTrack.artist }}
                </p>
              </template>
              <!-- 普通模式 -->
              <template v-else>
                <p class="text-white text-sm font-medium truncate">
                  {{ store.currentTrack.title }}
                </p>
                <p class="text-white/60 text-xs truncate">{{ store.currentTrack.artist }}</p>
              </template>
            </div>

            <!-- 歌词开关按钮 -->
            <button
              v-if="store.currentTrack?.lrc"
              @click.stop="toggleLyrics"
              :class="[
                'w-8 h-8 rounded-full flex items-center justify-center transition-all text-sm font-bold',
                showLyrics ? 'bg-purple-600/30 text-purple-400' : 'text-white/40 hover:bg-white/10 hover:text-white/70'
              ]"
              title="显示/隐藏歌词"
            >
              词
            </button>

            <!-- 播放/暂停按钮 -->
            <button
              @click.stop="handleToggle"
              class="w-11 h-11 rounded-full flex items-center justify-center bg-white text-zinc-900 shadow-[0_2px_12px_rgba(255,255,255,0.2)] hover:scale-105 active:scale-95 transition-all"
            >
              <svg v-if="store.isPlaying" class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
              </svg>
              <svg v-else class="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </button>

            <!-- 播放列表按钮 -->
            <button
              @click.stop="togglePlaylist"
              :class="[
                'w-9 h-9 rounded-full flex items-center justify-center transition-all',
                showPlaylist ? 'bg-purple-600 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'
              ]"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16"/>
              </svg>
            </button>
          </template>

          <!-- 空状态 -->
          <template v-else>
             <!-- No Cover Placeholder when empty -->
            <div class="w-10 h-10 rounded-full overflow-hidden flex-shrink-0 border-2 border-white/10 bg-white/5 flex items-center justify-center">
              <span class="text-white/30 text-sm">🎵</span>
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-white/40 text-sm">暂无播放</p>
              <p class="text-white/20 text-xs">搜索或选择歌曲开始播放</p>
            </div>
          </template>
        </div>
    </div>


    <!-- ------------------------------------------------ -->
    <!--  3. Expanded Player Controls (Fades In)          -->
    <!-- ------------------------------------------------ -->
    <div 
        class="absolute inset-0 pt-[50vh] px-6 pb-[calc(2rem+env(safe-area-inset-bottom,20px))] flex flex-col items-center justify-start"
        :style="expandedControlStyle"
    >
        <!-- Top Header for Expanded Player -->
        <div class="absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-50">
          <!-- Collapse Button -->
          <button 
            @click.stop="toggleExpand"
            class="w-10 h-10 rounded-full bg-white/10 hover:bg-white/15 flex items-center justify-center transition-all active:scale-95"
          >
            <svg class="w-6 h-6 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
            </svg>
          </button>
          
          <!-- EQ Button (moved to top right) -->
          <button 
            @click.stop="showEQ = true"
            class="w-10 h-10 rounded-full bg-white/10 hover:bg-white/15 flex items-center justify-center transition-all active:scale-95"
            title="均衡器"
          >
            <svg class="w-5 h-5 text-white/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="4" y="5" width="3" height="14" rx="1"/>
              <rect x="10.5" y="8" width="3" height="11" rx="1"/>
              <rect x="17" y="3" width="3" height="18" rx="1"/>
            </svg>
          </button>
        </div>

        <!-- Song Info -->
        <div class="flex items-center justify-center gap-2 mt-5">
          <h2 class="text-2xl text-white font-bold text-center max-w-full truncate px-2 drop-shadow-[0_2px_8px_rgba(0,0,0,0.3)]">{{ store.currentTrack?.title }}</h2>
        </div>
        <p class="text-white/50 text-sm mb-4 text-center">{{ store.currentTrack?.artist || '未知艺人' }}</p>
        
        <!-- Action Buttons Row -->
        <div class="flex items-center justify-center gap-5 mb-4">
          <!-- Favorite Button -->
          <button 
            @click.stop="toggleFavorite"
            :class="[
              'w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-90',
              isFavorite ? 'bg-red-500/25 shadow-[0_0_12px_rgba(239,68,68,0.3)]' : 'bg-white/10 hover:bg-white/15'
            ]"
            title="喜欢"
          >
            <svg :class="['w-5 h-5 transition-colors', isFavorite ? 'text-red-500 fill-red-500' : 'text-white/60']" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/>
            </svg>
          </button>
          
          <!-- Feedback Like -->
          <button 
            @click.stop="handleFeedbackLike"
            :class="[
              'w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-90',
              currentFeedback === 'positive' ? 'bg-green-500/25 shadow-[0_0_12px_rgba(34,197,94,0.3)]' : 'bg-white/10 hover:bg-white/15'
            ]"
            title="推荐很准"
          >
            <svg :class="['w-5 h-5 transition-colors', currentFeedback === 'positive' ? 'text-green-400 fill-green-400' : 'text-white/60']" fill="none" stroke="currentColor" viewBox="0 0 24 24">
               <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3zM7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3"/>
            </svg>
          </button>
          
          <!-- Feedback Dislike -->
          <button 
            @click.stop="handleFeedbackDislike"
            :class="[
              'w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-90',
              currentFeedback === 'negative' ? 'bg-red-500/25 shadow-[0_0_12px_rgba(239,68,68,0.3)]' : 'bg-white/10 hover:bg-white/15'
            ]"
            title="推荐不准"
          >
            <svg :class="['w-5 h-5 transition-colors', currentFeedback === 'negative' ? 'text-red-400 fill-red-400' : 'text-white/60']" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M10 15v4a3 3 0 003 3l4-9V2H5.72a2 2 0 00-2 1.7l-1.38 9a2 2 0 002 2.3zm7-13h3a2 2 0 012 2v7a2 2 0 01-2 2h-3"/>
            </svg>
          </button>

          <!-- Add to Playlist Button -->
          <button 
            @click.stop="showPlaylistPicker = true"
            class="w-10 h-10 rounded-full bg-white/10 hover:bg-white/15 flex items-center justify-center transition-all active:scale-90"
            title="加入歌单"
          >
            <svg class="w-5 h-5 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 4v16m8-8H4"/>
            </svg>
          </button>

          <!-- Cache Status -->
          <div 
            :class="[
              'w-10 h-10 rounded-full flex items-center justify-center transition-all',
              store.isCached ? 'bg-green-500/25 shadow-[0_0_12px_rgba(34,197,94,0.3)]' : 'bg-white/10'
            ]"
            :title="store.isCached ? '已缓存' : '未缓存'"
          >
            <svg v-if="store.isCached" class="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
            </svg>
            <svg v-else class="w-5 h-5 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
            </svg>
          </div>

        </div>
        
        <!-- Lyrics Display (2 lines) - 点击进入歌词页 -->
        <div 
          class="w-full max-w-sm h-12 flex flex-col items-center justify-center mb-4 overflow-hidden cursor-pointer rounded-xl transition-colors relative z-50"
          @click.stop="store.toggleLyrics()"
        >
          <p class="text-white/90 text-base font-medium text-center truncate w-full transition-all duration-300">
            {{ displayLyrics.current || '♪ ♪ ♪' }}
          </p>
          <p class="text-white/40 text-sm text-center truncate w-full mt-1 transition-all duration-300">
            {{ displayLyrics.next || '' }}
          </p>
        </div>
        
        <!-- Progress Bar -->
        <div 
          ref="progressBarRef"
          class="w-full max-w-sm h-8 flex items-center mb-1 relative cursor-pointer"
          @touchstart="handleProgressStart"
          @touchmove.prevent="handleProgressMove"
          @touchend="handleProgressEnd"
          @mousedown="handleProgressStart"
          @mousemove="handleProgressMove"
          @mouseup="handleProgressEnd"
          @mouseleave="handleProgressEnd"
        >
          <div class="w-full h-1 bg-white/15 rounded-full relative">
            <div 
              :class="[
                'h-full rounded-full transition-all',
                store.isCached 
                  ? 'bg-gradient-to-r from-green-400 via-green-500 to-emerald-500' 
                  : 'bg-gradient-to-r from-purple-400 via-purple-500 to-pink-500'
              ]" 
              :style="{ width: `${store.progress}%` }"
            ></div>
            <div 
              :class="[
                'absolute top-1/2 w-3.5 h-3.5 rounded-full transform -translate-y-1/2 -translate-x-1/2 transition-transform hover:scale-110',
                store.isCached ? 'bg-green-400 shadow-[0_0_10px_rgba(34,197,94,0.5)]' : 'bg-white shadow-[0_0_10px_rgba(139,92,246,0.4)]'
              ]" 
              :style="{ left: `${store.progress}%` }"
            ></div>
          </div>
        </div>
        
        <!-- Time Display -->
        <div class="w-full max-w-sm flex justify-between text-white/40 text-xs mb-4 font-medium">
          <span>{{ formatTime(store.currentTime) }}</span>
          <span>{{ formatTime(store.duration) }}</span>
        </div>

        <!-- Playback Controls with Play Mode and Playlist at ends -->
        <div class="flex items-center justify-center gap-5 w-full max-w-sm">
          <!-- Play Mode Button (Left) -->
          <button 
            @click.stop="store.togglePlayMode()"
            class="w-11 h-11 rounded-full bg-white/8 hover:bg-white/12 flex items-center justify-center text-white/50 hover:text-white/80 transition-all active:scale-90"
            :title="playModeText"
          >
            <!-- Sequence: 向右箭头表示顺序 -->
            <svg v-if="store.playMode === 'sequence'" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/>
            </svg>
            <!-- Loop: 循环箭头 -->
            <svg v-else-if="store.playMode === 'loop'" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
            </svg>
            <!-- Single: 数字1 + 循环符号 -->
            <svg v-else-if="store.playMode === 'single'" class="w-5 h-5" viewBox="0 0 24 24">
              <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
              <text x="12" y="14" text-anchor="middle" font-size="8" font-weight="bold" fill="currentColor">1</text>
            </svg>
            <!-- Shuffle: 交叉箭头 -->
            <svg v-else class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>
            </svg>
          </button>

          <!-- Prev -->
          <button @click.stop="playPrev" class="w-12 h-12 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/8 active:scale-90 transition-all">
            <svg class="w-7 h-7" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
          </button>
          
          <!-- Play/Pause -->
          <button
            @click.stop="handleToggle"
            class="w-16 h-16 rounded-full flex items-center justify-center bg-white text-zinc-900 shadow-[0_4px_20px_rgba(255,255,255,0.25)] hover:shadow-[0_4px_30px_rgba(255,255,255,0.35)] hover:scale-105 active:scale-95 transition-all"
          >
            <svg v-if="store.isPlaying" class="w-7 h-7" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
            </svg>
            <svg v-else class="w-7 h-7 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </button>
          
          <!-- Next -->
          <button @click.stop="playNext" class="w-12 h-12 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/8 active:scale-90 transition-all">
            <svg class="w-7 h-7" fill="currentColor" viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
          </button>

          <!-- Playlist Button (Right) -->
          <button 
            @click.stop="togglePlaylist"
            class="w-11 h-11 rounded-full bg-white/8 hover:bg-white/12 flex items-center justify-center text-white/50 hover:text-white/80 transition-all active:scale-90 relative z-50"
            title="播放列表"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 6h16M4 10h16M4 14h16M4 18h16"/>
            </svg>
          </button>
        </div>
    </div>



    </div>
  </Transition>

  <!-- 播放列表浮窗 - 移动到外层以避免被 overflow-hidden 裁剪 -->
  <Transition name="playlist-popup">
    <div 
      v-if="showPlaylist && !isSelectMode && !isModalOpen"
      class="fixed left-0 right-0 z-[150] bg-neutral-900 border-t border-white/10 rounded-t-2xl overflow-hidden shadow-2xl"
      :style="{ 
        bottom: `calc(64px + env(safe-area-inset-bottom, 0px) + (${screenWidth < 768 ? '3.5rem' : '0px'}))`,
        transform: (isDraggingPlaylist || playlistDragY > 0) ? `translateY(${playlistDragY}px)` : '',
        transition: isDraggingPlaylist ? 'none' : 'transform 0.3s ease-out',
        willChange: 'transform',
        maxHeight: '75vh'
      }"
      @touchstart="handlePlaylistTouchStart"
      @touchmove="handlePlaylistTouchMove"
      @touchend="handlePlaylistTouchEnd"
    >
      <!-- 顶部拖拽条指示器 -->
      <div class="w-full flex justify-center pt-2 pb-1 playlist-header">
        <div class="w-10 h-1 rounded-full bg-white/20"></div>
      </div>
      <!-- 标题栏 -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div class="flex items-center gap-2">
          <h3 class="text-white font-medium">播放列表</h3>
          <span class="text-white/40 text-sm">({{ store.playlist.length }}首)</span>
        </div>
        <div class="flex items-center gap-2">
          <button 
            @click="clearPlaylist"
            class="px-3 py-1 rounded-lg text-white/50 text-sm hover:bg-white/10 hover:text-white/80 transition-colors"
          >
            清空
          </button>
          <button 
            @click="showPlaylist = false"
            class="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-white/60 hover:bg-white/20 transition-colors"
          >
            ✕
          </button>
        </div>
      </div>
      
      <!-- 歌曲列表 -->
      <div class="overflow-y-auto max-h-[calc(75vh-56px)] playlist-list">
        <div v-if="store.playlist.length === 0" class="py-12 text-center text-white/40">
          <p class="text-3xl mb-2">🎵</p>
          <p>播放列表为空</p>
        </div>
        <div 
          v-for="(track, index) in store.playlist"
          :key="track.id"
          :class="[
            'flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors group',
            store.currentIndex === index ? 'bg-purple-600/20' : 'hover:bg-white/5'
          ]"
          @click="playSong(index)"
        >
          <!-- 序号/播放指示 -->
          <div class="w-6 text-center flex-shrink-0">
            <span v-if="store.currentIndex === index && store.isPlaying" class="text-purple-400">
              <svg class="w-4 h-4 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
              </svg>
            </span>
            <span v-else :class="store.currentIndex === index ? 'text-purple-400' : 'text-white/30'">
              {{ index + 1 }}
            </span>
          </div>
          
          <!-- 歌曲信息 -->
          <div class="flex-1 min-w-0">
            <p :class="['text-sm truncate', store.currentIndex === index ? 'text-purple-400' : 'text-white']">
              {{ track.title }}
            </p>
            <p class="text-white/50 text-xs truncate">{{ track.artist }}</p>
          </div>
          
          <!-- 时长 -->
          <span class="text-white/30 text-xs">{{ track.duration ? formatTime(track.duration) : '--:--' }}</span>
          
          <!-- 删除按钮 -->
          <button
            @click.stop="removeTrack(index)"
            class="w-7 h-7 rounded-full flex items-center justify-center text-white/30 opacity-0 group-hover:opacity-100 hover:bg-white/10 hover:text-red-400 transition-all"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  </Transition>

  <!-- 点击外部关闭播放列表 - 放在播放栏下面 -->
  <Transition name="fade">
    <div 
      v-if="showPlaylist && !isSelectMode && !isModalOpen"
      class="fixed inset-0 z-[140] bg-black/40"
      @click="showPlaylist = false"
    ></div>
  </Transition>

  <!-- 歌单选择弹窗 -->
  <PlaylistPickerDialog
    :visible="showPlaylistPicker"
    @close="showPlaylistPicker = false"
    @select="addToPlaylist"
    @create="handleCreatePlaylist"
  />

  <!-- 均衡器全屏覆盖层 -->
  <Teleport to="body">
    <Transition name="eq-slide">
      <div 
        v-if="showEQ"
        class="fixed inset-0 z-[200] bg-black"
      >
        <EqualizerView @close="showEQ = false" />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 唱片旋转动画 - 使用 will-change 优化 GPU 渲染 */
@keyframes spin-slow {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.animate-spin-slow {
  animation: spin-slow 8s linear infinite;
  will-change: transform;
  /* 使用 GPU 加速，减少 CPU 负担 */
  transform: translateZ(0);
}

/* 页面不可见时暂停动画，省电 */
@media (prefers-reduced-motion: reduce) {
  .animate-spin-slow {
    animation: none;
  }
}

/* 移动端播放栏定位 - bottom 值由 containerStyle 动态计算 */
.mobile-player-bar {
  /* bottom 值由 containerStyle 动态设置，不需要在这里声明 */
}

@media (min-width: 768px) {
  .mobile-player-bar {
    /* 桌面端由 containerStyle 处理 */
    padding-bottom: env(safe-area-inset-bottom, 0);
  }
}

/* 播放列表浮窗动画 */
.playlist-popup-enter-active {
  animation: jelly-in 0.7s both;
}
.playlist-popup-leave-active {
  transition: all 0.35s cubic-bezier(0.3, 0, 0.2, 1);
}
.playlist-popup-enter-from,
.playlist-popup-leave-to {
  transform: translateY(100%);
}

@keyframes jelly-in {
  0% { transform: translateY(100%); }
  50% { transform: translateY(-3.75%); }
  70% { transform: translateY(2%); }
  85% { transform: translateY(-1%); }
  100% { transform: translateY(0); }
}

/* 遮罩层动画 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* 缓存完成小绿点动画 */
.cache-dot-glow {
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.8);
  animation: cache-dot-pulse 1s ease-out;
}

@keyframes cache-dot-pulse {
  0% {
    transform: scale(0);
    opacity: 0;
    box-shadow: 0 0 0 rgba(34, 197, 94, 0);
  }
  50% {
    transform: scale(1.5);
    box-shadow: 0 0 12px rgba(34, 197, 94, 1);
  }
  100% {
    transform: scale(1);
    opacity: 1;
    box-shadow: 0 0 6px rgba(34, 197, 94, 0.8);
  }
}

.cache-dot-enter-active {
  animation: cache-dot-pulse 0.5s ease-out;
}
.cache-dot-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}
.cache-dot-leave-to {
  opacity: 0;
  transform: scale(0);
}

/* 播放条隐藏/显示动画 */
.player-bar-enter-active,
.player-bar-leave-active {
  transition: all 0.3s ease;
}
.player-bar-enter-from,
.player-bar-leave-to {
  opacity: 0;
  transform: translateY(100%);
}

/* 歌曲切换 - 闪光阶段 */
.song-flash {
  background: linear-gradient(135deg, rgba(168, 85, 247, 0.4), rgba(236, 72, 153, 0.3), rgba(168, 85, 247, 0.4));
  animation: flash-pulse 0.04s ease-out;
}

@keyframes flash-pulse {
  0% {
    filter: brightness(1);
  }
  50% {
    filter: brightness(1.3);
  }
  100% {
    filter: brightness(1);
  }
}

/* 歌曲切换 - 发光阶段 */
.song-glow {
  background: linear-gradient(135deg, rgba(88, 28, 135, 0.95), rgba(109, 40, 169, 0.9));
  box-shadow: 
    inset 0 1px 0 rgba(255, 255, 255, 0.1),
    0 -4px 20px rgba(168, 85, 247, 0.3),
    0 0 40px rgba(168, 85, 247, 0.15);
  transition: all 0.15s ease-out;
}

/* 渐变背景流动效果 */
.highlight-shimmer {
  background-size: 200% 100%;
  animation: shimmer 0.3s ease-in-out;
}

@keyframes shimmer {
  0% {
    background-position: 100% 0;
    opacity: 0;
  }
  20% {
    opacity: 1;
  }
  80% {
    opacity: 1;
  }
  100% {
    background-position: -100% 0;
    opacity: 0;
  }
}

/* 顶部光线扫过效果 */
.light-sweep {
  background: linear-gradient(90deg, 
    transparent 0%, 
    rgba(255, 255, 255, 0.8) 45%, 
    rgba(168, 85, 247, 1) 50%, 
    rgba(255, 255, 255, 0.8) 55%, 
    transparent 100%
  );
  background-size: 200% 100%;
  animation: sweep 0.1s ease-out;
}

@keyframes sweep {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: -100% 0;
  }
}

/* EQ 滑动动画 */
.eq-slide-enter-active,
.eq-slide-leave-active {
  transition: transform 0.3s ease;
}
.eq-slide-enter-from {
  transform: translateX(100%);
}
.eq-slide-leave-to {
  transform: translateX(100%);
}
</style>
