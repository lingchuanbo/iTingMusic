<script setup lang="ts">
import { computed, ref, shallowRef, watch, onMounted, onUnmounted } from 'vue'
import { usePlayerStore } from '@/store/player'
import { audioPlayer } from '@/services/player/AudioPlayer'
import { Capacitor } from '@capacitor/core'
import { parseLyrics, getCurrentLyricIndex } from '@/utils/parseLyrics'
import { getLyrics, type MusicSource } from '@/services/source/OnlineApiSource'
import { formatTime } from '@/utils/formatTime'
import {
  translateAndCacheLyrics,
  getCachedTranslation,
  loadTranslateConfig,
  saveTranslateConfig,
  detectLanguage,
  getAutoTargetLang,
  type TranslateProvider,
  type TargetLanguage
} from '@/services/ai/LyricsTranslator'
import { isAIConfigured } from '@/services/ai/AIService'

const store = usePlayerStore()

// 处理浏览器返回按钮
function handlePopState(e: PopStateEvent) {
  if (store.showLyrics) {
    e.preventDefault()
    store.toggleLyrics()
    window.history.pushState({ lyricsOpen: false }, '')
  }
}

watch(() => store.showLyrics, (isOpen) => {
  if (isOpen) {
    window.history.pushState({ lyricsOpen: true }, '')
  }
})

onMounted(() => {
  window.addEventListener('popstate', handlePopState)
  loadLyricsSettings()
})

onUnmounted(() => {
  window.removeEventListener('popstate', handlePopState)
})

const lyricsContainer = ref<HTMLElement>()
const lyricsScrollArea = ref<HTMLElement>()
const loadingLyrics = ref(false)
const showLyricsSettings = ref(false)

// 歌词翻译相关
const isTranslating = ref(false)
const translatedLrc = ref<string | null>(null)
const translationError = ref('')
const lyricsDisplayMode = ref<'original' | 'translated' | 'bilingual'>('original')

// 翻译 API 配置
const translateConfig = ref(loadTranslateConfig())

// 歌词设置
interface LyricsSettings {
  blur: boolean
  align: 'center' | 'left'
  currentColor: string
}

const defaultLyricsSettings: LyricsSettings = {
  blur: true,
  align: 'left',
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

// 翻译后的歌词（使用 shallowRef 缓存避免重复解析）
const translatedLyrics = shallowRef<Array<{time: number, text: string}>>([])

// 当翻译内容变化时才重新解析
watch(translatedLrc, (lrc) => {
  if (lrc) {
    translatedLyrics.value = parseLyrics(lrc)
  } else {
    translatedLyrics.value = []
  }
}, { immediate: true })

// 缓存当前歌词索引用于样式计算
const cachedLyricIndex = ref(-1)
watch(currentLyricIndex, (val) => { cachedLyricIndex.value = val })

// 计算当前行播放进度 (0-100)
const currentLineProgress = computed(() => {
  if (cachedLyricIndex.value < 0 || !lyrics.value.length) return 0
  
  const currentLine = lyrics.value[cachedLyricIndex.value]
  const nextLine = lyrics.value[cachedLyricIndex.value + 1]
  const currentTime = store.currentTime
  
  if (!currentLine) return 0
  
  const startTime = currentLine.time
  const endTime = nextLine ? nextLine.time : (store.duration || startTime + 5)
  const duration = endTime - startTime
  
  if (duration <= 0) return 0
  
  const progress = ((currentTime - startTime) / duration) * 100
  return Math.max(0, Math.min(100, progress))
})


// 歌词样式（模糊效果）
function getLyricStyle(index: number) {
  const isCurrent = index === cachedLyricIndex.value
  const distance = Math.abs(index - cachedLyricIndex.value)
  
  if (isCurrent) {
    // 卡拉OK 效果现在通过 span 分割实现，外层只需要基础样式
    return { 
      transform: 'scale(1.02)', // 微微放大增加强调感
      transformOrigin: 'left center'
    }
  }
  
  if (!lyricsSettings.value.blur) return {}
  
  if (distance > 5) {
    return { filter: 'blur(3px)', opacity: 0.3 }
  }
  return {
    filter: `blur(${Math.min(distance * 0.8, 3)}px)`,
    opacity: Math.max(0.3, 1 - distance * 0.15)
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
  const centerY = scrollArea.clientHeight / 2
  
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

// 歌词页打开时立即定位到当前歌词（无动画）
function scrollToCurrentLyric() {
  if (!lyricsScrollArea.value || !lyricsContainer.value) return
  const index = currentLyricIndex.value
  if (index < 0 || index >= lyrics.value.length) return
  
  const container = lyricsContainer.value
  const scrollArea = lyricsScrollArea.value
  const child = container.children[index] as HTMLElement
  if (!child) return
  
  const scrollTop = child.offsetTop - scrollArea.clientHeight / 2 + child.clientHeight / 2
  scrollArea.scrollTo({ top: scrollTop, behavior: 'auto' }) // 无动画立即定位
}

// 监听歌词页打开，立即定位
watch(() => store.showLyrics, (isOpen) => {
  if (isOpen) {
    // 使用 nextTick 确保 DOM 已渲染
    setTimeout(scrollToCurrentLyric, 50)
  }
})

// 加载歌词
async function refreshLyrics() {
  if (!store.currentTrack?._platform || !store.currentTrack?._songId) return
  
  loadingLyrics.value = true
  try {
    const lrc = await getLyrics(
      store.currentTrack._platform as MusicSource,
      store.currentTrack._songId,
      store.currentTrack._lyricId
    )
    if (lrc && store.currentTrack) {
      store.currentTrack.lrc = lrc
    }
  } catch { /* ignore */ }
  loadingLyrics.value = false
}

// 播放控制
function handleToggle() {
  // Android ExoPlayer 场景：audioPlayer.toggle() 会异步处理所有逻辑
  const toggled = audioPlayer.toggle()
  
  if (!toggled && store.currentTrack) {
    store.playTrack(store.currentIndex)
    return
  }
  
  // 对于 Android，audioPlayer.toggle() 的异步回调会更新 store.isPlaying
  if (!Capacitor.isNativePlatform()) {
    store.togglePlay()
  }
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

// 歌词翻译功能
async function handleTranslateLyrics() {
  if (!store.currentTrack?.lrc || isTranslating.value) return

  if (translateConfig.value.provider === 'builtin-ai' && !isAIConfigured()) {
    translationError.value = '请先在设置中配置 AI'
    return
  }
  if (translateConfig.value.provider === 'deeplx' && !translateConfig.value.deeplxKey) {
    translationError.value = '请先配置 DeepLX API Key'
    return
  }

  isTranslating.value = true
  translationError.value = ''

  try {
    await translateAndCacheLyrics(store.currentTrack.id, store.currentTrack.lrc, {
      onProgress: (text) => {
        translatedLrc.value = text
      },
      onComplete: (translated) => {
        translatedLrc.value = translated
        if (lyricsDisplayMode.value === 'original') {
          lyricsDisplayMode.value = 'bilingual'
        }
      },
      onError: (error) => {
        translationError.value = error
        translatedLrc.value = null // 清除错误的翻译结果
      }
    })
  } catch (e: any) {
    translationError.value = e.message || '翻译失败'
  } finally {
    isTranslating.value = false
  }
}

// 重新翻译（清除缓存后重新翻译）
async function handleRetranslate() {
  if (!store.currentTrack) return
  // 先清除缓存
  clearCurrentTranslation()
  // 然后重新翻译
  await handleTranslateLyrics()
}

function setTranslateProvider(provider: TranslateProvider) {
  translateConfig.value.provider = provider
  saveTranslateConfig(translateConfig.value)
}

function setTargetLang(lang: TargetLanguage) {
  translateConfig.value.targetLang = lang
  saveTranslateConfig(translateConfig.value)
}

function saveDeeplxKey() {
  saveTranslateConfig(translateConfig.value)
}

function toggleLyricsDisplayMode() {
  if (!translatedLrc.value) {
    handleTranslateLyrics()
    return
  }
  const modes: Array<'original' | 'bilingual' | 'translated'> = ['original', 'bilingual', 'translated']
  const currentIndex = modes.indexOf(lyricsDisplayMode.value)
  lyricsDisplayMode.value = modes[(currentIndex + 1) % modes.length]
}

const lyricsDisplayModeText = computed(() => {
  const texts = { original: '原文', bilingual: '双语', translated: '译文' }
  return texts[lyricsDisplayMode.value]
})

// 获取当前歌词的目标语言
function getTargetLangForCurrentTrack(): string {
  const config = loadTranslateConfig()
  if (config.targetLang !== 'auto') {
    return config.targetLang
  }
  // 自动模式：根据歌词内容检测源语言
  if (store.currentTrack?.lrc) {
    const lines = store.currentTrack.lrc.split('\n').slice(0, 10)
    const sampleText = lines.map(l => l.replace(/^\[\d{2}:\d{2}(?:\.\d{2,3})?\]/, '').trim()).join(' ')
    const sourceLang = detectLanguage(sampleText)
    return getAutoTargetLang(sourceLang)
  }
  return 'zh'
}

function clearCurrentTranslation() {
  if (!store.currentTrack) return
  // 清除所有可能的目标语言缓存
  const langs = ['zh', 'en', 'ja', 'ko']
  langs.forEach(lang => {
    const key = `lyrics_translation_${store.currentTrack!.id}_${lang}`
    localStorage.removeItem(key)
  })
  translatedLrc.value = null
  lyricsDisplayMode.value = 'original'
}

function clearAllTranslationCache() {
  if (!confirm('确定清除所有歌词翻译缓存？')) return
  const keysToRemove: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith('lyrics_translation_')) {
      keysToRemove.push(key)
    }
  }
  keysToRemove.forEach((key) => localStorage.removeItem(key))
  translatedLrc.value = null
  lyricsDisplayMode.value = 'original'
}

// 切换歌曲时重置翻译状态
watch(
  () => store.currentTrack?.id,
  async (newId) => {
    if (newId) {
      translatedLrc.value = null
      translationError.value = ''
      lyricsDisplayMode.value = 'original'
      // 根据当前歌词内容获取正确的目标语言
      const targetLang = getTargetLangForCurrentTrack()
      const cached = await getCachedTranslation(newId, targetLang)
      if (cached) {
        translatedLrc.value = cached
      }
    }
  }
)
</script>

<template>
  <Transition name="slide">
    <div 
      v-if="store.showLyrics && store.currentTrack"
      class="fixed inset-0 z-[200] flex flex-col overflow-hidden"
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

      <!-- 歌曲信息头部 -->
      <div class="flex items-center px-6 py-2 gap-4 flex-shrink-0 relative z-10 box-border w-full">
         <div class="w-16 h-16 rounded-xl overflow-hidden bg-white/10 shadow-lg flex-shrink-0 relative">
            <img 
              v-if="store.currentTrack?.cover" 
              :src="store.currentTrack.cover" 
              class="w-full h-full object-cover"
            />
            <div v-else class="w-full h-full flex items-center justify-center bg-white/5 text-white/20">
              <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/></svg>
            </div>
         </div>
         <div class="flex-1 min-w-0 flex flex-col justify-center text-left">
             <h2 class="text-white text-2xl font-bold truncate leading-tight tracking-tight">{{ store.currentTrack?.title || '未知歌曲' }}</h2>
             <p class="text-white/60 text-base truncate mt-1 font-medium">{{ store.currentTrack?.artist || '未知歌手' }}</p>
         </div>
         <button 
           @click.stop="handleToggle" 
           class="w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white backdrop-blur-md transition-all active:scale-95"
         >
            <svg v-if="store.isPlaying" class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>
            <svg v-else class="w-6 h-6 ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
         </button>
      </div>

      <!-- 翻译错误提示 -->
      <div v-if="translationError" class="px-4 pb-2 flex-shrink-0 text-center relative z-10">
        <p class="text-red-400 text-xs bg-red-500/10 px-3 py-1.5 rounded-full inline-block">{{ translationError }}</p>
      </div>

      <!-- 歌词滚动区域 -->
      <div class="flex-1 flex flex-col items-center overflow-hidden relative z-10">
        <div
          ref="lyricsScrollArea"
          :class="[
            'flex-1 w-full overflow-y-auto px-6 md:px-12 relative',
            lyricsSettings.align === 'center' ? 'text-center' : 'text-left pl-8'
          ]"
          @scroll="handleLyricsScroll"
          @touchstart="handleLyricsTouchStart"
          @touchend="handleLyricsTouchEnd"
          @mousedown="handleLyricsTouchStart"
          @mouseup="handleLyricsTouchEnd"
        >
          <p v-if="loadingLyrics" class="text-white/40 text-lg py-20 text-center">加载歌词中...</p>
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
            <div
              v-for="(line, index) in lyrics"
              :key="index"
              :class="[
                'transition-all duration-300 leading-relaxed py-3',
                currentLyricIndex === index ? 'text-white' : isUserScrolling && seekingLyricIndex === index ? 'text-purple-400' : 'text-white/60'
              ]"
              :style="getLyricStyle(index)"
            >
              <!-- 原文歌词 -->
              <p 
                v-if="lyricsDisplayMode !== 'translated'"
                :class="[
                  'transition-all',
                  currentLyricIndex === index ? 'text-3xl md:text-3xl font-bold mb-2' : 'text-lg md:text-xl font-medium mb-1',
                  isUserScrolling && seekingLyricIndex === index ? 'text-2xl font-bold' : ''
                ]"
              >
                <template v-if="currentLyricIndex === index">
                  <span 
                    class="lyric-sweep"
                    :style="{ 
                      '--sweep-progress': `${currentLineProgress}%`,
                      '--sweep-color': lyricsSettings.currentColor 
                    }"
                  >{{ line.text || '♪' }}</span>
                </template>
                <template v-else>
                  {{ line.text || '♪' }}
                </template>
              </p>
              <!-- 译文歌词 -->
              <p 
                v-if="(lyricsDisplayMode === 'bilingual' || lyricsDisplayMode === 'translated') && translatedLyrics[index]?.text"
                :class="[
                  'transition-all',
                  lyricsDisplayMode === 'translated' && currentLyricIndex === index ? 'text-3xl md:text-3xl font-bold' : '',
                  lyricsDisplayMode === 'bilingual' ? 'text-base text-white/70' : '',
                  isUserScrolling && seekingLyricIndex === index && lyricsDisplayMode === 'translated' ? 'text-2xl font-bold' : ''
                ]"
              >
                {{ translatedLyrics[index]?.text }}
              </p>
            </div>
          </div>
        </div>

        <!-- 中间指示线 -->
        <Transition name="fade">
          <div 
            v-if="isUserScrolling && lyrics.length > 0"
            class="absolute left-0 right-0 top-1/2 -translate-y-1/2 flex items-center pointer-events-none z-20 px-4"
          >
            <div class="flex-1 h-[1px] bg-purple-500/60"></div>
            <div class="mx-2 px-3 py-1 bg-purple-500/80 text-white text-xs rounded-full flex items-center gap-1">
              <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
              {{ seekingLyricIndex >= 0 ? formatTime(lyrics[seekingLyricIndex]?.time || 0) : '' }}
            </div>
            <div class="flex-1 h-[1px] bg-purple-500/60"></div>
          </div>
        </Transition>
      </div>

      <!-- 底部播放控制 -->
      <div class="w-full px-6 pb-8 flex-shrink-0 bg-gradient-to-t from-black/50 to-transparent pt-4 relative z-10">
        <!-- 翻译按钮 -->
        <div class="flex justify-center mb-4">
          <button
            @click.stop="toggleLyricsDisplayMode"
            :disabled="isTranslating"
            :class="[
              'px-4 py-1.5 rounded-full text-xs transition-all flex items-center gap-1.5',
              translatedLrc ? 'bg-purple-500/80 text-white' : 'bg-white/10 text-white/60 hover:bg-white/20',
              isTranslating ? 'opacity-50' : ''
            ]"
          >
            <svg v-if="isTranslating" class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <svg v-else class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129"/>
            </svg>
            {{ isTranslating ? '翻译中' : translatedLrc ? lyricsDisplayModeText : '翻译' }}
          </button>
          <!-- 重新翻译按钮 -->
          <button
            v-if="translatedLrc && !isTranslating"
            @click.stop="handleRetranslate"
            class="ml-2 px-3 py-1.5 rounded-full text-xs bg-white/10 text-white/60 hover:bg-white/20 hover:text-white transition-all flex items-center gap-1"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
            </svg>
            重译
          </button>
        </div>

        <!-- 进度条 -->
        <div class="flex items-center gap-3 mb-6">
          <span class="text-white/50 text-xs w-10 text-right font-mono">{{ formatTime(store.currentTime) }}</span>
          <div 
            ref="progressBar"
            class="flex-1 h-8 flex items-center cursor-pointer"
            @touchstart="handleProgressStart"
            @touchmove="handleProgressMove"
            @touchend="handleProgressEnd"
            @mousedown="handleProgressStart"
            @mousemove="handleProgressMove"
            @mouseup="handleProgressEnd"
            @mouseleave="handleProgressEnd"
          >
            <div class="w-full h-1 bg-white/15 rounded-full relative">
              <div class="absolute h-full bg-gradient-to-r from-purple-400 via-purple-500 to-pink-500 rounded-full" :style="{ width: `${store.progress}%` }"></div>
              <div class="absolute top-1/2 w-3.5 h-3.5 bg-white rounded-full shadow-[0_0_10px_rgba(139,92,246,0.4)] transform -translate-y-1/2 -translate-x-1/2" :class="isDragging ? 'scale-125' : ''" :style="{ left: `${store.progress}%` }"></div>
            </div>
          </div>
          <span class="text-white/50 text-xs w-10 font-mono">{{ formatTime(store.duration) }}</span>
        </div>

        <!-- 控制按钮 -->
        <div class="flex items-center justify-center gap-5 w-full max-w-sm mx-auto">
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
          <button @click.stop="store.prevTrack()" class="w-12 h-12 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/8 active:scale-90 transition-all">
            <svg class="w-7 h-7" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
          </button>
          <button @click.stop="handleToggle" class="w-16 h-16 rounded-full flex items-center justify-center bg-white text-zinc-900 shadow-[0_4px_20px_rgba(255,255,255,0.25)] hover:shadow-[0_4px_30px_rgba(255,255,255,0.35)] hover:scale-105 active:scale-95 transition-all">
            <svg v-if="store.isPlaying" class="w-7 h-7" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>
            <svg v-else class="w-7 h-7 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
          </button>
          <button @click.stop="store.nextTrack()" class="w-12 h-12 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/8 active:scale-90 transition-all">
            <svg class="w-7 h-7" fill="currentColor" viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
          </button>
          <button @click.stop="store.toggleLyrics()" class="w-11 h-11 rounded-full bg-white/8 hover:bg-white/12 flex items-center justify-center text-white/50 hover:text-white/80 transition-all active:scale-90" title="返回播放页">
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
      class="fixed inset-0 z-[210] bg-black/60 flex items-end justify-center"
      @click="showLyricsSettings = false"
    >
      <div class="w-full max-w-md bg-zinc-900 rounded-t-2xl p-4 pb-8 max-h-[80vh] overflow-y-auto" @click.stop>
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
          <button @click="toggleBlur" :class="['w-12 h-7 rounded-full transition-colors relative', lyricsSettings.blur ? 'bg-purple-500' : 'bg-white/20']">
            <span :class="['absolute top-1 w-5 h-5 bg-white rounded-full transition-transform', lyricsSettings.blur ? 'left-6' : 'left-1']"></span>
          </button>
        </div>
        
        <!-- 对齐方式 -->
        <div class="flex items-center justify-between py-3 border-b border-white/10">
          <div>
            <p class="text-white text-sm">对齐方式</p>
            <p class="text-white/40 text-xs">歌词文字的对齐方式</p>
          </div>
          <div class="flex gap-2">
            <button @click="lyricsSettings.align = 'center'; saveLyricsSettings()" :class="['px-3 py-1.5 rounded-lg text-xs transition-colors', lyricsSettings.align === 'center' ? 'bg-purple-500 text-white' : 'bg-white/10 text-white/60']">居中</button>
            <button @click="lyricsSettings.align = 'left'; saveLyricsSettings()" :class="['px-3 py-1.5 rounded-lg text-xs transition-colors', lyricsSettings.align === 'left' ? 'bg-purple-500 text-white' : 'bg-white/10 text-white/60']">左对齐</button>
          </div>
        </div>
        
        <!-- 当前歌词颜色 -->
        <div class="py-3 border-b border-white/10">
          <div class="flex items-center justify-between mb-3">
            <div>
              <p class="text-white text-sm">当前歌词颜色</p>
              <p class="text-white/40 text-xs">正在播放的歌词高亮颜色</p>
            </div>
          </div>
          <div class="flex flex-wrap gap-3">
            <button v-for="color in presetColors" :key="color" @click="setCurrentColor(color)" :class="['w-8 h-8 rounded-full transition-all', lyricsSettings.currentColor === color ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-900 scale-110' : '']" :style="{ backgroundColor: color }"></button>
          </div>
        </div>

        <!-- 翻译设置 -->
        <div class="py-3">
          <div class="flex items-center gap-2 mb-3">
            <svg class="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129"/>
            </svg>
            <p class="text-white text-sm font-medium">歌词翻译</p>
          </div>

          <!-- 翻译 API -->
          <div class="mb-3">
            <p class="text-white/50 text-xs mb-2">翻译接口</p>
            <div class="flex flex-wrap gap-2">
              <button @click="setTranslateProvider('builtin-ai')" :class="['px-3 py-1.5 rounded-lg text-xs transition-colors', translateConfig.provider === 'builtin-ai' ? 'bg-purple-500 text-white' : 'bg-white/10 text-white/60']">内置 AI</button>
              <button @click="setTranslateProvider('deeplx')" :class="['px-3 py-1.5 rounded-lg text-xs transition-colors', translateConfig.provider === 'deeplx' ? 'bg-purple-500 text-white' : 'bg-white/10 text-white/60']">DeepLX</button>
              <button @click="setTranslateProvider('google')" :class="['px-3 py-1.5 rounded-lg text-xs transition-colors', translateConfig.provider === 'google' ? 'bg-purple-500 text-white' : 'bg-white/10 text-white/60']">Google</button>
            </div>
          </div>

          <!-- DeepLX Config -->
          <div v-if="translateConfig.provider === 'deeplx'" class="space-y-3 mb-3">
            <div>
              <p class="text-white/50 text-xs mb-2">DeepLX API 地址</p>
              <input v-model="translateConfig.deeplxBaseUrl" type="text" placeholder="https://api.deeplx.org" class="w-full h-9 px-3 rounded-lg bg-white/10 text-white text-xs placeholder-white/30 outline-none focus:ring-1 focus:ring-purple-500" @blur="saveDeeplxKey"/>
            </div>
            <div>
              <p class="text-white/50 text-xs mb-2">DeepLX API Key (可选)</p>
              <input v-model="translateConfig.deeplxKey" type="password" placeholder="输入 API Key" class="w-full h-9 px-3 rounded-lg bg-white/10 text-white text-xs placeholder-white/30 outline-none focus:ring-1 focus:ring-purple-500" @blur="saveDeeplxKey"/>
            </div>
          </div>

          <!-- 目标语言 -->
          <div class="mb-3">
            <p class="text-white/50 text-xs mb-2">目标语言</p>
            <div class="flex flex-wrap gap-2">
              <button @click="setTargetLang('auto')" :class="['px-3 py-1.5 rounded-lg text-xs transition-colors', translateConfig.targetLang === 'auto' ? 'bg-purple-500 text-white' : 'bg-white/10 text-white/60']">自动</button>
              <button @click="setTargetLang('zh')" :class="['px-3 py-1.5 rounded-lg text-xs transition-colors', translateConfig.targetLang === 'zh' ? 'bg-purple-500 text-white' : 'bg-white/10 text-white/60']">中文</button>
              <button @click="setTargetLang('en')" :class="['px-3 py-1.5 rounded-lg text-xs transition-colors', translateConfig.targetLang === 'en' ? 'bg-purple-500 text-white' : 'bg-white/10 text-white/60']">英文</button>
              <button @click="setTargetLang('ja')" :class="['px-3 py-1.5 rounded-lg text-xs transition-colors', translateConfig.targetLang === 'ja' ? 'bg-purple-500 text-white' : 'bg-white/10 text-white/60']">日文</button>
            </div>
            <p class="text-white/30 text-xs mt-1">自动：中文↔英文互译，日/韩文→中文</p>
          </div>

          <!-- 翻译状态 -->
          <div v-if="translatedLrc" class="flex items-center justify-between py-2 mb-2">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full bg-green-500"></span>
              <span class="text-white/60 text-xs">已翻译</span>
            </div>
            <button @click="clearCurrentTranslation" class="text-red-400 text-xs hover:text-red-300 transition-colors">清除翻译</button>
          </div>

          <!-- 显示模式 -->
          <div v-if="translatedLrc" class="mb-3">
            <p class="text-white/50 text-xs mb-2">显示模式</p>
            <div class="flex gap-2">
              <button @click="lyricsDisplayMode = 'original'" :class="['px-3 py-1.5 rounded-lg text-xs transition-colors', lyricsDisplayMode === 'original' ? 'bg-purple-500 text-white' : 'bg-white/10 text-white/60']">原文</button>
              <button @click="lyricsDisplayMode = 'bilingual'" :class="['px-3 py-1.5 rounded-lg text-xs transition-colors', lyricsDisplayMode === 'bilingual' ? 'bg-purple-500 text-white' : 'bg-white/10 text-white/60']">双语</button>
              <button @click="lyricsDisplayMode = 'translated'" :class="['px-3 py-1.5 rounded-lg text-xs transition-colors', lyricsDisplayMode === 'translated' ? 'bg-purple-500 text-white' : 'bg-white/10 text-white/60']">译文</button>
            </div>
          </div>

          <!-- 翻译按钮 -->
          <button v-if="!translatedLrc && store.currentTrack?.lrc" @click="handleTranslateLyrics" :disabled="isTranslating" class="w-full py-2.5 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-50">
            <svg v-if="isTranslating" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            {{ isTranslating ? '翻译中...' : '翻译当前歌词' }}
          </button>

          <button @click="clearAllTranslationCache" class="w-full mt-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 text-xs transition-colors">清除所有翻译缓存</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
@keyframes spin-slow {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.animate-spin-slow { animation: spin-slow 8s linear infinite; }

.slide-enter-active, .slide-leave-active { transition: transform 0.3s ease; }
.slide-enter-from, .slide-leave-to { transform: translateY(100%); }

.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.slide-up-enter-active, .slide-up-leave-active { transition: all 0.3s ease; }
.slide-up-enter-from, .slide-up-leave-to { transform: translateY(100%); opacity: 0; }

.lyric-sweep {
  background: linear-gradient(to right, var(--sweep-color) var(--sweep-progress), rgba(255, 255, 255, 0.5) var(--sweep-progress));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  transition: background 0.1s linear;
}

.pt-safe-top { padding-top: max(1rem, env(safe-area-inset-top, 1rem)); }

</style>
