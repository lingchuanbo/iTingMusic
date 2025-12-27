<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { usePlayerStore } from '@/store/player'
import { usePlaylistStore } from '@/store/playlist'
import { searchResultToTrack } from '@/services/source/OnlineApiSource'
import {
  getAIRecommendations,
  isAIConfigured,
  AI_ROLES,
  getCurrentRole,
  setCurrentRole,
  loadPreferences,
  savePreferences,
  LANGUAGE_OPTIONS,
  ERA_OPTIONS,
  MOOD_OPTIONS,
  VOCAL_OPTIONS,
  type AIRole,
  type AIPreferences
} from '@/services/ai/AIService'
import { trackStorage } from '@/services/TrackStorage'
import { setSelectMode } from '@/store/ui'
import { searchAndMatch } from '@/utils/songMatcher'

const playerStore = usePlayerStore()
const playlistStore = usePlaylistStore()

// 状态
const userInput = ref('')
const loading = ref(false)
const searching = ref(false)
const error = ref('')
const aiReason = ref('')
const thinkingText = ref('')
const thinkingPhase = ref<'idle' | 'thinking' | 'confirming' | 'adding'>('idle')
const recommendations = ref<
  { title: string; artist: string; category?: string; comment?: string; searchResult?: any; selected?: boolean }[]
>([])
const addingProgress = ref({ current: 0, total: 0, currentSong: '', addedCount: 0 })

// UI 状态
const currentRole = ref<AIRole>(getCurrentRole())
const showRoleSelector = ref(false)
const showPreferences = ref(false)
const showPlayModeModal = ref(false)
const showPlaylistModal = ref(false)
const preferences = ref<AIPreferences>(loadPreferences())
const newFavoriteArtist = ref('')
const newDislikedArtist = ref('')

// 定义事件
const emit = defineEmits<{
  fullscreen: [value: boolean]
}>()

// 沉浸模式：思考中、有推荐结果、添加中都进入沉浸模式
const isImmersive = computed(
  () =>
    (thinkingPhase.value === 'thinking' && loading.value) ||
    (thinkingPhase.value === 'confirming' && recommendations.value.length > 0) ||
    (thinkingPhase.value === 'adding' && searching.value)
)

// 同步沉浸模式到全局状态（只在有推荐结果时隐藏底部栏）
const shouldHideBottomBar = computed(
  () => thinkingPhase.value === 'confirming' && recommendations.value.length > 0 && !searching.value
)
watch(shouldHideBottomBar, (val) => setSelectMode(val), { immediate: true })

// 同步沉浸模式到父组件（隐藏搜索按钮）
watch(isImmersive, (val) => emit('fullscreen', val), { immediate: true })

onUnmounted(() => {
  setSelectMode(false)
  emit('fullscreen', false)
})

// 退出沉浸模式
function exitImmersive() {
  recommendations.value = []
  thinkingPhase.value = 'idle'
  aiReason.value = ''
}

// Toast
const toast = ref({ show: false, message: '', type: 'success' as 'success' | 'error' })
function showToast(message: string, type: 'success' | 'error' = 'success') {
  toast.value = { show: true, message, type }
  setTimeout(() => {
    toast.value.show = false
  }, 2500)
}

// 选中数量
const selectedCount = computed(() => recommendations.value.filter((s) => s.selected !== false).length)

// AI 理由按换行符或句子分行，并解析高亮标记
const formattedReason = computed(() => {
  if (!aiReason.value) return []
  // 先按换行符分割
  let lines = aiReason.value.split(/\\n|\n/g)
  // 如果没有换行符，则按句号等标点分割
  if (lines.length <= 1) {
    lines = aiReason.value
      .split(/(?<=[。！？~…])/g)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  }
  return lines.map((s) => s.trim()).filter((s) => s.length > 0)
})

// 解析单行文本中的高亮标记 **text** 转为 HTML
function parseHighlight(text: string): string {
  // 将 **text** 转换为带样式的 span
  return text.replace(
    /\*\*([^*]+)\*\*/g,
    '<span class="text-purple-300 font-semibold text-base">$1</span>'
  )
}

// 快捷提示 - 使用 SVG 图标类型
type QuickPrompt = { iconType: string; label: string; prompt: string; gradient: string }
const quickPrompts = computed((): QuickPrompt[] => {
  const role = currentRole.value
  const defaultPrompts: QuickPrompt[] = [
    {
      iconType: 'leaf',
      label: '放松',
      prompt: '推荐一些能让人彻底放松下来的音乐，要有新鲜感，不要推荐那些被推荐烂了的歌',
      gradient: 'from-emerald-500 to-teal-500'
    },
    {
      iconType: 'briefcase',
      label: '工作',
      prompt: '推荐适合专注工作时听的音乐，要能提升效率但不会分心，给我一些惊喜',
      gradient: 'from-blue-500 to-indigo-500'
    },
    { iconType: 'run', label: '运动', prompt: '推荐适合运动健身时听的歌，节奏要带劲，但不要总是那几首老歌', gradient: 'from-orange-500 to-red-500' },
    { iconType: 'moon', label: '夜晚', prompt: '推荐适合深夜独处时听的音乐，要有氛围感，挖掘一些小众但好听的', gradient: 'from-indigo-500 to-purple-500' },
    { iconType: 'car', label: '开车', prompt: '推荐适合开车兜风时听的歌，要有公路感和自由感，给我一些新鲜的选择', gradient: 'from-cyan-500 to-blue-500' },
    { iconType: 'coffee', label: '咖啡', prompt: '推荐适合在咖啡厅听的音乐，要有格调但不俗套，发现一些宝藏歌曲', gradient: 'from-amber-500 to-orange-500' }
  ]
  const rolePrompts: Record<string, QuickPrompt[]> = {
    rocker: [
      { iconType: 'guitar', label: '经典摇滚', prompt: '推荐经典摇滚乐队的歌，但不要只推荐最热门的那几首，挖掘一些被低估的好歌', gradient: 'from-red-500 to-orange-500' },
      { iconType: 'fire', label: '重金属', prompt: '来点重金属音乐，要够硬够燃，给我一些新鲜的选择', gradient: 'from-zinc-500 to-slate-600' },
      { iconType: 'bolt', label: '朋克', prompt: '推荐朋克摇滚，要有态度有能量，不要总是那几首', gradient: 'from-yellow-500 to-lime-500' },
      { iconType: 'spark', label: '另类', prompt: '推荐另类摇滚音乐，要有个性，发现一些宝藏乐队', gradient: 'from-purple-500 to-pink-500' }
    ],
    classical: [
      { iconType: 'piano', label: '钢琴曲', prompt: '推荐优美的钢琴曲，不要只推荐卡农和梦中的婚礼，给我一些新鲜的', gradient: 'from-slate-400 to-slate-600' },
      { iconType: 'music', label: '交响乐', prompt: '推荐著名的交响乐，但要有新意，不要总是那几首', gradient: 'from-amber-500 to-yellow-500' },
      { iconType: 'film', label: '电影配乐', prompt: '推荐经典电影配乐，挖掘一些被低估的好作品', gradient: 'from-rose-500 to-pink-500' },
      { iconType: 'moon', label: '夜曲', prompt: '推荐浪漫的夜曲，要有氛围感，给我一些惊喜', gradient: 'from-indigo-500 to-purple-500' }
    ],
    hipster: [
      { iconType: 'fire', label: '热歌', prompt: '推荐最近最火的歌，但要有品味，不要只推荐抖音神曲', gradient: 'from-red-500 to-orange-500' },
      { iconType: 'mic', label: '说唱', prompt: '推荐好听的说唱，要有态度有内容，发现一些宝藏rapper', gradient: 'from-purple-500 to-violet-500' },
      { iconType: 'wave', label: '电子', prompt: '推荐好听的电子音乐，要有质感，不要太商业化的', gradient: 'from-cyan-500 to-blue-500' },
      { iconType: 'heart', label: 'R&B', prompt: '推荐好听的R&B，要有感觉，挖掘一些小众但好听的', gradient: 'from-pink-500 to-rose-500' }
    ],
    folk: [
      { iconType: 'guitar', label: '民谣', prompt: '推荐好听的华语民谣，不要只推荐那几个大众歌手，发现一些独立音乐人', gradient: 'from-amber-500 to-yellow-500' },
      { iconType: 'leaf', label: '独立', prompt: '推荐小众独立音乐，要有个性有态度，给我一些惊喜', gradient: 'from-teal-500 to-cyan-500' },
      { iconType: 'coffee', label: '咖啡厅', prompt: '推荐适合咖啡厅的音乐，要有格调，不要太俗套', gradient: 'from-stone-500 to-zinc-500' },
      { iconType: 'book', label: '文艺', prompt: '推荐文艺范的歌曲，要有深度有内涵，发现一些宝藏', gradient: 'from-violet-500 to-purple-500' }
    ],
    retro: [
      { iconType: 'radio', label: '90年代', prompt: '推荐90年代经典老歌，但不要只推荐最热门的，挖掘一些被遗忘的好歌', gradient: 'from-amber-500 to-orange-500' },
      { iconType: 'music', label: '粤语', prompt: '推荐粤语经典金曲，不要只推荐四大天王，发现一些被低估的好歌', gradient: 'from-red-500 to-rose-500' },
      { iconType: 'globe', label: '欧美', prompt: '推荐欧美经典老歌，要有品味，不要太大众化', gradient: 'from-blue-500 to-indigo-500' },
      { iconType: 'saxophone', label: '爵士', prompt: '推荐经典爵士乐，要有格调，给我一些新鲜的选择', gradient: 'from-yellow-500 to-amber-500' }
    ],
    chill: [
      { iconType: 'sleep', label: '助眠', prompt: '推荐适合睡前听的音乐，要能真正帮助入睡，不要太俗套', gradient: 'from-indigo-500 to-purple-500' },
      { iconType: 'zen', label: '冥想', prompt: '推荐适合冥想的音乐，要有深度有氛围，发现一些宝藏', gradient: 'from-teal-500 to-cyan-500' },
      { iconType: 'headphone', label: 'Lo-fi', prompt: '推荐好听的Lo-fi音乐，要有质感，不要太商业化', gradient: 'from-violet-500 to-purple-500' },
      { iconType: 'note', label: '轻音乐', prompt: '推荐轻柔的纯音乐，要有意境，给我一些惊喜', gradient: 'from-sky-500 to-blue-500' }
    ],
    party: [
      { iconType: 'wave', label: 'EDM', prompt: '推荐嗨爆的EDM，要够燃够嗨，但不要只推荐那几首老歌', gradient: 'from-pink-500 to-rose-500' },
      { iconType: 'party', label: '派对', prompt: '推荐适合派对的歌，要能带动气氛，给我一些新鲜的', gradient: 'from-orange-500 to-red-500' },
      { iconType: 'disco', label: '蹦迪', prompt: '推荐蹦迪神曲，要够嗨够带劲，发现一些新歌', gradient: 'from-purple-500 to-violet-500' },
      { iconType: 'fire', label: '嗨曲', prompt: '推荐超嗨的歌，要能让人嗨起来，不要太俗套', gradient: 'from-yellow-500 to-orange-500' }
    ]
  }
  return rolePrompts[role.id] || defaultPrompts
})

// 角色选择
function selectRole(role: AIRole) {
  currentRole.value = role
  setCurrentRole(role.id)
  showRoleSelector.value = false
  recommendations.value = []
  thinkingPhase.value = 'idle'
}

// 偏好设置
function togglePreference(key: 'languages' | 'eras' | 'moods' | 'vocals', value: string) {
  const arr = preferences.value[key]
  const idx = arr.indexOf(value)
  if (idx >= 0) arr.splice(idx, 1)
  else arr.push(value)
  savePreferences(preferences.value)
}

function addFavoriteArtist() {
  const artist = newFavoriteArtist.value.trim()
  if (artist && !preferences.value.favoriteArtists.includes(artist)) {
    preferences.value.favoriteArtists.push(artist)
    savePreferences(preferences.value)
  }
  newFavoriteArtist.value = ''
}

function removeFavoriteArtist(artist: string) {
  const idx = preferences.value.favoriteArtists.indexOf(artist)
  if (idx >= 0) { preferences.value.favoriteArtists.splice(idx, 1); savePreferences(preferences.value) }
}

function addDislikedArtist() {
  const artist = newDislikedArtist.value.trim()
  if (artist && !preferences.value.dislikedArtists.includes(artist)) {
    preferences.value.dislikedArtists.push(artist)
    savePreferences(preferences.value)
  }
  newDislikedArtist.value = ''
}

function removeDislikedArtist(artist: string) {
  const idx = preferences.value.dislikedArtists.indexOf(artist)
  if (idx >= 0) { preferences.value.dislikedArtists.splice(idx, 1); savePreferences(preferences.value) }
}

// 切换歌曲选中
function toggleSongSelection(index: number) {
  recommendations.value[index].selected = recommendations.value[index].selected === false ? true : false
}

function toggleSelectAll() {
  const allSelected = selectedCount.value === recommendations.value.length
  recommendations.value.forEach(s => (s.selected = !allSelected))
}

// 获取推荐
async function getRecommendations() {
  if (!userInput.value.trim()) { error.value = '请输入你想听什么样的音乐'; return }
  if (!isAIConfigured()) { error.value = '请先在设置中配置 AI API Key'; return }
  
  loading.value = true
  error.value = ''
  aiReason.value = ''
  thinkingText.value = ''
  thinkingPhase.value = 'thinking'
  recommendations.value = []
  
  try {
    const result = await getAIRecommendations(userInput.value, { onThinking: (text) => { thinkingText.value = text } }, currentRole.value)
    if (!result || result.songs.length === 0) { 
      error.value = 'AI 没有返回推荐结果，请换个描述试试'
      thinkingPhase.value = 'idle'
      loading.value = false
      return 
    }
    aiReason.value = result.reason
    recommendations.value = result.songs.map(s => ({ ...s, selected: true }))
    thinkingPhase.value = 'confirming'
  } catch (e: any) { 
    error.value = e.message || '获取推荐失败'
    thinkingPhase.value = 'idle'
  } finally { 
    loading.value = false 
  }
}

function useQuickPrompt(prompt: string) { 
  userInput.value = prompt
  getRecommendations() 
}

function refreshRecommendations() {
  if (userInput.value.trim()) getRecommendations()
}

// 播放歌曲（支持加入和替换两种模式）
async function playSelectedSongs(replaceMode: boolean = false) {
  const selectedSongs = recommendations.value.filter(s => s.selected !== false)
  if (selectedSongs.length === 0) { error.value = '请至少选择一首歌曲'; return }
  
  searching.value = true
  thinkingPhase.value = 'adding'
  addingProgress.value = { current: 0, total: selectedSongs.length, currentSong: '', addedCount: 0 }
  
  // 替换模式：先清空播放列表
  if (replaceMode) {
    playerStore.clearPlaylist()
  }
  
  let firstTrackIndex = -1
  
  for (let i = 0; i < selectedSongs.length; i++) {
    const song = selectedSongs[i]
    addingProgress.value.current = i + 1
    addingProgress.value.currentSong = `${song.title} - ${song.artist}`
    
    // 使用统一的精准匹配函数
    const match = await searchAndMatch(song.title, song.artist)
    if (match) { 
      song.searchResult = match
      const track = searchResultToTrack(match)
      playerStore.addTrack(track)
      addingProgress.value.addedCount++
      if (firstTrackIndex === -1) firstTrackIndex = playerStore.playlist.length - 1
    }
  }
  
  if (firstTrackIndex !== -1) playerStore.playTrack(firstTrackIndex)
  
  const addedCount = addingProgress.value.addedCount
  const modeText = replaceMode ? '替换播放' : '加入'
  showToast(addedCount > 0 ? `🎵 已${modeText} ${addedCount} 首歌曲` : '未能找到可播放的歌曲', addedCount > 0 ? 'success' : 'error')
  
  searching.value = false
  thinkingPhase.value = 'confirming'
}

// 添加到歌单
async function addToUserPlaylist(playlistId: string) {
  const selectedSongs = recommendations.value.filter(s => s.selected !== false)
  if (selectedSongs.length === 0) { showPlaylistModal.value = false; return }
  
  const playlist = playlistStore.playlists.find(p => p.id === playlistId)
  const playlistName = playlist?.name || '歌单'
  
  showPlaylistModal.value = false
  searching.value = true
  thinkingPhase.value = 'adding'
  addingProgress.value = { current: 0, total: selectedSongs.length, currentSong: '', addedCount: 0 }
  
  for (let i = 0; i < selectedSongs.length; i++) {
    const song = selectedSongs[i]
    addingProgress.value.current = i + 1
    addingProgress.value.currentSong = `${song.title} - ${song.artist}`
    
    if (!song.searchResult) {
      // 使用统一的精准匹配函数
      const match = await searchAndMatch(song.title, song.artist)
      if (match) { song.searchResult = match }
    }
    
    if (song.searchResult) {
      const track = searchResultToTrack(song.searchResult)
      playerStore.addTrack(track)
      trackStorage.saveTrack(track)
      playlistStore.addToPlaylist(playlistId, track.id)
      addingProgress.value.addedCount++
    }
  }
  
  const addedCount = addingProgress.value.addedCount
  showToast(addedCount > 0 ? `📁 已添加 ${addedCount} 首到「${playlistName}」` : '未能找到可添加的歌曲', addedCount > 0 ? 'success' : 'error')
  
  searching.value = false
  thinkingPhase.value = 'confirming'
}
</script>

<template>
  <div class="flex-1 overflow-y-auto bg-gradient-to-b from-slate-900 to-black">
    <!-- Toast -->
    <Transition name="toast">
      <div v-if="toast.show" class="fixed top-16 left-1/2 -translate-x-1/2 z-50">
        <div :class="['px-4 py-2.5 rounded-full shadow-xl backdrop-blur-xl flex items-center gap-2', toast.type === 'success' ? 'bg-green-500/90 text-white' : 'bg-red-500/90 text-white']">
          <span class="text-sm">{{ toast.message }}</span>
        </div>
      </div>
    </Transition>

    <div class="px-4 pt-6 pb-8 relative">
      <!-- 背景装饰 -->
      <div class="absolute inset-0 overflow-hidden pointer-events-none">
        <div class="absolute -top-20 -right-20 w-64 h-64 bg-purple-600/10 rounded-full blur-3xl"></div>
        <div class="absolute top-40 -left-20 w-48 h-48 bg-pink-600/10 rounded-full blur-3xl"></div>
      </div>

      <!-- 非沉浸模式 -->
      <template v-if="!isImmersive">
        <!-- 标题 -->
        <div class="text-center mb-8 relative">
          <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 mb-4 shadow-lg shadow-purple-500/30">
            <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
            </svg>
          </div>
          <h1 class="text-white text-2xl font-bold mb-2">AI 智能选歌</h1>
          <p class="text-white/50 text-sm">告诉我你的心情，为你推荐完美歌单</p>
        </div>

        <!-- 输入框 + 角色选择 -->
        <div class="max-w-md mx-auto mb-6">
          <div class="flex items-center gap-2 p-2.5 rounded-2xl bg-white/[0.06] border border-white/[0.08] backdrop-blur-sm shadow-lg shadow-black/20">
            <!-- 角色头像按钮 -->
            <button @click="showRoleSelector = !showRoleSelector" class="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-lg flex-shrink-0 hover:scale-105 active:scale-95 transition-all">
              {{ currentRole.avatar }}
            </button>
            <!-- 输入框容器 -->
            <div class="flex-1 relative min-w-0">
              <input
                v-model="userInput"
                type="text"
                :placeholder="`问问 ${currentRole.name}...`"
                class="w-full h-10 px-2 pr-8 bg-transparent text-white placeholder-white/40 outline-none text-sm"
                @keyup.enter="getRecommendations"
                :disabled="loading"
              />
              <!-- 清除按钮 -->
              <Transition name="fade">
                <button
                  v-if="userInput.length > 0"
                  @click.stop="userInput = ''"
                  class="absolute right-1 top-1/2 -translate-y-1/2 z-10 w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-white/60 hover:bg-white/30 hover:text-white active:scale-90 transition-all"
                >
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                </button>
              </Transition>
            </div>
            <!-- 设置按钮 -->
            <button @click="showPreferences = true" class="w-10 h-10 rounded-xl flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/10 transition-all flex-shrink-0">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
              </svg>
            </button>
            <!-- 发送按钮 -->
            <button @click="getRecommendations" :disabled="loading || !userInput.trim()" :class="['w-10 h-10 rounded-xl flex items-center justify-center transition-all flex-shrink-0', userInput.trim() && !loading ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white' : 'bg-white/10 text-white/30']">
              <svg v-if="!loading" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
              <div v-else class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            </button>
          </div>
        </div>

        <!-- 角色选择器 -->
        <Transition name="slide">
          <div v-if="showRoleSelector" class="max-w-md mx-auto mb-6 p-4 rounded-2xl bg-black/40 backdrop-blur-xl border border-white/10 shadow-2xl">
            <p class="text-white/50 text-xs mb-3 text-center">选择你的 AI 音乐顾问</p>
            <div class="grid grid-cols-4 gap-2">
              <button v-for="role in AI_ROLES" :key="role.id" @click="selectRole(role)" :class="['p-3 rounded-xl text-center transition-all relative overflow-hidden group', currentRole.id === role.id ? 'bg-gradient-to-br from-purple-600/40 to-pink-600/40 border border-purple-500/50 shadow-lg shadow-purple-500/20' : 'bg-white/[0.04] hover:bg-white/[0.08] border border-transparent']">
                <div class="absolute inset-0 bg-gradient-to-br from-purple-500/0 to-pink-500/0 group-hover:from-purple-500/10 group-hover:to-pink-500/10 transition-all"></div>
                <div class="relative">
                  <div :class="['w-10 h-10 mx-auto rounded-xl flex items-center justify-center text-2xl mb-1.5 transition-transform group-hover:scale-110', currentRole.id === role.id ? 'bg-gradient-to-br from-purple-500 to-pink-500 shadow-lg' : 'bg-white/10']">
                    {{ role.avatar }}
                  </div>
                  <span :class="['text-xs block truncate transition-colors', currentRole.id === role.id ? 'text-white font-medium' : 'text-white/60 group-hover:text-white']">{{ role.name }}</span>
                </div>
                <div v-if="currentRole.id === role.id" class="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-green-500"></div>
              </button>
            </div>
          </div>
        </Transition>

        <!-- 未配置提示 -->
        <div v-if="!isAIConfigured()" class="max-w-md mx-auto mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center gap-3">
          <svg class="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
          <span class="text-amber-200 text-xs">请先在设置中配置 AI API Key</span>
        </div>

        <!-- 错误提示 -->
        <div v-if="error" class="max-w-md mx-auto mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-2">
          <svg class="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          <span class="text-red-200 text-xs">{{ error }}</span>
        </div>

        <!-- 快捷选择 - 简洁风格 -->
        <div v-if="thinkingPhase === 'idle' && !loading" class="max-w-md mx-auto">
          <p class="text-white/40 text-xs mb-3 text-center">快捷推荐</p>
          <div class="grid grid-cols-3 gap-2">
            <button v-for="item in quickPrompts" :key="item.label" @click="useQuickPrompt(item.prompt)" class="flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl hover:bg-white/5 transition-all group">
              <!-- 纯图标 -->
              <div class="group-hover:scale-110 transition-transform">
                <svg v-if="item.iconType === 'leaf'" class="w-6 h-6 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"/></svg>
                <svg v-else-if="item.iconType === 'briefcase'" class="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2zM16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></svg>
                <svg v-else-if="item.iconType === 'run'" class="w-6 h-6 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                <svg v-else-if="item.iconType === 'moon'" class="w-6 h-6 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>
                <svg v-else-if="item.iconType === 'car'" class="w-6 h-6 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0zM5 17H3v-4l2-5h10l2 5v4h-2M5 12h10"/></svg>
                <svg v-else-if="item.iconType === 'coffee'" class="w-6 h-6 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M18 8h1a4 4 0 010 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8zM6 1v3M10 1v3M14 1v3"/></svg>
                <svg v-else-if="item.iconType === 'guitar'" class="w-6 h-6 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z"/></svg>
                <svg v-else-if="item.iconType === 'fire'" class="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z"/></svg>
                <svg v-else-if="item.iconType === 'bolt'" class="w-6 h-6 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                <svg v-else-if="item.iconType === 'spark'" class="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"/></svg>
                <!-- 钢琴 -->
                <svg v-else-if="item.iconType === 'piano'" class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/></svg>
                <!-- 音乐 -->
                <svg v-else-if="item.iconType === 'music'" class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/></svg>
                <!-- 电影 -->
                <svg v-else-if="item.iconType === 'film'" class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"/></svg>
                <!-- 麦克风 -->
                <svg v-else-if="item.iconType === 'mic'" class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/></svg>
                <!-- 波浪 -->
                <svg v-else-if="item.iconType === 'wave'" class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/></svg>
                <!-- 爱心 -->
                <svg v-else-if="item.iconType === 'heart'" class="w-6 h-6 text-pink-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/></svg>
                <svg v-else-if="item.iconType === 'book'" class="w-6 h-6 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>
                <svg v-else-if="item.iconType === 'radio'" class="w-6 h-6 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728m-9.9-2.829a5 5 0 010-7.07m7.072 0a5 5 0 010 7.07M13 12a1 1 0 11-2 0 1 1 0 012 0z"/></svg>
                <svg v-else-if="item.iconType === 'globe'" class="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9"/></svg>
                <svg v-else-if="item.iconType === 'saxophone'" class="w-6 h-6 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z"/></svg>
                <svg v-else-if="item.iconType === 'sleep'" class="w-6 h-6 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>
                <svg v-else-if="item.iconType === 'zen'" class="w-6 h-6 text-teal-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"/></svg>
                <svg v-else-if="item.iconType === 'headphone'" class="w-6 h-6 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 18v-6a9 9 0 0118 0v6"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3zM3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3z"/></svg>
                <svg v-else-if="item.iconType === 'note'" class="w-6 h-6 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z"/></svg>
                <svg v-else-if="item.iconType === 'party'" class="w-6 h-6 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"/></svg>
                <svg v-else-if="item.iconType === 'disco'" class="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"/></svg>
                <svg v-else-if="item.iconType === 'piano'" class="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z"/></svg>
                <svg v-else-if="item.iconType === 'music'" class="w-6 h-6 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z"/></svg>
                <svg v-else-if="item.iconType === 'film'" class="w-6 h-6 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"/></svg>
                <svg v-else-if="item.iconType === 'mic'" class="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/></svg>
                <svg v-else-if="item.iconType === 'wave'" class="w-6 h-6 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z"/></svg>
                <svg v-else class="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z"/></svg>
              </div>
              <span class="text-white/60 group-hover:text-white/90 text-xs transition-colors">{{ item.label }}</span>
            </button>
          </div>
        </div>
      </template>

      <!-- 沉浸模式内容 -->
      <div v-if="isImmersive" class="pb-36">
        <!-- AI 思考中 -->
        <div v-if="loading && thinkingPhase === 'thinking'" class="mb-4">
          <div class="flex items-center gap-3 mb-4">
            <div class="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-2xl animate-pulse">{{ currentRole.avatar }}</div>
            <div class="flex-1">
              <span class="text-white font-medium">{{ currentRole.name }}</span>
              <span class="text-purple-300 text-sm ml-2">正在思考...</span>
            </div>
          </div>
          <div class="p-4 rounded-xl bg-purple-500/10 border border-purple-500/20">
            <div class="text-white/70 text-sm leading-relaxed">
              {{ thinkingText || '分析你的需求中...' }}
              <span class="inline-block w-1.5 h-4 bg-purple-400 ml-1 animate-pulse"></span>
            </div>
          </div>
        </div>

        <!-- 添加进度 -->
        <div v-if="searching && thinkingPhase === 'adding'">
          <div class="flex items-center gap-3 mb-4">
            <div class="w-12 h-12 rounded-full bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center">
              <svg class="w-6 h-6 text-white animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/>
              </svg>
            </div>
            <div class="flex-1">
              <div class="flex items-center justify-between mb-1">
                <span class="text-white font-medium">正在添加歌曲</span>
                <span class="text-green-300 text-sm">{{ addingProgress.current }}/{{ addingProgress.total }}</span>
              </div>
              <p class="text-white/60 text-sm truncate">{{ addingProgress.currentSong }}</p>
            </div>
          </div>
          <div class="h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div class="h-full bg-gradient-to-r from-green-500 to-emerald-500 transition-all duration-300" :style="{ width: `${(addingProgress.current / addingProgress.total) * 100}%` }"></div>
          </div>
        </div>

        <!-- 推荐结果 -->
        <template v-if="thinkingPhase === 'confirming' && recommendations.length > 0 && !searching">
          <!-- 顶部标题栏 -->
          <div class="flex items-center gap-3 mb-4">
            <div class="flex-1 flex items-center gap-2">
              <span class="text-xl">{{ currentRole.avatar }}</span>
              <span class="text-white font-medium">{{ currentRole.name }} 的推荐</span>
              <span class="text-white/40 text-sm">{{ recommendations.length }} 首</span>
            </div>
          </div>

          <!-- AI 说明 - 对话气泡样式 -->
          <div
            v-if="formattedReason.length > 0"
            class="mb-4 p-4 rounded-2xl bg-gradient-to-br from-purple-500/10 to-pink-500/5 border border-purple-500/20 relative overflow-hidden"
          >
            <!-- 右侧装饰音符 -->
            <div class="absolute right-3 top-1/2 -translate-y-1/2 opacity-20">
              <svg class="w-16 h-16 text-purple-400" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
              </svg>
            </div>
            <!-- 左边文字 -->
            <div class="relative z-10 space-y-1.5 pr-16">
              <p
                v-for="(line, idx) in formattedReason"
                :key="idx"
                class="text-white/75 text-sm leading-relaxed"
                v-html="parseHighlight(line)"
              ></p>
            </div>
          </div>

          <!-- 歌曲列表 -->
          <div class="space-y-1">
            <div v-for="(song, idx) in recommendations" :key="idx" @click="toggleSongSelection(idx)" :class="['flex items-center gap-3 px-3 py-3 rounded-xl cursor-pointer transition-all', song.selected !== false ? 'bg-white/5' : 'opacity-50']">
              <div :class="['w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all', song.selected !== false ? 'bg-purple-600 border-purple-600' : 'border-white/30']">
                <svg v-if="song.selected !== false" class="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-white text-sm truncate">{{ song.title }}</p>
                <p class="text-white/40 text-xs truncate">{{ song.artist }}</p>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- 底部固定操作栏（仅在有推荐结果时显示）- 悬浮卡片样式 -->
    <Transition name="slide-up">
      <div v-if="shouldHideBottomBar" class="fixed bottom-4 left-0 right-0 z-40 px-4 safe-area-bottom">
        <div class="max-w-xl mx-auto rounded-2xl bg-neutral-900/98 backdrop-blur-xl border border-white/10 shadow-2xl overflow-hidden">
          <!-- 顶部信息栏 -->
          <div class="flex items-center justify-between px-4 py-2.5 border-b border-white/5">
            <div class="flex items-center gap-3">
              <button @click="exitImmersive" class="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/20 transition-colors">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
              </button>
              <span class="text-white font-medium">已选 <span class="text-purple-400">{{ selectedCount }}</span> 首</span>
            </div>
            <button @click="toggleSelectAll" class="text-purple-400 text-sm hover:text-purple-300 transition-colors">
              {{ selectedCount === recommendations.length ? '取消全选' : '全选' }}
            </button>
          </div>
          <!-- 操作按钮 -->
          <div class="flex items-center justify-around py-3 px-2">
            <button @click="showPlayModeModal = true" :disabled="selectedCount === 0" class="flex flex-col items-center gap-1 px-4 py-1.5 rounded-xl hover:bg-white/5 disabled:opacity-40 transition-colors group">
              <div class="w-10 h-10 rounded-full bg-purple-600 flex items-center justify-center group-hover:bg-purple-500 transition-colors">
                <svg class="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
              </div>
              <span class="text-white/70 text-xs">播放</span>
            </button>
            <button @click="showPlaylistModal = true" :disabled="selectedCount === 0" class="flex flex-col items-center gap-1 px-4 py-1.5 rounded-xl hover:bg-white/5 disabled:opacity-40 transition-colors group">
              <div class="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center group-hover:bg-blue-600/20 transition-colors">
                <svg class="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z"/></svg>
              </div>
              <span class="text-white/70 text-xs">歌单</span>
            </button>
            <button @click="refreshRecommendations" class="flex flex-col items-center gap-1 px-4 py-1.5 rounded-xl hover:bg-white/5 transition-colors group">
              <div class="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center group-hover:bg-green-600/20 transition-colors">
                <svg class="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
              </div>
              <span class="text-white/70 text-xs">换一批</span>
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 播放模式选择弹窗 -->
    <Transition name="fade">
      <div v-if="showPlayModeModal" class="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" @click.self="showPlayModeModal = false">
        <div class="w-full max-w-md bg-slate-900 rounded-t-3xl overflow-hidden">
          <div class="px-4 py-3 border-b border-white/10 flex items-center justify-between">
            <span class="text-white font-medium">选择播放方式</span>
            <button @click="showPlayModeModal = false" class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/60">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
          <div class="p-4 space-y-3">
            <button @click="showPlayModeModal = false; playSelectedSongs(false)" class="w-full px-4 py-4 flex items-center gap-4 rounded-2xl bg-white/5 hover:bg-white/10 transition-colors">
              <div class="w-12 h-12 rounded-full bg-purple-600/20 flex items-center justify-center">
                <svg class="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
              </div>
              <div class="flex-1 text-left">
                <p class="text-white font-medium">加入播放列表</p>
                <p class="text-white/50 text-xs mt-0.5">添加到当前播放列表末尾</p>
              </div>
            </button>
            <button @click="showPlayModeModal = false; playSelectedSongs(true)" class="w-full px-4 py-4 flex items-center gap-4 rounded-2xl bg-white/5 hover:bg-white/10 transition-colors">
              <div class="w-12 h-12 rounded-full bg-pink-600/20 flex items-center justify-center">
                <svg class="w-6 h-6 text-pink-400" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
              </div>
              <div class="flex-1 text-left">
                <p class="text-white font-medium">替换播放列表</p>
                <p class="text-white/50 text-xs mt-0.5">清空当前列表，仅播放这些歌曲</p>
              </div>
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 歌单选择弹窗 -->
    <Transition name="fade">
      <div v-if="showPlaylistModal" class="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" @click.self="showPlaylistModal = false">
        <div class="w-full max-w-md bg-slate-900 rounded-t-3xl overflow-hidden">
          <div class="px-4 py-3 border-b border-white/10 flex items-center justify-between">
            <span class="text-white font-medium">添加到歌单</span>
            <button @click="showPlaylistModal = false" class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/60">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
          
          <div class="max-h-64 overflow-y-auto">
            <div v-if="playlistStore.playlists.length === 0" class="py-8 text-center">
              <p class="text-white/40 text-sm">还没有歌单</p>
              <p class="text-white/30 text-xs mt-1">去「我的」页面创建一个吧</p>
            </div>
            <button v-for="playlist in playlistStore.playlists" :key="playlist.id" @click="addToUserPlaylist(playlist.id)" class="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/5 transition-colors text-left border-b border-white/5 last:border-b-0">
              <div class="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                <svg class="w-5 h-5 text-purple-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/></svg>
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-white text-sm truncate">{{ playlist.name }}</p>
                <p class="text-white/40 text-xs">{{ playlist.trackIds.length }} 首</p>
              </div>
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 偏好设置弹窗 -->
    <Transition name="fade">
      <div v-if="showPreferences" class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm" @click.self="showPreferences = false">
        <div class="absolute inset-x-0 bottom-0 max-h-[85vh] bg-slate-900 rounded-t-3xl overflow-hidden">
          <div class="sticky top-0 bg-slate-900 px-4 py-3 border-b border-white/10 flex items-center justify-between">
            <span class="text-white font-medium">偏好设置</span>
            <button @click="showPreferences = false" class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/60">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
          
          <div class="p-4 overflow-y-auto max-h-[calc(85vh-56px)] space-y-5">
            <!-- 语言 -->
            <div>
              <p class="text-white/60 text-xs mb-2">🌐 语言偏好</p>
              <div class="flex flex-wrap gap-2">
                <button v-for="opt in LANGUAGE_OPTIONS" :key="opt.value" @click="togglePreference('languages', opt.value)" :class="['px-3 py-1.5 rounded-lg text-xs transition-all', preferences.languages.includes(opt.value) ? 'bg-purple-600 text-white' : 'bg-white/5 text-white/50']">
                  {{ opt.icon }} {{ opt.label }}
                </button>
              </div>
            </div>

            <!-- 年代 -->
            <div>
              <p class="text-white/60 text-xs mb-2">📅 年代偏好</p>
              <div class="flex flex-wrap gap-2">
                <button v-for="opt in ERA_OPTIONS" :key="opt.value" @click="togglePreference('eras', opt.value)" :class="['px-3 py-1.5 rounded-lg text-xs transition-all', preferences.eras.includes(opt.value) ? 'bg-blue-600 text-white' : 'bg-white/5 text-white/50']">
                  {{ opt.icon }} {{ opt.label }}
                </button>
              </div>
            </div>

            <!-- 情绪 -->
            <div>
              <p class="text-white/60 text-xs mb-2">🎭 情绪偏好</p>
              <div class="flex flex-wrap gap-2">
                <button v-for="opt in MOOD_OPTIONS" :key="opt.value" @click="togglePreference('moods', opt.value)" :class="['px-3 py-1.5 rounded-lg text-xs transition-all', preferences.moods.includes(opt.value) ? 'bg-green-600 text-white' : 'bg-white/5 text-white/50']">
                  {{ opt.icon }} {{ opt.label }}
                </button>
              </div>
            </div>

            <!-- 人声 -->
            <div>
              <p class="text-white/60 text-xs mb-2">🎤 人声偏好</p>
              <div class="flex flex-wrap gap-2">
                <button v-for="opt in VOCAL_OPTIONS" :key="opt.value" @click="togglePreference('vocals', opt.value)" :class="['px-3 py-1.5 rounded-lg text-xs transition-all', preferences.vocals.includes(opt.value) ? 'bg-orange-600 text-white' : 'bg-white/5 text-white/50']">
                  {{ opt.icon }} {{ opt.label }}
                </button>
              </div>
            </div>

            <!-- 喜欢的歌手 -->
            <div>
              <p class="text-white/60 text-xs mb-2">❤️ 喜欢的歌手</p>
              <div class="flex flex-wrap gap-2 mb-2">
                <span v-for="artist in preferences.favoriteArtists" :key="artist" class="px-2.5 py-1 rounded-lg bg-pink-500/20 text-pink-300 text-xs flex items-center gap-1.5">
                  {{ artist }}
                  <button @click="removeFavoriteArtist(artist)" class="text-pink-300/60 hover:text-pink-300">×</button>
                </span>
                <span v-if="preferences.favoriteArtists.length === 0" class="text-white/30 text-xs">暂无</span>
              </div>
              <div class="flex gap-2">
                <input v-model="newFavoriteArtist" type="text" placeholder="添加歌手" class="flex-1 h-9 px-3 rounded-lg bg-white/5 text-white text-xs placeholder-white/30 outline-none border border-white/10 focus:border-pink-500/50" @keyup.enter="addFavoriteArtist"/>
                <button @click="addFavoriteArtist" class="w-9 h-9 rounded-lg bg-pink-600 text-white flex items-center justify-center">+</button>
              </div>
            </div>

            <!-- 不喜欢的歌手 -->
            <div>
              <p class="text-white/60 text-xs mb-2">💔 不喜欢的歌手</p>
              <div class="flex flex-wrap gap-2 mb-2">
                <span v-for="artist in preferences.dislikedArtists" :key="artist" class="px-2.5 py-1 rounded-lg bg-red-500/20 text-red-300 text-xs flex items-center gap-1.5">
                  {{ artist }}
                  <button @click="removeDislikedArtist(artist)" class="text-red-300/60 hover:text-red-300">×</button>
                </span>
                <span v-if="preferences.dislikedArtists.length === 0" class="text-white/30 text-xs">暂无</span>
              </div>
              <div class="flex gap-2">
                <input v-model="newDislikedArtist" type="text" placeholder="添加歌手" class="flex-1 h-9 px-3 rounded-lg bg-white/5 text-white text-xs placeholder-white/30 outline-none border border-white/10 focus:border-red-500/50" @keyup.enter="addDislikedArtist"/>
                <button @click="addDislikedArtist" class="w-9 h-9 rounded-lg bg-red-600 text-white flex items-center justify-center">+</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 歌单选择弹窗 -->
  </div>
</template>

<style scoped>
.slide-enter-active,
.slide-leave-active {
  transition: all 0.2s ease;
}
.slide-enter-from,
.slide-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s ease;
}
.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translateY(100%);
}

.fade-enter-active,
.fade-leave-active {
  transition: all 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, -20px);
}

.safe-area-bottom {
  padding-bottom: env(safe-area-inset-bottom, 0px);
}

::-webkit-scrollbar {
  width: 4px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
}
</style>
