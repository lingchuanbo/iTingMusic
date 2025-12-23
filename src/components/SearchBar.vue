<script setup lang="ts">
import { ref, computed } from 'vue'
import { usePlayerStore } from '@/store/player'

// Props
defineProps<{
  popupOnly?: boolean // 仅显示弹窗模式（隐藏搜索栏UI）
}>()
import {
  aggregateSearch,
  searchResultToTrack,
  getLyrics,
  searchSongs,
  getEnabledSources,
  type SearchResult,
  type AudioQuality
} from '@/services/source/OnlineApiSource'
import { scanLocalFiles } from '@/services/source/LocalSource'
import { processSearchKeyword, isPinyin } from '@/utils/pinyin'
import { getAIRecommendations, isAIConfigured, getCurrentRole } from '@/services/ai/AIService'

const store = usePlayerStore()
const keyword = ref('')

// 搜索模式: normal 普通搜索, ai AI搜索
type SearchMode = 'normal' | 'ai'
const searchMode = ref<SearchMode>('normal')
const aiResponse = ref('') // AI 回复内容
const thinkingText = ref('') // AI 思考过程

// AI 快捷提示
const quickPrompts = [
  { icon: '🌿', label: '放松', prompt: '推荐放松的音乐' },
  { icon: '💼', label: '工作', prompt: '推荐适合工作听的音乐' },
  { icon: '🏃', label: '运动', prompt: '推荐适合运动的音乐' },
  { icon: '🌙', label: '睡前', prompt: '推荐适合睡前听的音乐' },
  { icon: '😢', label: '伤感', prompt: '推荐伤感的歌曲' },
  { icon: '🎉', label: '嗨歌', prompt: '推荐嗨起来的歌' }
]

// 实时显示简拼转换提示
const pinyinHint = computed(() => {
  const trimmed = keyword.value.trim()
  if (!trimmed || !isPinyin(trimmed) || trimmed.length > 10) return ''
  const converted = processSearchKeyword(trimmed)
  // 只有转换后不同才显示提示
  return converted !== trimmed ? converted : ''
})
const loading = ref(false)
const showResults = ref(false)
const searchResults = ref<SearchResult[]>([])
const quality = ref<AudioQuality>('320k')
const fileInput = ref<HTMLInputElement>()
const showMobileSearch = ref(false)

// 多选模式
const isSelectMode = ref(false)
const selectedItems = ref<Set<string>>(new Set())
let longPressTimer: number | null = null
let touchStartPos = { x: 0, y: 0 }
let hasMoved = false

// 获取选中项的唯一key
function getResultKey(result: SearchResult): string {
  return `${result.platform}-${result.id}`
}

// 开始长按
function startLongPress(result: SearchResult, event: TouchEvent | MouseEvent) {
  hasMoved = false
  // 记录起始位置
  if ('touches' in event) {
    touchStartPos = { x: event.touches[0].clientX, y: event.touches[0].clientY }
  } else {
    touchStartPos = { x: event.clientX, y: event.clientY }
  }
  
  longPressTimer = window.setTimeout(() => {
    if (!hasMoved) {
      // 进入多选模式并选中当前项
      isSelectMode.value = true
      selectedItems.value.add(getResultKey(result))
      // 触发震动反馈（如果支持）
      if (navigator.vibrate) {
        navigator.vibrate(50)
      }
    }
  }, 500)
}

// 检测移动（用于区分滚动和长按）
function handleTouchMove(event: TouchEvent) {
  if (longPressTimer) {
    const touch = event.touches[0]
    const deltaX = Math.abs(touch.clientX - touchStartPos.x)
    const deltaY = Math.abs(touch.clientY - touchStartPos.y)
    // 移动超过10px则认为是滚动，取消长按
    if (deltaX > 10 || deltaY > 10) {
      hasMoved = true
      cancelLongPress()
    }
  }
}

// 取消长按
function cancelLongPress() {
  if (longPressTimer) {
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
}

// 切换选中状态
function toggleSelect(result: SearchResult) {
  const key = getResultKey(result)
  if (selectedItems.value.has(key)) {
    selectedItems.value.delete(key)
    // 如果没有选中项了，退出多选模式
    if (selectedItems.value.size === 0) {
      isSelectMode.value = false
    }
  } else {
    selectedItems.value.add(key)
  }
}

// 全选/取消全选
function toggleSelectAll() {
  if (selectedItems.value.size === searchResults.value.length) {
    selectedItems.value.clear()
    isSelectMode.value = false
  } else {
    searchResults.value.forEach(r => selectedItems.value.add(getResultKey(r)))
  }
}

// 退出多选模式
function exitSelectMode() {
  isSelectMode.value = false
  selectedItems.value.clear()
}

// 批量添加到播放列表
function batchAddToPlaylist() {
  const selected = searchResults.value.filter(r => selectedItems.value.has(getResultKey(r)))
  selected.forEach(result => {
    const track = searchResultToTrack(result, quality.value)
    getLyrics(result.platform, result.id).then(lrc => {
      const t = store.playlist.find(t => t.id === track.id)
      if (t) t.lrc = lrc
    })
    store.addTrack(track)
  })
  exitSelectMode()
}

// 批量添加到喜欢
function batchAddToFavorite() {
  const selected = searchResults.value.filter(r => selectedItems.value.has(getResultKey(r)))
  const favorites = JSON.parse(localStorage.getItem('favorites') || '[]')
  const favData = JSON.parse(localStorage.getItem('favorites_data') || '[]')
  selected.forEach(result => {
    const track = searchResultToTrack(result, quality.value)
    if (!favorites.includes(track.id)) {
      favorites.push(track.id)
      // 保存完整歌曲数据
      if (!favData.some((t: any) => t.id === track.id)) {
        favData.push(track)
      }
    }
    // 同时添加到播放列表
    store.addTrack(track)
  })
  localStorage.setItem('favorites', JSON.stringify(favorites))
  localStorage.setItem('favorites_data', JSON.stringify(favData))
  exitSelectMode()
}

// 处理点击事件
function handleResultClick(result: SearchResult) {
  if (isSelectMode.value) {
    toggleSelect(result)
  } else {
    playNow(result)
    showMobileSearch.value = false
  }
}

// 暴露打开搜索弹窗的方法（移动端和桌面端通用）
function openMobileSearch() {
  showMobileSearch.value = true
  // 打开时重置多选状态
  exitSelectMode()
}

defineExpose({
  openMobileSearch,
  showMobileSearch
})

const qualities: { value: AudioQuality; label: string }[] = [
  { value: '128k', label: '标准' },
  { value: '320k', label: '高品' },
  { value: 'flac', label: '无损' },
  { value: 'flac24bit', label: 'Hi-Res' }
]

async function handleSearch() {
  if (!keyword.value.trim() || loading.value) return
  loading.value = true
  showResults.value = true
  aiResponse.value = ''

  try {
    if (searchMode.value === 'ai') {
      // AI 搜索模式
      await handleAiSearch(keyword.value)
    } else {
      // 普通搜索模式，支持简拼
      const searchKeyword = processSearchKeyword(keyword.value)
      searchResults.value = await aggregateSearch(searchKeyword)
    }
  } finally {
    loading.value = false
  }
}

// AI 搜索处理
async function handleAiSearch(query: string) {
  searchResults.value = []
  aiResponse.value = ''
  thinkingText.value = ''

  // 检查 AI 是否配置
  if (!isAIConfigured()) {
    aiResponse.value = '请先在设置中配置 AI API Key'
    return
  }

  try {
    const role = getCurrentRole()
    aiResponse.value = `${role.avatar} ${role.name} 正在思考...`

    // 调用真实 AI API
    const result = await getAIRecommendations(query, {
      onThinking: (text) => {
        thinkingText.value = text
      }
    })

    if (result && result.songs.length > 0) {
      aiResponse.value = result.reason || `为你找到 ${result.songs.length} 首推荐`

      // 搜索 AI 推荐的歌曲
      const sources = getEnabledSources()
      for (const song of result.songs.slice(0, 5)) {
        for (const source of sources) {
          try {
            const results = await searchSongs(source, `${song.title} ${song.artist}`, 3)
            const match = results.find(
              r =>
                r.name.toLowerCase().includes(song.title.toLowerCase()) ||
                song.title.toLowerCase().includes(r.name.toLowerCase())
            ) || results[0]
            if (match) {
              searchResults.value.push(match)
              break
            }
          } catch {
            continue
          }
        }
      }

      if (searchResults.value.length === 0) {
        aiResponse.value = '找到推荐但搜索不到资源，换个描述试试？'
      }
    } else {
      aiResponse.value = '没有找到相关推荐，试试换个描述？'
    }
  } catch (e: any) {
    aiResponse.value = e.message || 'AI 搜索出错，请稍后重试'
    console.error('AI search error:', e)
  }
}

// 使用快捷提示
function useQuickPrompt(prompt: string) {
  keyword.value = prompt
  handleSearch()
}

async function addToPlaylist(result: SearchResult) {
  const track = searchResultToTrack(result, quality.value)
  // 异步获取歌词
  getLyrics(result.platform, result.id).then(lrc => {
    const t = store.playlist.find(t => t.id === track.id)
    if (t) t.lrc = lrc
  })
  store.addTrack(track)
  // 添加视觉反馈：短暂显示成功提示
  addedFeedback.value = getResultKey(result)
  setTimeout(() => {
    addedFeedback.value = ''
  }, 1000)
}

// 添加成功反馈
const addedFeedback = ref('')

async function playNow(result: SearchResult) {
  const track = searchResultToTrack(result, quality.value)
  const lrc = await getLyrics(result.platform, result.id)
  track.lrc = lrc
  store.addTrack(track)
  store.playTrack(store.playlist.length - 1)
  showResults.value = false
}

function openFilePicker() {
  fileInput.value?.click()
}

async function handleFileSelect(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.files?.length) return
  loading.value = true
  try {
    const tracks = await scanLocalFiles(input.files)
    tracks.forEach(t => store.addTrack(t))
  } finally {
    loading.value = false
    input.value = ''
  }
}

function getPlatformIcon(platform: string) {
  const icons: Record<string, string> = {
    netease: '🎵',
    kuwo: '🎶',
    kugou: '🎤',
    qq: '🎧',
    migu: '📻'
  }
  return icons[platform] || '🎵'
}
</script>

<template>
  <div :class="['relative', popupOnly ? '' : 'p-4']">
    <!-- 桌面端：完整搜索栏（非弹窗模式时显示） -->
    <div v-if="!popupOnly" class="hidden md:flex items-center gap-3">
      <!-- 搜索模式切换 -->
      <div class="flex rounded-xl bg-white/10 p-1">
        <button
          @click="searchMode = 'normal'"
          :class="[
            'px-3 py-1.5 rounded-lg text-sm transition-all',
            searchMode === 'normal' ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white/70'
          ]"
        >
          普通
        </button>
        <button
          @click="searchMode = 'ai'"
          :class="[
            'px-3 py-1.5 rounded-lg text-sm transition-all flex items-center gap-1',
            searchMode === 'ai' ? 'bg-purple-600 text-white' : 'text-white/50 hover:text-white/70'
          ]"
        >
          <span class="text-xs">✨</span> AI
        </button>
      </div>

      <!-- 搜索框 -->
      <div class="flex-1 relative">
        <input
          v-model="keyword"
          @keyup.enter="handleSearch"
          @focus="searchResults.length && (showResults = true)"
          type="text"
          :placeholder="searchMode === 'ai' ? '描述你想听的音乐...' : '搜索歌曲、歌手...'"
          class="w-full h-10 pl-10 pr-4 rounded-xl bg-white/10 text-white placeholder-white/40 outline-none focus:bg-white/15 transition-colors"
        />
        <span class="absolute left-3 top-1/2 -translate-y-1/2 text-white/40">🔍</span>
        <!-- 简拼提示 -->
        <Transition name="hint">
          <div
            v-if="pinyinHint && searchMode === 'normal'"
            class="absolute left-0 top-full mt-1 px-3 py-1 rounded-lg bg-purple-600/80 text-white text-xs whitespace-nowrap z-10"
          >
            将搜索: {{ pinyinHint }}
          </div>
        </Transition>
        <!-- AI 快捷提示 -->
        <Transition name="hint">
          <div
            v-if="searchMode === 'ai' && !keyword && !loading"
            class="absolute left-0 right-0 top-full mt-2 flex flex-wrap gap-1.5 z-10"
          >
            <button
              v-for="p in quickPrompts"
              :key="p.label"
              @click="useQuickPrompt(p.prompt)"
              class="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white/70 text-xs transition-all"
            >
              {{ p.icon }} {{ p.label }}
            </button>
          </div>
        </Transition>
      </div>
      
      <!-- 音质选择 -->
      <select
        v-model="quality"
        class="h-10 px-3 rounded-xl bg-white/10 text-white outline-none cursor-pointer"
      >
        <option v-for="q in qualities" :key="q.value" :value="q.value" class="bg-neutral-800">
          {{ q.label }}
        </option>
      </select>
      
      <!-- 搜索按钮 -->
      <button
        @click="handleSearch"
        :disabled="loading"
        class="h-10 px-4 rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors disabled:opacity-50"
      >
        {{ loading ? '...' : '搜索' }}
      </button>
      
      <!-- 本地文件 -->
      <button
        @click="openFilePicker"
        class="h-10 px-4 rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors"
      >
        📁
      </button>
    </div>

    <!-- 移动端：搜索图标按钮（非弹窗模式时显示） -->
    <div v-if="!popupOnly" class="flex md:hidden justify-end">
      <button
        @click="showMobileSearch = true"
        class="w-10 h-10 rounded-full bg-white/10 text-white/60 flex items-center justify-center hover:bg-white/20 active:scale-95 transition-all"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </button>
    </div>
      
    <input
      ref="fileInput"
      type="file"
      accept="audio/*"
      multiple
      class="hidden"
      @change="handleFileSelect"
    />
    
    <!-- 桌面端搜索结果下拉（非弹窗模式时显示） -->
    <Transition v-if="!popupOnly" name="fade">
      <div
        v-if="showResults && (searchResults.length || aiResponse)"
        class="hidden md:block absolute left-4 right-4 top-full mt-2 max-h-80 overflow-y-auto rounded-xl bg-black/80 backdrop-blur-xl border border-white/10 z-50"
      >
        <!-- AI 回复提示 -->
        <div v-if="aiResponse || thinkingText" class="px-3 py-2 border-b border-white/10">
          <div class="flex items-center gap-2">
            <span class="text-purple-400">✨</span>
            <span class="text-white/70 text-sm">{{ aiResponse }}</span>
          </div>
          <div v-if="loading && thinkingText" class="mt-1 text-white/40 text-xs line-clamp-2">
            {{ thinkingText }}
          </div>
        </div>
        <div class="p-2">
          <div
            v-for="result in searchResults"
            :key="`${result.platform}-${result.id}`"
            class="flex items-center gap-3 p-2 rounded-lg hover:bg-white/10 cursor-pointer group"
          >
            <span class="text-lg">{{ getPlatformIcon(result.platform) }}</span>
            <div class="flex-1 min-w-0" @click="playNow(result)">
              <p class="text-white text-sm truncate">{{ result.name }}</p>
              <p class="text-white/50 text-xs truncate">{{ result.artist }}</p>
            </div>
            <button
              @click.stop="addToPlaylist(result)"
              class="opacity-0 group-hover:opacity-100 px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/20 transition-all"
            >
              添加
            </button>
          </div>
        </div>
        
        <!-- 关闭按钮 -->
        <button
          @click="showResults = false"
          class="w-full p-2 text-white/40 text-sm hover:bg-white/5 border-t border-white/10"
        >
          关闭
        </button>
      </div>
    </Transition>
    
    <!-- 点击外部关闭（桌面端，非弹窗模式） -->
    <div 
      v-if="showResults && !popupOnly"
      class="hidden md:block fixed inset-0 z-40"
      @click="showResults = false"
    ></div>

    <!-- 搜索浮窗（移动端底部弹出，桌面端居中弹窗） -->
    <Transition name="modal">
      <div 
        v-if="showMobileSearch"
        class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center"
        @click.self="showMobileSearch = false"
      >
        <!-- 搜索面板 -->
        <div class="w-full md:w-[520px] md:max-w-[90vw] max-h-[90vh] md:max-h-[85vh] bg-gradient-to-b from-neutral-900 to-neutral-950 backdrop-blur-xl rounded-t-[28px] md:rounded-[28px] flex flex-col overflow-hidden md:shadow-2xl border-t border-white/10 md:border md:border-white/10">
          
          <!-- 顶部区域：拖动条 + AI状态 -->
          <div class="relative">
            <!-- 拖动指示条（移动端） -->
            <div class="flex justify-center pt-2.5 pb-1 md:hidden">
              <div class="w-9 h-1 rounded-full bg-white/25"></div>
            </div>
            
            <!-- AI 状态区域（顶部统一显示，包括思考中和结果） -->
            <Transition name="ai-status">
              <div 
                v-if="searchMode === 'ai' && aiResponse"
                class="px-4 py-3 bg-gradient-to-r from-purple-600/20 via-purple-500/10 to-transparent"
              >
                <div class="flex items-center gap-3">
                  <div class="relative flex-shrink-0">
                    <div class="w-8 h-8 rounded-full bg-purple-600/30 flex items-center justify-center">
                      <span class="text-base">✨</span>
                    </div>
                    <div v-if="loading" class="absolute inset-0 rounded-full border-2 border-purple-400 border-t-transparent animate-spin"></div>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-white/90 text-sm font-medium leading-relaxed">{{ aiResponse }}</p>
                    <p v-if="loading && thinkingText" class="text-white/50 text-xs mt-0.5 truncate">{{ thinkingText }}</p>
                  </div>
                </div>
              </div>
            </Transition>
            
            <!-- 桌面端标题栏 -->
            <div class="hidden md:flex items-center justify-between px-5 pt-4 pb-2">
              <h3 class="text-white font-semibold text-lg">搜索音乐</h3>
              <button 
                @click="showMobileSearch = false"
                class="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/60 transition-all hover:rotate-90"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>
          </div>
          
          <!-- 搜索栏 -->
          <div class="px-4 pt-2 pb-3">
            <!-- 搜索模式切换 -->
            <div class="flex rounded-2xl bg-white/5 p-1 mb-3">
              <button
                @click="searchMode = 'normal'"
                :class="[
                  'flex-1 py-2.5 rounded-xl text-sm font-medium transition-all',
                  searchMode === 'normal' 
                    ? 'bg-white/15 text-white shadow-sm' 
                    : 'text-white/50 hover:text-white/70'
                ]"
              >
                🔍 普通搜索
              </button>
              <button
                @click="searchMode = 'ai'"
                :class="[
                  'flex-1 py-2.5 rounded-xl text-sm font-medium transition-all',
                  searchMode === 'ai' 
                    ? 'bg-gradient-to-r from-purple-600 to-purple-500 text-white shadow-lg shadow-purple-500/25' 
                    : 'text-white/50 hover:text-white/70'
                ]"
              >
                ✨ AI 搜索
              </button>
            </div>

            <!-- 搜索输入框 -->
            <div class="flex items-center gap-2.5">
              <div class="flex-1 relative group">
                <input
                  ref="mobileSearchInput"
                  v-model="keyword"
                  @keyup.enter="handleSearch"
                  type="text"
                  :placeholder="searchMode === 'ai' ? '描述你想听的音乐...' : '搜索歌曲、歌手...'"
                  class="w-full h-12 pl-4 pr-4 rounded-2xl bg-white/10 text-white placeholder-white/40 outline-none focus:bg-white/15 focus:ring-2 focus:ring-purple-500/30 text-base transition-all"
                  autofocus
                />
              </div>
              <button
                @click="handleSearch"
                :disabled="loading || !keyword.trim()"
                :class="[
                  'h-12 w-12 rounded-2xl flex items-center justify-center transition-all',
                  keyword.trim() 
                    ? 'bg-purple-600 text-white active:scale-95 shadow-lg shadow-purple-500/30' 
                    : 'bg-white/10 text-white/30'
                ]"
              >
                <svg v-if="!loading" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                </svg>
                <div v-else class="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              </button>
            </div>
            
            <!-- 简拼提示 -->
            <Transition name="hint">
              <div
                v-if="pinyinHint && searchMode === 'normal'"
                class="mt-2 px-3 py-1.5 rounded-xl bg-purple-600/80 text-white text-sm inline-block"
              >
                将搜索: {{ pinyinHint }}
              </div>
            </Transition>
            
            <!-- AI 快捷提示 -->
            <Transition name="hint">
              <div v-if="searchMode === 'ai' && !loading && !searchResults.length" class="mt-3">
                <div class="flex flex-wrap gap-2">
                  <button
                    v-for="p in quickPrompts"
                    :key="p.label"
                    @click="useQuickPrompt(p.prompt)"
                    class="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 active:bg-white/15 text-white/70 text-sm transition-all border border-white/5"
                  >
                    {{ p.icon }} {{ p.label }}
                  </button>
                </div>
              </div>
            </Transition>
            
            <!-- 音质选择（更紧凑） -->
            <div class="flex items-center gap-2 mt-3">
              <span class="text-white/40 text-xs">音质</span>
              <div class="flex gap-1">
                <button
                  v-for="q in qualities"
                  :key="q.value"
                  @click="quality = q.value"
                  :class="[
                    'px-2.5 py-1 rounded-lg text-xs transition-all',
                    quality === q.value 
                      ? 'bg-purple-600/80 text-white' 
                      : 'bg-white/5 text-white/50 hover:bg-white/10'
                  ]"
                >
                  {{ q.label }}
                </button>
              </div>
            </div>
          </div>

          <!-- 搜索结果 -->
          <div class="flex-1 overflow-y-auto min-h-[180px] max-h-[55vh]">
            <!-- 加载状态 -->
            <div v-if="loading && searchMode !== 'ai'" class="flex flex-col items-center justify-center py-16">
              <div class="w-10 h-10 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
              <p class="text-white/40 text-sm mt-3">搜索中...</p>
            </div>
            
            <!-- AI 搜索加载状态 -->
            <div v-if="loading && searchMode === 'ai' && searchResults.length === 0" class="flex flex-col items-center justify-center py-16">
              <div class="w-10 h-10 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
              <p class="text-white/40 text-sm mt-3">正在搜索歌曲资源...</p>
            </div>
            
            <!-- 空状态 -->
            <div v-if="!loading && searchResults.length === 0 && !aiResponse" class="flex flex-col items-center justify-center py-12 text-white/40">
              <div class="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
                <span class="text-3xl">{{ searchMode === 'ai' ? '✨' : '🎵' }}</span>
              </div>
              <p class="text-sm">{{ searchMode === 'ai' ? '描述你的心情或场景' : '输入关键词搜索歌曲' }}</p>
              <p class="text-xs text-white/30 mt-1">长按歌曲可多选</p>
            </div>
            
            <!-- 搜索结果列表 -->
            <div v-if="searchResults.length > 0" class="px-3 pb-4">
              <!-- 多选模式提示栏 -->
              <div v-if="isSelectMode" class="flex items-center justify-between px-3 py-2.5 mb-2 rounded-xl bg-purple-600/10 border border-purple-500/20">
                <span class="text-white/70 text-sm">已选 <span class="text-purple-400 font-medium">{{ selectedItems.size }}</span> 首</span>
                <button 
                  @click="toggleSelectAll"
                  class="text-purple-400 text-sm font-medium"
                >
                  {{ selectedItems.size === searchResults.length ? '取消全选' : '全选' }}
                </button>
              </div>
              
              <!-- 结果数量提示 -->
              <div v-if="!isSelectMode && searchResults.length > 0" class="px-2 py-1.5 mb-2">
                <span class="text-white/40 text-xs">找到 {{ searchResults.length }} 首歌曲</span>
              </div>
              
              <!-- 歌曲列表 -->
              <div class="space-y-1">
                <div
                  v-for="(result, index) in searchResults"
                  :key="getResultKey(result)"
                  :class="[
                    'flex items-center gap-3 p-3 rounded-2xl transition-all',
                    isSelectMode && selectedItems.has(getResultKey(result)) 
                      ? 'bg-purple-600/20 border border-purple-500/30' 
                      : 'hover:bg-white/5 active:bg-white/10 border border-transparent'
                  ]"
                  @click="handleResultClick(result)"
                  @mousedown="startLongPress(result, $event)"
                  @mouseup="cancelLongPress"
                  @mouseleave="cancelLongPress"
                  @touchstart.passive="startLongPress(result, $event)"
                  @touchmove.passive="handleTouchMove"
                  @touchend="cancelLongPress"
                  @touchcancel="cancelLongPress"
                >
                  <!-- 多选复选框 -->
                  <div 
                    v-if="isSelectMode"
                    :class="[
                      'w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all',
                      selectedItems.has(getResultKey(result))
                        ? 'bg-purple-600 border-purple-600'
                        : 'border-white/30'
                    ]"
                  >
                    <svg v-if="selectedItems.has(getResultKey(result))" class="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
                    </svg>
                  </div>
                  
                  <!-- 序号/平台图标 -->
                  <div v-if="!isSelectMode" class="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-sm flex-shrink-0">
                    <span class="text-white/40">{{ index + 1 }}</span>
                  </div>
                  
                  <!-- 歌曲信息 -->
                  <div class="flex-1 min-w-0">
                    <p class="text-white text-sm font-medium truncate">{{ result.name }}</p>
                    <div class="flex items-center gap-2 mt-0.5">
                      <span class="text-white/50 text-xs truncate">{{ result.artist }}</span>
                      <span class="text-white/30 text-[10px]">{{ getPlatformIcon(result.platform) }}</span>
                    </div>
                  </div>
                  
                  <!-- 添加按钮 -->
                  <button
                    v-if="!isSelectMode"
                    @click.stop="addToPlaylist(result)"
                    :class="[
                      'w-9 h-9 rounded-xl flex items-center justify-center transition-all',
                      addedFeedback === getResultKey(result)
                        ? 'bg-green-500 text-white scale-110'
                        : 'bg-white/10 text-white/60 hover:bg-purple-600 hover:text-white active:scale-95'
                    ]"
                  >
                    <svg v-if="addedFeedback === getResultKey(result)" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/>
                    </svg>
                    <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
          
          <!-- 批量操作栏（多选模式） -->
          <div v-if="isSelectMode && selectedItems.size > 0" class="px-4 pb-4 pt-3 border-t border-white/5 bg-neutral-900/95">
            <div class="flex gap-2">
              <button
                @click="batchAddToPlaylist"
                class="flex-1 h-12 rounded-2xl bg-purple-600 text-white font-medium flex items-center justify-center gap-2 active:scale-[0.98] transition-all shadow-lg shadow-purple-500/20"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                </svg>
                添加到列表
              </button>
              <button
                @click="batchAddToFavorite"
                class="flex-1 h-12 rounded-2xl bg-gradient-to-r from-pink-600 to-rose-500 text-white font-medium flex items-center justify-center gap-2 active:scale-[0.98] transition-all shadow-lg shadow-pink-500/20"
              >
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                </svg>
                收藏
              </button>
              <button
                @click="exitSelectMode"
                class="w-12 h-12 rounded-2xl bg-white/10 text-white/60 flex items-center justify-center active:scale-95 transition-all"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>
          </div>
          
          <!-- 底部操作栏（非多选模式） -->
          <div v-else class="px-4 pb-5 pt-2 border-t border-white/5">
            <div class="flex gap-2">
              <!-- 换一批按钮 -->
              <button
                v-if="searchResults.length > 0 && !loading"
                @click="handleSearch"
                class="flex-1 h-11 rounded-2xl bg-white/5 hover:bg-white/10 text-white/60 font-medium flex items-center justify-center gap-2 active:scale-[0.98] transition-all border border-white/5"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                换一批
              </button>
              <!-- 关闭按钮 -->
              <button
                @click="showMobileSearch = false"
                :class="[
                  'h-11 rounded-2xl bg-white/10 text-white/60 font-medium active:scale-[0.98] transition-all',
                  searchResults.length > 0 && !loading ? 'w-11 flex items-center justify-center' : 'flex-1'
                ]"
              >
                <svg v-if="searchResults.length > 0 && !loading" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                </svg>
                <span v-else>关闭</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.modal-enter-active {
  transition: opacity 0.3s ease-out;
}
.modal-enter-active > div {
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.modal-leave-active {
  transition: opacity 0.2s ease-in;
}
.modal-leave-active > div {
  transition: transform 0.2s ease-in;
}
.modal-enter-from {
  opacity: 0;
}
.modal-enter-from > div {
  transform: translateY(100%);
}
.modal-leave-to {
  opacity: 0;
}
.modal-leave-to > div {
  transform: translateY(100%);
}

/* 桌面端弹窗动画 */
@media (min-width: 768px) {
  .modal-enter-from > div {
    transform: translateY(20px) scale(0.95);
  }
  .modal-leave-to > div {
    transform: translateY(20px) scale(0.95);
  }
}

.hint-enter-active,
.hint-leave-active {
  transition: opacity 0.15s, transform 0.15s;
}
.hint-enter-from,
.hint-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* AI 状态动画 */
.ai-status-enter-active {
  transition: all 0.3s ease-out;
}
.ai-status-leave-active {
  transition: all 0.2s ease-in;
}
.ai-status-enter-from {
  opacity: 0;
  transform: translateY(-10px);
}
.ai-status-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}
</style>
