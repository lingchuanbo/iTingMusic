<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { usePlayerStore } from '@/store/player'
import { audioPlayer } from '@/services/player/AudioPlayer'
import { parseLyrics, getCurrentLyricIndex } from '@/utils/parseLyrics'
import { getLyrics, type MusicSource } from '@/services/source/OnlineApiSource'
import { formatTime } from '@/utils/formatTime'

const store = usePlayerStore()

// 处理浏览器返回按钮
function handlePopState(e: PopStateEvent) {
  if (store.showLyrics) {
    e.preventDefault()
    store.toggleLyrics()
    window.history.pushState({ lyricsOpen: false }, '')
  }
}

// 监听歌词面板打开/关闭，管理历史记录
watch(() => store.showLyrics, (isOpen) => {
  if (isOpen) {
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
const lyricsScrollArea = ref<HTMLElement>()
const loadingLyrics = ref(false)
const showLyricsSettings = ref(false)

// 歌词设置
interface LyricsSettings {
  blur: boolean
  align: 'center' | 'left'
  currentColor: string
}

const defaultLyricsSettings: LyricsSettings = {
  blur: true,
  align: 'center',
  currentColor: '#ffffff'
}

const lyricsSettings = ref<LyricsSettings>({ ...defaultLyricsSettings })

const presetColors = [
  '#ffffff', '#a855f7', '#ec4899', '#3b82f6',
  '#22c55e', '#eab308', '#f97316', '#ef4444',
]

function loadLyricsSettings() {
  try {
    const saved = localStorage.getItem('lyrics_settings')
    if (saved) {
      lyricsSettings.value = { ...defaultLyricsSettings, ...JSON.parse(saved) }
    }
  } catch { /* ignore */ }
}

function saveLyricsSettings() {
  localStorage.setItem('lyrics_settings', JSON.stringify(lyricsSettings.value))
}

function toggleBlur() {
  lyricsSettings.value.blur = !lyricsSettings.value.blur
  saveLyricsSettings()
}

function setCurrentColor(color: string) {
  lyricsSettings.value.currentColor = color
  saveLyricsSettings()
}

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

// 歌词解析
const lyrics = computed(() => {
  if (!store.currentTrack?.lrc) return []
  return parseLyrics(store.currentTrack.lrc)
})

const currentLyricIndex = computed(() => {
  return getCurrentLyricIndex(lyrics.value, store.currentTime)
})

// 歌词样式（模糊效果）
function getLyricStyle(index: number) {
  if (!lyricsSettings.value.blur) return {}
  const distance = Math.abs(index - currentLyricIndex.value)
  const blur = Math.min(distance * 0.8, 3)
  const opacity = Math.max(0.3, 1 - distance * 0.15)
  return {
    filter: distance > 0 ? `blur(${blur}px)` : 'none',
    opacity: distance === 0 ? 1 : opacity,
    color: distance === 0 ? lyricsSettings.value.currentColor : undefined
  }
}

// 用户滚动相关
const isUserScrolling = ref(false)
const seekingLyricIndex = ref(-1)
let scrollTimeout: number | null = null

function handleLyricsScroll() {
  if (!lyricsScrollArea.value || !lyricsContainer.value) return
  
  const scrollArea = lyricsScrollArea.value
  const container = lyricsContainer.value
  const scrollTop = scrollArea.scrollTop
  const centerY = scrollArea.clientHeight / 2
  
  // 根据滚动位置计算当前在中间的歌词索引
  const children = container.children
  for (let i = 0; i < children.length; i++) {
    const child = children[i] as HTMLElement
    const rect = child.getBoundingClientRect()
    const containerRect = scrollArea.getBoundingClientRect()
    const relativeTop = rect.top - containerRect.top
    const relativeCenter = relativeTop + rect.height / 2
    
    if (Math.abs(relativeCenter - centerY) < rect.height / 2) {
      seekingLyricIndex.value = i
      break
    }
  }
}

function handleLyricsTouchStart() {
  isUserScrolling.value = true
  if (scrollTimeout) {
    clearTimeout(scrollTimeout)
    scrollTimeout = null
  }
}

function handleLyricsTouchEnd() {
  // 跳转到选中的歌词位置
  if (seekingLyricIndex.value >= 0 && lyrics.value[seekingLyricIndex.value]) {
    const time = lyrics.value[seekingLyricIndex.value].time
    audioPlayer.seek(time)
    store.setCurrentTime(time)
  }
  
  scrollTimeout = window.setTimeout(() => {
    isUserScrolling.value = false
    seekingLyricIndex.value = -1
  }, 300)
}

// 自动滚动到当前歌词
watch(currentLyricIndex, (index) => {
  if (isUserScrolling.value || !lyricsScrollArea.value || !lyricsContainer.value) return
  if (index < 0 || index >= lyrics.value.length) return
  
  const container = lyricsContainer.value
  const scrollArea = lyricsScrollArea.value
  const child = container.children[index] as HTMLElement
  if (!child) return
  
  const scrollTop = child.offsetTop - scrollArea.clientHeight / 2 + child.clientHeight / 2
  scrollArea.scrollTo({ top: scrollTop, behavior: 'smooth' })
})

// 加载歌词
async function refreshLyrics() {
  if (!store.currentTrack?._platform || !store.currentTrack?._songId) return
  
  loadingLyrics.value = true
  try {
    const lrc = await getLyrics(
      store.currentTrack._platform as MusicSource,
      store.currentTrack._songId
    )
    if (lrc && store.currentTrack) {
      store.currentTrack.lrc = lrc
    }
  } catch { /* ignore */ }
  loadingLyrics.value = false
}

// 播放控制
function handleToggle() {
  audioPlayer.toggle()
  store.togglePlay()
}

// 进度条拖动
const progressBar = ref<HTMLElement>()
const isDragging = ref(false)

function handleProgressStart(e: TouchEvent | MouseEvent) {
  isDragging.value = true
  updateProgress(e)
}

function handleProgressMove(e: TouchEvent | MouseEvent) {
  if (!isDragging.value) return
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
        <div class="absolute inset-0 bg-black/70 backdrop-blur-3xl"></div>
      </div>

      <!-- 顶部栏 -->
      <div class="flex items-center justify-between px-4 pt-safe-top pb-2 flex-shrink-0 relative z-10">
        <button 
          @click="store.toggleLyrics()"
          class="w-10 h-10 rounded-full flex items-center justify-center text-white/60 hover:text-white transition-colors"
        >
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
          </svg>
        </button>
        <div class="flex-1 text-center">
          <p class="text-white font-medium text-sm truncate px-4">{{ store.currentTrack?.title }}</p>
          <p class="text-white/50 text-xs">{{ store.currentTrack?.artist }}</p>
        </div>
        <!-- 歌词设置 -->
        <button 
          @click.stop="showLyricsSettings = true"
          class="w-10 h-10 rounded-full flex items-center justify-center text-white/60 hover:text-white transition-colors"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
          </svg>
        </button>
      </div>

      <!-- 歌词滚动区域 -->
      <div class="flex-1 flex flex-col items-center overflow-hidden relative z-10">
        <div
          ref="lyricsScrollArea"
          :class="[
            'flex-1 w-full overflow-y-auto px-6 md:px-12 relative',
            lyricsSettings.align === 'center' ? 'text-center' : 'text-left'
          ]"
          @scroll="handleLyricsScroll"
          @touchstart="handleLyricsTouchStart"
          @touchend="handleLyricsTouchEnd"
          @mousedown="handleLyricsTouchStart"
          @mouseup="handleLyricsTouchEnd"
        >
          <p v-if="loadingLyrics" class="text-white/40 text-lg py-20 text-center">
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
            <div class="mx-2 px-3 py-1 bg-purple-500/80 text-white text-xs rounded-full flex items-center gap-1">
              <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z"/>
              </svg>
              {{ seekingLyricIndex >= 0 ? formatTime(lyrics[seekingLyricIndex]?.time || 0) : '' }}
            </div>
            <div class="flex-1 h-[1px] bg-purple-500/60"></div>
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
                class="absolute h-full bg-white rounded-full"
                :style="{ width: `${store.progress}%` }"
              ></div>
              <div 
                class="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg transition-transform"
                :class="isDragging ? 'scale-125' : ''"
                :style="{ left: `calc(${store.progress}% - 6px)` }"
              ></div>
            </div>
          </div>
          <span class="text-white/50 text-xs w-10 font-mono">{{ formatTime(store.duration) }}</span>
        </div>

        <!-- 控制按钮 (与播放页一致) -->
        <div class="flex items-center justify-center gap-5 w-full max-w-sm mx-auto">
          <!-- 循环模式 -->
          <button 
            @click.stop="store.togglePlayMode()"
            class="w-11 h-11 rounded-full bg-white/8 hover:bg-white/12 flex items-center justify-center text-white/50 hover:text-white/80 transition-all active:scale-90"
            :title="playModeText"
          >
            <svg v-if="store.playMode === 'sequence'" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 6h16M4 12h16M4 18h16"/>
            </svg>
            <svg v-else-if="store.playMode === 'loop'" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
            </svg>
            <svg v-else-if="store.playMode === 'single'" class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0020 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 004 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
            </svg>
            <svg v-else class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3l-3 3"/>
            </svg>
          </button>
          <!-- 上一首 -->
          <button 
            @click.stop="store.prevTrack()"
            class="w-12 h-12 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/8 active:scale-90 transition-all"
          >
            <svg class="w-7 h-7" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/>
            </svg>
          </button>
          <!-- 播放/暂停 -->
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
          <!-- 下一首 -->
          <button 
            @click.stop="store.nextTrack()"
            class="w-12 h-12 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/8 active:scale-90 transition-all"
          >
            <svg class="w-7 h-7" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
            </svg>
          </button>
          <!-- 返回播放页 -->
          <button 
            @click.stop="store.toggleLyrics()"
            class="w-11 h-11 rounded-full bg-white/8 hover:bg-white/12 flex items-center justify-center text-white/50 hover:text-white/80 transition-all active:scale-90"
            title="返回播放页"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/>
            </svg>
          </button>
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
                'w-8 h-8 rounded-full transition-all',
                lyricsSettings.currentColor === color ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-900 scale-110' : ''
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
/* 唱片旋转动画 */
@keyframes spin-slow {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.animate-spin-slow {
  animation: spin-slow 8s linear infinite;
}

/* 滑入动画 */
.slide-enter-active,
.slide-leave-active {
  transition: transform 0.3s ease;
}
.slide-enter-from,
.slide-leave-to {
  transform: translateY(100%);
}

/* 淡入淡出 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* 底部弹窗 */
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s ease;
}
.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(100%);
  opacity: 0;
}

/* 安全区域 */
.pt-safe-top {
  padding-top: max(1rem, env(safe-area-inset-top, 1rem));
}
</style>
