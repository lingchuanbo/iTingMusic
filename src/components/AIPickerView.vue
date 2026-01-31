<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { usePlayerStore } from '@/store/player'
import { usePlaylistStore } from '@/store/playlist'
import { searchResultToTrack } from '@/services/source/OnlineApiSource'
import PlaylistPickerDialog from '@/components/common/PlaylistPickerDialog.vue'
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
import { soulService, type SoulDimension, type SoulSession } from '@/services/SoulService'
import RandomListenView from './RandomListenView.vue'

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
const isMultiSelectMode = ref(false)
const longPressTimer = ref<any>(null)
const preferences = ref<AIPreferences>(loadPreferences())
const showSoulDashboard = ref(false)
const soulDimensions = ref<SoulDimension>(soulService.getDimensions())
const soulHistory = ref<SoulSession[]>(soulService.getHistory())
const showRandomListenView = ref(false)
const newFavoriteArtist = ref('')
const newDislikedArtist = ref('')

// 暴露状态
defineExpose({
  showRandomListenView
})

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
  () => thinkingPhase.value === 'confirming' && recommendations.value.length > 0 && !searching.value && isMultiSelectMode.value
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
  isMultiSelectMode.value = false
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
    '<span class="text-purple-300 font-serif italic">$1</span>'
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
      label: '工作/专注',
      prompt: '推荐适合专注工作时听的音乐，要能提升效率但不会分心，给我一些惊喜',
      gradient: 'from-blue-500 to-indigo-500'
    },
    { iconType: 'run', label: '运动', prompt: '推荐适合运动健身时听的歌，节奏要带劲，但不要总是那几首老歌', gradient: 'from-orange-500 to-red-500' },
    { iconType: 'moon', label: '深夜', prompt: '推荐适合深夜独处时听的音乐，要有氛围感，挖掘一些小众但好听的', gradient: 'from-indigo-500 to-purple-500' },
    { iconType: 'car', label: '驾驶', prompt: '推荐适合开车兜风时听的歌，要有公路感和自由感，给我一些新鲜的选择', gradient: 'from-cyan-500 to-blue-500' },
    { iconType: 'coffee', label: '咖啡时光', prompt: '推荐适合在咖啡厅听的音乐，要有格调但不俗套，发现一些宝藏歌曲', gradient: 'from-amber-500 to-orange-500' }
  ]
  const rolePrompts: Record<string, QuickPrompt[]> = {
    rocker: [
      { iconType: 'guitar', label: '经典摇滚', prompt: '推荐经典摇滚乐队的歌，但不要只推荐最热门的那几首，挖掘一些被低估的好歌', gradient: 'from-red-500 to-orange-500' },
      { iconType: 'fire', label: '重金属', prompt: '来点重金属音乐，要够硬够燃，给我一些新鲜的选择', gradient: 'from-zinc-500 to-slate-600' },
      { iconType: 'bolt', label: '朋克', prompt: '推荐朋克摇滚，要有态度有能量，不要总是那几首', gradient: 'from-yellow-500 to-lime-500' },
      { iconType: 'spark', label: '另类摇滚', prompt: '推荐另类摇滚音乐，要有个性，发现一些宝藏乐队', gradient: 'from-purple-500 to-pink-500' }
    ],
    classical: [
      { iconType: 'piano', label: '钢琴曲', prompt: '推荐优美的钢琴曲，不要只推荐卡农和梦中的婚礼，给我一些新鲜的', gradient: 'from-slate-400 to-slate-600' },
      { iconType: 'music', label: '交响乐', prompt: '推荐著名的交响乐，但要有新意，不要总是那几首', gradient: 'from-amber-500 to-yellow-500' },
      { iconType: 'film', label: '原声带', prompt: '推荐经典电影配乐，挖掘一些被低估的好作品', gradient: 'from-rose-500 to-pink-500' },
      { iconType: 'moon', label: '夜曲', prompt: '推荐浪漫的夜曲，要有氛围感，给我一些惊喜', gradient: 'from-indigo-500 to-purple-500' }
    ],
    hipster: [
      { iconType: 'fire', label: '流行趋势', prompt: '推荐最近最火的歌，但要有品味，不要只推荐抖音神曲', gradient: 'from-red-500 to-orange-500' },
      { iconType: 'mic', label: '说唱', prompt: '推荐好听的说唱，要有态度有内容，发现一些宝藏rapper', gradient: 'from-purple-500 to-violet-500' },
      { iconType: 'wave', label: '电子', prompt: '推荐好听的电子音乐，要有质感，不要太商业化的', gradient: 'from-cyan-500 to-blue-500' },
      { iconType: 'heart', label: 'R&B', prompt: '推荐好听的R&B，要有感觉，挖掘一些小众但好听的', gradient: 'from-pink-500 to-rose-500' }
    ],
    folk: [
      { iconType: 'guitar', label: '民谣', prompt: '推荐好听的华语民谣，不要只推荐那几个大众歌手，发现一些独立音乐人', gradient: 'from-amber-500 to-yellow-500' },
      { iconType: 'leaf', label: '独立音乐', prompt: '推荐小众独立音乐，要有个性有态度，给我一些惊喜', gradient: 'from-teal-500 to-cyan-500' },
      { iconType: 'coffee', label: '不插电', prompt: '推荐适合咖啡厅的音乐，要有格调，不要太俗套', gradient: 'from-stone-500 to-zinc-500' },
      { iconType: 'book', label: '文艺', prompt: '推荐文艺范的歌曲，要有深度有内涵，发现一些宝藏', gradient: 'from-violet-500 to-purple-500' }
    ],
    retro: [
      { iconType: 'radio', label: '90年代', prompt: '推荐90年代经典老歌，但不要只推荐最热门的，挖掘一些被遗忘的好歌', gradient: 'from-amber-500 to-orange-500' },
      { iconType: 'music', label: '粤语金曲', prompt: '推荐粤语经典金曲，不要只推荐四大天王，发现一些被低估的好歌', gradient: 'from-red-500 to-rose-500' },
      { iconType: 'globe', label: '欧美经典', prompt: '推荐欧美经典老歌，要有品味，不要太大众化', gradient: 'from-blue-500 to-indigo-500' },
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
      { iconType: 'disco', label: '夜店', prompt: '推荐蹦迪神曲，要够嗨够带劲，发现一些新歌', gradient: 'from-purple-500 to-violet-500' },
      { iconType: 'fire', label: '躁动', prompt: '推荐超嗨的歌，要能让人嗨起来，不要太俗套', gradient: 'from-yellow-500 to-orange-500' }
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

// 单首播放
async function playSingleSong(song: any) {
  try {
    showToast(`正在为您寻找: ${song.title}...`)
    // 使用统一的精准匹配函数
    const match = await searchAndMatch(song.title, song.artist)
    if (match) {
      const track = searchResultToTrack(match)
      playerStore.addTrack(track)
      const idx = playerStore.playlist.findIndex(t => t.id === track.id)
      if (idx >= 0) {
        playerStore.playTrack(idx)
      }
      showToast(`正在播放: ${track.title}`)
      
      // 心灵维度进化：如果是在“随便听听”模式下播放，产生轻微共鸣影响
      if (aiReason.value.includes('感应')) {
        soulService.evolve({ resonance: 0.8 }, 0.02)
        soulDimensions.value = soulService.getDimensions()
      }
    } else {
      throw new Error('未找到该歌曲')
    }
  } catch (e: any) {
    showToast(e.message || '播放失败', 'error')
  }
}

// 处理歌曲点击
function handleSongClick(index: number) {
  if (isMultiSelectMode.value) {
    toggleSongSelection(index)
  } else {
    playSingleSong(recommendations.value[index])
  }
}

// 长按逻辑
function startLongPress(index: number) {
  if (isMultiSelectMode.value) return
  
  longPressTimer.value = setTimeout(() => {
    isMultiSelectMode.value = true
    // 激活多选时，默认也选中当前项
    recommendations.value[index].selected = true
    // 给一点触感反馈
    if ('vibrate' in navigator) navigator.vibrate(50)
    showToast('已开启多选模式')
  }, 600)
}

function clearLongPress() {
  if (longPressTimer.value) {
    clearTimeout(longPressTimer.value)
    longPressTimer.value = null
  }
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
    // 默认都不选中，直到进入多选模式
    recommendations.value = result.songs.map(s => ({ ...s, selected: false }))
    thinkingPhase.value = 'confirming'
    isMultiSelectMode.value = false
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

// 创建新歌单并添加歌曲
function handleCreatePlaylist() {
  const name = prompt('请输入歌单名称')
  if (!name || !name.trim()) return
  
  const newPlaylist = playlistStore.createPlaylist(name.trim())
  addToUserPlaylist(newPlaylist.id)
}

// 随便听听
async function triggerRandomListen() {
  showRandomListenView.value = true
}


function updateSoulDimension(key: keyof SoulDimension, value: number) {
  const feedback: Partial<SoulDimension> = { [key]: value }
  soulService.evolve(feedback, 0.2)
  soulDimensions.value = soulService.getDimensions()
  showToast('心灵维度已进化')
}

</script>

<template>
  <div class="flex-1 h-full overflow-hidden relative bg-[#050505] text-white font-sans selection:bg-purple-500/30">
    <!-- 背景氛围光效 (Vibrant Modern Edition) -->
    <div class="absolute inset-0 pointer-events-none overflow-hidden">
      <!-- Mesh Gradients -->
      <div class="absolute -top-[10%] -left-[10%] w-[80vh] h-[80vh] bg-cyan-500/10 blur-[120px] rounded-full mix-blend-screen animate-pulse-slow"></div>
      <div class="absolute top-[20%] -right-[10%] w-[70vh] h-[70vh] bg-fuchsia-600/15 blur-[100px] rounded-full mix-blend-screen animate-float"></div>
      <div class="absolute -bottom-[10%] left-[20%] w-[60vh] h-[60vh] bg-indigo-600/10 blur-[100px] rounded-full mix-blend-screen animate-pulse-slow"></div>
      
      <!-- Overlays -->
      <div class="absolute inset-0 bg-gradient-to-b from-[#08080a]/40 via-transparent to-[#050505] opacity-90"></div>
      <!-- 噪点纹理 -->
      <div class="absolute inset-0 bg-noise opacity-[0.04] mix-blend-overlay"></div>
    </div>

    <!-- Toast -->
    <Transition name="toast">
      <div v-if="toast.show" class="fixed top-12 left-1/2 -translate-x-1/2 z-[60] px-4 w-full max-w-sm">
        <div :class="[
          'flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl backdrop-blur-xl border border-white/10',
          toast.type === 'success' ? 'bg-emerald-500/10 text-emerald-200' : 'bg-red-500/10 text-red-200'
        ]">
           <div :class="['w-2 h-2 rounded-full shadow-[0_0_8px_currentColor]', toast.type === 'success' ? 'bg-emerald-400' : 'bg-red-400']"></div>
          <span class="text-xs font-medium tracking-wide">{{ toast.message }}</span>
        </div>
      </div>
    </Transition>

    <!-- 主滚动容器 -->
    <div class="relative z-10 h-full overflow-y-auto scrollbar-hide">
      
      <!-- 非沉浸模式 (首页) -->
      <Transition name="fade-up" mode="out-in">
        <div v-if="!isImmersive" class="min-h-full flex flex-col justify-center max-w-lg mx-auto px-6 py-12">
          
          <!-- 头部标题 (Modern Sans-serif) -->
          <div class="text-center mb-16 space-y-2">
             <div class="inline-block px-3 py-1 rounded-full bg-white/5 border border-white/10 backdrop-blur-md mb-6 animate-fade-in">
                <span class="text-[9px] uppercase tracking-[0.4em] text-white/50 font-black">Powered by AI</span>
             </div>
             <h1 class="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-white/80 to-white/40 tracking-tighter filter drop-shadow-2xl">
                探.索
             </h1>
             <p class="text-[10px] uppercase tracking-[0.5em] text-cyan-400/60 font-bold">Sonic Discovery Engine</p>
          </div>

          <!-- 搜索框区域 (Modern Glowing Pill) -->
          <div class="relative z-20 mb-20 group">
            <div class="absolute -inset-0.5 bg-gradient-to-r from-cyan-500 to-fuchsia-500 rounded-[28px] blur opacity-20 group-hover:opacity-40 transition duration-1000 group-hover:duration-200"></div>
            <div 
              class="relative flex items-center gap-3 p-2 pr-3 rounded-[26px] bg-black/40 border border-white/10 backdrop-blur-2xl transition-all duration-500 shadow-2xl"
            >
              <!-- 角色选择按钮 -->
              <button 
                @click="showRoleSelector = !showRoleSelector" 
                class="w-12 h-12 rounded-[22px] bg-gradient-to-br from-white/10 to-white/5 hover:from-white/20 hover:to-white/10 flex items-center justify-center text-xl transition-all active:scale-95 border border-white/10 shadow-lg"
                title="切换 AI 角色"
              >
                <svg class="w-6 h-6 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="currentRole.iconPath" />
                </svg>
              </button>

              <!-- 输入框 -->
              <div class="flex-1 relative h-12">
                <input
                  v-model="userInput"
                  type="text"
                  :placeholder="`向 ${currentRole.name} 寻求灵感...`"
                  class="w-full h-full bg-transparent text-white placeholder-white/30 outline-none text-base font-bold tracking-wide px-2"
                  @keyup.enter="getRecommendations"
                  :disabled="loading"
                  autocomplete="off"
                />
              </div>

              <!-- 操作按钮组 -->
              <div class="flex items-center gap-2">
                 <!-- 清除 -->
                 <Transition name="scale">
                   <button v-if="userInput" @click="userInput = ''" class="w-8 h-8 flex items-center justify-center rounded-full text-white/40 hover:bg-white/10 hover:text-white transition-all">
                      <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/></svg>
                   </button>
                 </Transition>
                 
                 <!-- 发送 -->
                 <button 
                  @click="getRecommendations" 
                  :disabled="!userInput.trim() || loading"
                  :class="[
                    'w-12 h-12 rounded-[20px] flex items-center justify-center transition-all duration-300 shadow-xl overflow-hidden relative group/btn',
                    userInput.trim() && !loading 
                      ? 'bg-white text-black hover:scale-105' 
                      : 'bg-white/5 text-white/20'
                  ]"
                 >
                   <div v-if="userInput.trim() && !loading" class="absolute inset-0 bg-gradient-to-tr from-cyan-400/20 to-fuchsia-400/20 opacity-0 group-hover/btn:opacity-100 transition-opacity"></div>
                   <svg v-if="!loading" class="w-5 h-5 relative z-10" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M13 5l7 7-7 7M5 5l7 7-7 7"/></svg>
                   <div v-else class="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                 </button>
              </div>
            </div>

            <!-- 角色选择下拉 (High-tech) -->
            <Transition name="fade-down">
              <div v-if="showRoleSelector" class="absolute top-full left-0 right-0 mt-4 p-5 rounded-[2.5rem] bg-black/80 backdrop-blur-3xl border border-white/10 shadow-[0_30px_60px_rgba(0,0,0,0.6)] z-30 ring-1 ring-white/5">
                <div class="flex items-center justify-between mb-6 px-2">
                   <span class="text-[10px] uppercase tracking-[0.5em] text-cyan-400 font-black">Choose Origin</span>
                </div>
                <div class="grid grid-cols-4 gap-4">
                  <button 
                    v-for="role in AI_ROLES" 
                    :key="role.id" 
                    @click="selectRole(role)" 
                    :class="[
                       'flex flex-col items-center gap-3 py-4 rounded-3xl transition-all duration-500 relative group/role',
                       currentRole.id === role.id ? 'bg-white/10' : 'hover:bg-white/5'
                    ]"
                  >
                    <div v-if="currentRole.id === role.id" class="absolute inset-0 bg-gradient-to-br from-cyan-500/10 to-transparent rounded-3xl"></div>
                    <div class="w-12 h-12 flex items-center justify-center relative z-10 p-3 rounded-2xl bg-white/5 border border-white/10 group-hover/role:scale-110 transition-transform">
                      <svg :class="['w-full h-full transition-colors', currentRole.id === role.id ? 'text-cyan-400' : 'text-white/30 group-hover/role:text-white/60']" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="role.iconPath" />
                      </svg>
                    </div>
                    <span :class="['text-[9px] font-black uppercase tracking-widest relative z-10', currentRole.id === role.id ? 'text-white' : 'text-white/30']">{{ role.name }}</span>
                  </button>
                </div>
              </div>
            </Transition>
          </div>

          <!-- 快捷提示 & 随便听听 (Modern Vibrant Tiles) -->
          <div class="px-2">
            <div class="flex items-center gap-4 mb-8">
               <span class="text-[10px] uppercase tracking-[0.4em] text-white/30 font-black">Interactive Modules</span>
               <div class="h-px bg-gradient-to-r from-white/10 to-transparent flex-1"></div>
            </div>
            
            <div class="grid grid-cols-2 gap-4">
              <!-- 随便听听 (Soul Sensor Tile) -->
              <button 
                @click="triggerRandomListen"
                class="group relative h-44 col-span-2 rounded-[2.5rem] bg-gradient-to-br from-indigo-600/20 to-fuchsia-600/20 border border-white/10 hover:border-white/20 transition-all duration-700 flex flex-col items-center justify-center p-6 overflow-hidden shadow-2xl hover:-translate-y-1"
              >
                 <!-- Soul Aura Animation -->
                 <div class="absolute inset-0 bg-gradient-to-tr from-cyan-500/10 via-fuchsia-500/10 to-indigo-500/10 opacity-30 group-hover:opacity-60 animate-pulse-slow"></div>
                 <div class="absolute -top-20 -right-20 w-64 h-64 bg-cyan-500/20 blur-[100px] rounded-full group-hover:bg-cyan-400/30 transition-colors"></div>
                 
                 <div class="relative z-10 flex flex-col items-center text-center space-y-4">
                    <div class="w-16 h-16 rounded-[2rem] bg-white/10 backdrop-blur-3xl border border-white/20 flex items-center justify-center shadow-2xl group-hover:scale-110 transition-transform duration-500">
                       <svg class="w-8 h-8 text-white group-hover:text-cyan-400 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                         <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                       </svg>
                    </div>
                    <div>
                       <h3 class="text-2xl font-black tracking-tighter text-white">随便听听</h3>
                       <p class="text-[10px] uppercase tracking-[0.4em] text-white/50 font-bold mt-1">Activate Soul Resonance</p>
                    </div>
                 </div>

                 <!-- Soul Stats Button -->
                 <div 
                   @click.stop="showSoulDashboard = true"
                   class="absolute bottom-4 right-6 px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 backdrop-blur-xl transition-all active:scale-95"
                 >
                   <span class="text-[9px] uppercase tracking-widest font-black text-cyan-400/80">Soul Dimension</span>
                 </div>
              </button>

              <button 
                v-for="item in quickPrompts" 
                :key="item.label" 
                @click="useQuickPrompt(item.prompt)" 
                class="group relative h-28 rounded-3xl bg-white/[0.03] border border-white/10 hover:bg-white/[0.08] transition-all duration-500 flex flex-col items-start p-5 overflow-hidden shadow-xl hover:shadow-2xl hover:-translate-y-1"
              >
                 <!-- Background Elements -->
                 <div class="absolute -right-4 -bottom-4 w-20 h-20 bg-gradient-to-br opacity-20 group-hover:opacity-40 transition-all duration-500 blur-2xl rounded-full" :class="item.gradient"></div>
                 <div class="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                 
                 <!-- Content -->
                 <div class="mb-auto p-2.5 rounded-2xl bg-white/5 border border-white/10 group-hover:scale-110 transition-transform duration-500 shadow-lg">
                    <svg v-if="item.iconType === 'leaf'" class="w-5 h-5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg>
                    <svg v-else-if="item.iconType === 'briefcase'" class="w-5 h-5 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>
                    <svg v-else-if="item.iconType === 'run'" class="w-5 h-5 text-orange-400" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                    <svg v-else-if="item.iconType === 'moon'" class="w-5 h-5 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>
                    <svg v-else-if="item.iconType === 'car'" class="w-5 h-5 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m4 4H4m0 0l4 4m-4-4l4-4"/></svg>
                    <svg v-else-if="item.iconType === 'coffee'" class="w-5 h-5 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 8h1a4 4 0 010 8h-1M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8zM6 1v3M10 1v3M14 1v3"/></svg>
                    <svg v-else class="w-5 h-5 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z"/></svg>
                 </div>
                 
                 <div class="mt-2">
                    <span class="text-xs font-black text-white/90 tracking-wider block">{{ item.label }}</span>
                    <span class="text-[9px] text-white/40 font-medium group-hover:text-white/60 transition-colors">Tap to explore</span>
                 </div>
              </button>
            </div>
          </div>
        </div>


      <!-- 沉浸模式 (处理中/结果) -->

      <div v-else class="min-h-full pb-40">
        
        <!-- 思考中 / 处理中 (High-tech) -->
        <div v-if="loading || thinkingPhase === 'adding'" class="flex flex-col items-center justify-center pt-32 px-6">
           <!-- 角色 & 状态 -->
           <div class="relative w-28 h-28 mb-12">
              <div class="absolute inset-0 bg-cyan-500/10 rounded-full animate-ping opacity-20"></div>
              <div class="absolute inset-0 border-2 border-dashed border-white/5 rounded-full animate-spin-slow"></div>
              <div class="absolute inset-4 border border-white/10 rounded-full"></div>
              <div class="absolute inset-0 flex items-center justify-center">
                 <svg class="w-10 h-10 text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,0.5)] animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="currentRole.iconPath" />
                 </svg>
              </div>
              <!-- Orbiting Dots -->
              <div class="absolute inset-0 animate-spin" style="animation-duration: 3s">
                 <div class="absolute top-0 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-fuchsia-500 rounded-full shadow-[0_0_10px_#d946ef]"></div>
              </div>
           </div>

           <transition name="fade" mode="out-in">
             <div v-if="thinkingPhase === 'adding'" key="adding" class="w-full max-w-sm space-y-6">
                 <div class="text-center">
                    <h3 class="text-2xl font-black tracking-tighter mb-1">正在同步音乐库</h3>
                    <p class="text-[10px] uppercase tracking-[0.3em] text-white/30">{{ addingProgress.currentSong }}</p>
                 </div>
                 <div class="relative h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div class="absolute inset-y-0 left-0 bg-gradient-to-r from-cyan-400 to-fuchsia-400 shadow-[0_0_15px_rgba(34,211,238,0.5)] transition-all duration-300" :style="{ width: `${(addingProgress.current / addingProgress.total) * 100}%` }"></div>
                 </div>
                 <div class="flex justify-between items-center">
                    <span class="text-[9px] font-black uppercase tracking-widest text-cyan-400/60">Processing</span>
                    <span class="text-xs font-mono text-white/40">{{ addingProgress.current }} / {{ addingProgress.total }}</span>
                 </div>
             </div>

             <div v-else key="thinking" class="text-center space-y-4">
               <h3 class="text-2xl font-black tracking-tighter">正在编排曲目...</h3>
               <div class="flex justify-center gap-1.5 py-4">
                  <div class="w-1 h-3 bg-cyan-400 animate-bounce" style="animation-delay: 0s"></div>
                  <div class="w-1 h-3 bg-cyan-400 animate-bounce" style="animation-delay: 0.1s"></div>
                  <div class="w-1 h-1 bg-cyan-400 animate-bounce" style="animation-delay: 0.2s"></div>
                  <div class="w-1 h-1 bg-cyan-400 animate-bounce" style="animation-delay: 0.3s"></div>
               </div>
               <p class="text-white/40 text-[10px] uppercase tracking-[0.3em] font-black max-w-[240px] mx-auto leading-relaxed border-t border-white/5 pt-6">
                 {{ thinkingText || 'Scanning Sonic Universe' }}
               </p>
             </div>
           </transition>
        </div>

        <!-- 推荐结果展示 (Contemporary Glass Cards) -->
        <Transition name="fade-up">
          <div v-if="thinkingPhase === 'confirming' && recommendations.length > 0 && !searching" class="px-5 pt-12">
            
            <!-- 结果头部 -->
            <div class="flex items-end justify-between mb-10">
               <div>
                  <div class="flex items-center gap-3 mb-2">
                    <p class="text-[10px] uppercase tracking-[0.5em] text-fuchsia-400 font-black">Curated for you</p>
                    <button @click="refreshRecommendations" class="w-6 h-6 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 text-white/40 hover:text-cyan-400 transition-all active:rotate-180 duration-500">
                      <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                    </button>
                  </div>
                  <h2 class="text-4xl font-black tracking-tighter">{{ currentRole.name }} 的推荐</h2>
               </div>
               <button @click="exitImmersive" class="w-10 h-10 flex items-center justify-center rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all">
                 <svg class="w-5 h-5 text-white/40" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/></svg>
               </button>
            </div>

            <!-- AI 理由 (Modern Blockquote) -->
            <div v-if="formattedReason.length > 0" class="mb-12">
               <div class="relative p-6 rounded-[2rem] bg-gradient-to-br from-white/10 to-transparent border border-white/10 backdrop-blur-3xl overflow-hidden shadow-2xl">
                  <div class="absolute -top-10 -right-10 w-32 h-32 bg-cyan-500/10 blur-3xl rounded-full"></div>
                  <div class="space-y-4 relative z-10 font-medium text-lg tracking-tight text-white/90 leading-snug italic">
                     <p v-for="(line, idx) in formattedReason" :key="idx" v-html="parseHighlight(line)"></p>
                  </div>
               </div>
            </div>

             <!-- 歌曲列表 (Modern Grid of Cards) -->
            <div class="grid grid-cols-1 gap-3">
               <div 
                v-for="(song, idx) in recommendations" 
                :key="idx" 
                @click="handleSongClick(idx)"
                @touchstart="startLongPress(idx)"
                @touchend="clearLongPress"
                @touchmove="clearLongPress"
                @mousedown="startLongPress(idx)"
                @mouseup="clearLongPress"
                @mouseleave="clearLongPress"
                :class="[
                  'group p-4 rounded-3xl transition-all duration-500 relative overflow-hidden flex items-center gap-4',
                  song.selected !== false 
                    ? 'bg-white/10 border border-white/20 shadow-xl' 
                    : isMultiSelectMode ? 'bg-transparent border border-white/5 opacity-40 grayscale' : 'bg-white/5 border border-white/10'
                ]"
               >
                 <!-- Background Glow -->
                 <div v-if="!isMultiSelectMode || song.selected !== false" class="absolute inset-0 bg-gradient-to-r from-cyan-500/5 to-fuchsia-500/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                 
                 <!-- Cover/Index -->
                 <div class="relative w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center overflow-hidden shrink-0 transition-transform group-hover:scale-105">
                    <span v-if="!isMultiSelectMode || song.selected === false" class="text-xs font-black text-white/20">{{ idx + 1 }}</span>
                    <div v-else class="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-cyan-400 to-fuchsia-400 shadow-inner overflow-hidden">
                       <svg class="w-5 h-5 text-black" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    </div>
                 </div>

                 <!-- Info -->
                 <div class="flex-1 min-w-0">
                    <h4 :class="['text-base font-black tracking-tight truncate transition-colors', isMultiSelectMode && song.selected === false ? 'text-white/60' : 'text-white']">{{ song.title }}</h4>
                    <p class="text-[10px] uppercase tracking-[0.2em] text-white/40 font-bold truncate mt-0.5">{{ song.artist }}</p>
                 </div>

                 <!-- Selection Dot (Only in Multi-select Mode) -->
                 <Transition name="scale">
                   <div v-if="isMultiSelectMode" class="w-5 h-5 rounded-full border-2 transition-all duration-500 flex items-center justify-center shrink-0" :class="song.selected !== false ? 'border-cyan-400 bg-cyan-400' : 'border-white/10'">
                      <svg v-if="song.selected !== false" class="w-3 h-3 text-black" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4"><path d="M5 13l4 4L19 7"/></svg>
                   </div>
                 </Transition>
               </div>
            </div>

          </div>
        </Transition>

      </div>
    </Transition>
    </div>

    <!-- 底部悬浮操作栏 (Modern Pill Dock) -->
    <Transition name="slide-up">
      <div v-if="isMultiSelectMode" class="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm px-4">
        <div class="bg-[#121214]/60 backdrop-blur-3xl border border-white/10 rounded-[2.5rem] p-2 shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex items-center justify-between gap-2 ring-1 ring-white/5">
           <div class="flex items-center gap-3 pl-6 pr-4">
              <div class="flex flex-col">
                <span class="text-[10px] uppercase tracking-widest text-white/40 font-black">Selected</span>
                <span class="text-xs font-black text-cyan-400">{{ selectedCount }} <span class="text-white/20">/</span> {{ recommendations.length }}</span>
              </div>
           </div>
           
           <div class="flex items-center gap-2 pr-1">
              <button @click="isMultiSelectMode = false" class="h-12 px-4 rounded-[1.8rem] bg-white/5 hover:bg-white/10 text-[9px] uppercase font-black tracking-widest text-white/40 hover:text-white transition-all">
                Cancel
              </button>
              <button @click="toggleSelectAll" class="h-12 px-4 rounded-[1.8rem] bg-white/5 hover:bg-white/10 text-[9px] uppercase font-black tracking-widest text-white/40 hover:text-white transition-all">
                {{ selectedCount === recommendations.length ? 'None' : 'All' }}
              </button>
              <button @click="showPlayModeModal = true" :disabled="selectedCount === 0" class="h-12 px-8 rounded-[1.8rem] bg-white text-black text-[10px] font-black uppercase tracking-[0.2em] hover:scale-105 active:scale-95 transition-all shadow-[0_0_20px_rgba(255,255,255,0.3)] disabled:opacity-30 disabled:scale-100 disabled:shadow-none">
                Play
              </button>
           </div>
        </div>
      </div>
    </Transition>

    <!-- 弹窗部分 (PlayStyle / Playlist / Preferences) 保持功能但优化样式 -->
    <!-- 播放模式选择弹窗 -->
    <Transition name="fade">
      <div v-if="showPlayModeModal" class="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 backdrop-blur-sm" @click.self="showPlayModeModal = false">
        <div class="w-full max-w-md bg-[#121214] border-t border-white/10 rounded-t-3xl overflow-hidden p-6 pb-12 animate-slide-up-modal">
          <div class="flex items-center justify-between mb-8">
            <h3 class="text-xl font-serif italic">播放模式</h3>
            <button @click="showPlayModeModal = false" class="text-white/30 hover:text-white"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M6 18L18 6M6 6l12 12"/></svg></button>
          </div>
          <div class="space-y-4">
            <button @click="showPlayModeModal = false; playSelectedSongs(false)" class="w-full p-4 flex items-center gap-4 rounded-2xl bg-white/5 hover:bg-white/10 transition-colors group">
              <div class="w-12 h-12 rounded-full border border-white/10 flex items-center justify-center group-hover:border-white/30 group-hover:text-purple-400 text-white/50 transition-colors">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 4v16m8-8H4"/></svg>
              </div>
              <div class="text-left">
                <div class="text-sm font-bold uppercase tracking-wider text-white">添加到队列</div>
                <div class="text-[10px] text-white/40 mt-0.5">添加到当前播放列表末尾</div>
              </div>
            </button>
            <button @click="showPlayModeModal = false; playSelectedSongs(true)" class="w-full p-4 flex items-center gap-4 rounded-2xl bg-white/5 hover:bg-white/10 transition-colors group">
              <div class="w-12 h-12 rounded-full border border-white/10 flex items-center justify-center group-hover:border-white/30 group-hover:text-pink-400 text-white/50 transition-colors">
                <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
              </div>
              <div class="text-left">
                <div class="text-sm font-bold uppercase tracking-wider text-white">立即播放</div>
                <div class="text-[10px] text-white/40 mt-0.5">清空队列并重新开始</div>
              </div>
            </button>
             <button @click="showPlayModeModal = false; showPlaylistModal=true" class="w-full p-4 flex items-center gap-4 rounded-2xl bg-white/5 hover:bg-white/10 transition-colors group">
              <div class="w-12 h-12 rounded-full border border-white/10 flex items-center justify-center group-hover:border-white/30 group-hover:text-blue-400 text-white/50 transition-colors">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z"/></svg>
              </div>
              <div class="text-left">
                <div class="text-sm font-bold uppercase tracking-wider text-white">保存到歌单</div>
                <div class="text-[10px] text-white/40 mt-0.5">收藏以供随时聆听</div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <PlaylistPickerDialog
      :visible="showPlaylistModal"
      @close="showPlaylistModal = false"
      @select="addToUserPlaylist"
      @create="handleCreatePlaylist"
    />

    <!-- Soul Dashboard Modal (The Musical Psyche) -->
    <Transition name="fade">
      <div v-if="showSoulDashboard" class="fixed inset-0 z-[80] bg-black/80 backdrop-blur-2xl flex items-center justify-center p-4" @click.self="showSoulDashboard = false">
        <div class="w-full max-w-2xl bg-[#0a0a0c] border border-white/10 rounded-[3rem] shadow-[0_50px_100px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col max-h-[85vh] animate-slide-up-modal">
           <!-- Header -->
           <div class="p-8 pb-4 flex items-center justify-between">
              <div>
                 <h3 class="text-3xl font-black tracking-tighter text-white">心灵维度</h3>
                 <p class="text-[10px] uppercase tracking-[0.4em] text-cyan-400 font-bold mt-1">Your Musical Psyche Portfolio</p>
              </div>
              <button @click="showSoulDashboard = false" class="w-12 h-12 flex items-center justify-center rounded-2xl bg-white/5 hover:bg-white/10 transition-colors">
                <svg class="w-6 h-6 text-white/40" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
           </div>

           <!-- Content -->
           <div class="flex-1 overflow-y-auto p-8 pt-0 space-y-12 scrollbar-hide">
              <!-- Dimensions Grid -->
              <div class="grid grid-cols-2 gap-8 pt-4">
                 <div v-for="(val, key) in soulDimensions" :key="key" class="space-y-4">
                    <div class="flex justify-between items-end">
                       <span class="text-[10px] uppercase tracking-[0.2em] font-black text-white/30">{{ key }}</span>
                       <span class="text-xs font-mono text-cyan-400">{{ Math.round(val * 100) }}%</span>
                    </div>
                    <div class="relative h-2 bg-white/5 rounded-full overflow-hidden group/bar">
                       <div 
                         class="absolute inset-y-0 left-0 bg-gradient-to-r from-cyan-500 to-fuchsia-500 transition-all duration-1000 ease-out shadow-[0_0_10px_rgba(34,211,238,0.3)]" 
                         :style="{ width: `${val * 100}%` }"
                       ></div>
                       <!-- Slider Overlay for Manual Adjustment -->
                       <input 
                         type="range" min="0" max="1" step="0.01" 
                         :value="val" 
                         track-color="transparent"
                         @input="(e: any) => updateSoulDimension(key as any, parseFloat(e.target.value))"
                         class="absolute inset-0 opacity-0 cursor-pointer"
                       />
                    </div>
                    <p class="text-[9px] text-white/20 leading-relaxed italic">
                      {{ 
                        key === 'resonance' ? '高共振代表对熟悉感的依赖，低共振代表极强的探索欲' :
                        key === 'energy' ? '能量值反映你对节奏力度和生命力的渴求度' :
                        key === 'spectrum' ? '色谱决定了你在主流明亮与小众深邃间的摇摆' :
                        '深度衡量了你对音乐逻辑和织体复杂性的耐受力'
                      }}
                    </p>
                 </div>
              </div>

              <!-- History Log -->
              <div class="space-y-6">
                 <div class="flex items-center gap-4">
                    <span class="text-[10px] uppercase tracking-[0.4em] text-white/30 font-black">Resonance History</span>
                    <div class="h-px bg-white/10 flex-1"></div>
                 </div>

                 <div class="space-y-3">
                    <div v-if="soulHistory.length === 0" class="py-12 text-center border-2 border-dashed border-white/5 rounded-3xl group">
                       <p class="text-xs text-white/20 font-medium group-hover:text-white/40 transition-colors">尚未产生心灵契约，点击「随便听听」开启记录</p>
                    </div>
                    <div v-for="session in soulHistory" :key="session.id" class="p-5 rounded-3xl bg-white/[0.03] border border-white/5 flex items-center justify-between group hover:bg-white/[0.05] transition-all">
                       <div class="flex items-center gap-4">
                          <div class="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-white/10 flex items-center justify-center text-xs font-black text-indigo-400 group-hover:scale-110 transition-transform">
                             {{ session.resonanceScore }}
                          </div>
                          <div>
                             <h4 class="text-sm font-bold text-white/80 group-hover:text-white transition-colors">{{ session.moodTag }}</h4>
                             <p class="text-[9px] text-white/20 uppercase tracking-widest mt-1">{{ new Date(session.timestamp).toLocaleDateString() }} · {{ session.songs.length }} Tracks</p>
                          </div>
                       </div>
                       <svg class="w-5 h-5 text-white/10 group-hover:text-cyan-400 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
                    </div>
                 </div>
              </div>
           </div>

           <!-- Footer -->
           <div class="p-8 pt-4 border-t border-white/5 bg-black/20 text-center">
              <p class="text-[9px] text-white/30 uppercase tracking-[0.2em]">维度会根据你的选择和喜好自动进化 · AI 心理侧写引擎</p>
           </div>
        </div>
      </div>
    </Transition>

    <PlaylistPickerDialog
      :visible="showPlaylistModal"
      @close="showPlaylistModal = false"
      @select="addToUserPlaylist"
      @create="handleCreatePlaylist"
    />

    <!-- Random Listen View (Independent Sandbox) -->
    <RandomListenView 
      v-if="showRandomListenView" 
      @close="showRandomListenView = false" 
    />


    <!-- Preferences Modal (Simplified) -->
    <!-- 保持原有逻辑，仅调整容器样式 -->
    <Transition name="fade">
      <div v-if="showPreferences" class="fixed inset-0 z-[70] bg-black/80 backdrop-blur-md" @click.self="showPreferences = false">
        <div class="absolute inset-y-0 right-0 w-full max-w-sm bg-[#121214] border-l border-white/10 shadow-2xl p-6 overflow-y-auto animate-slide-left">
           <div class="flex items-center justify-between mb-10">
              <h3 class="text-2xl font-serif italic">偏好设置</h3>
              <button @click="showPreferences = false" class="text-white/30 hover:text-white"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M6 18L18 6M6 6l12 12"/></svg></button>
           </div>
           
           <div class="space-y-8">
             <!-- 语言 -->
            <div>
              <p class="text-[10px] uppercase tracking-[0.2em] text-white/40 mb-4 font-bold">语言偏好</p>
              <div class="flex flex-wrap gap-2">
                <button v-for="opt in LANGUAGE_OPTIONS" :key="opt.value" @click="togglePreference('languages', opt.value)" :class="['px-4 py-2 rounded-xl text-xs font-medium transition-all border', preferences.languages.includes(opt.value) ? 'bg-white text-black border-white' : 'bg-transparent text-white/60 border-white/10 hover:border-white/30']">
                  {{ opt.label }}
                </button>
              </div>
            </div>

             <!-- 年代 -->
             <div>
              <p class="text-[10px] uppercase tracking-[0.2em] text-white/40 mb-4 font-bold">年代偏好</p>
              <div class="flex flex-wrap gap-2">
                <button v-for="opt in ERA_OPTIONS" :key="opt.value" @click="togglePreference('eras', opt.value)" :class="['px-4 py-2 rounded-xl text-xs font-medium transition-all border', preferences.eras.includes(opt.value) ? 'bg-white text-black border-white' : 'bg-transparent text-white/60 border-white/10 hover:border-white/30']">
                  {{ opt.label }}
                </button>
              </div>
            </div>

            <!-- 更多偏好区块可继续按此风格复用... -->
             <!-- 快速实现的占位，确保逻辑可用 -->
             <div>
              <p class="text-[10px] uppercase tracking-[0.2em] text-white/40 mb-4 font-bold">情绪偏好</p>
               <div class="flex flex-wrap gap-2">
                <button v-for="opt in MOOD_OPTIONS" :key="opt.value" @click="togglePreference('moods', opt.value)" :class="['px-4 py-2 rounded-xl text-xs font-medium transition-all border', preferences.moods.includes(opt.value) ? 'bg-white text-black border-white' : 'bg-transparent text-white/60 border-white/10 hover:border-white/30']">
                  {{ opt.label }}
                </button>
               </div>
             </div>

             <!-- Vocals -->
             <div>
              <p class="text-[10px] uppercase tracking-[0.2em] text-white/40 mb-4 font-bold">人声偏好</p>
               <div class="flex flex-wrap gap-2">
                <button v-for="opt in VOCAL_OPTIONS" :key="opt.value" @click="togglePreference('vocals', opt.value)" :class="['px-4 py-2 rounded-xl text-xs font-medium transition-all border', preferences.vocals.includes(opt.value) ? 'bg-orange-500 text-white border-orange-500' : 'bg-transparent text-white/60 border-white/10 hover:border-white/30']">
                  {{ opt.label }}
                </button>
               </div>
             </div>

             <div>
                <p class="text-[10px] uppercase tracking-[0.2em] text-white/40 mb-4 font-bold">喜欢的艺人</p>
                <!-- 简化版输入 -->
                 <div class="flex gap-2 mb-3">
                   <input v-model="newFavoriteArtist" type="text" placeholder="添加艺人" class="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 h-10 text-sm outline-none focus:border-white/30" @keyup.enter="addFavoriteArtist"/>
                   <button @click="addFavoriteArtist" class="w-10 h-10 rounded-xl bg-white/10 hover:bg-white hover:text-black flex items-center justify-center transition-colors">+</button>
                 </div>
                 <div class="flex flex-wrap gap-2">
                    <span v-for="artist in preferences.favoriteArtists" :key="artist" class="px-3 py-1 bg-purple-500/20 text-purple-200 rounded-lg text-xs flex items-center gap-2">
                       {{ artist }} <button @click="removeFavoriteArtist(artist)" class="hover:text-white">x</button>
                    </span>
                 </div>
             </div>
             <!-- Disliked Artists -->
             <div>
                <p class="text-[10px] uppercase tracking-[0.2em] text-white/40 mb-4 font-bold">不喜欢的艺人</p>
                 <div class="flex gap-2 mb-3">
                   <input v-model="newDislikedArtist" type="text" placeholder="屏蔽艺人" class="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 h-10 text-sm outline-none focus:border-white/30" @keyup.enter="addDislikedArtist"/>
                   <button @click="addDislikedArtist" class="w-10 h-10 rounded-xl bg-white/10 hover:bg-white hover:text-black flex items-center justify-center transition-colors">+</button>
                 </div>
                 <div class="flex flex-wrap gap-2">
                    <span v-for="artist in preferences.dislikedArtists" :key="artist" class="px-3 py-1 bg-red-500/20 text-red-200 rounded-lg text-xs flex items-center gap-2">
                       {{ artist }} <button @click="removeDislikedArtist(artist)" class="hover:text-white">x</button>
                    </span>
                 </div>
             </div>
           </div>
        </div>
      </div>
    </Transition>

  </div>
</template>

<style scoped>
.font-serif {
  font-family: "New York", "Times New Roman", serif;
}

.scrollbar-hide::-webkit-scrollbar {
    display: none;
}
.scrollbar-hide {
    -ms-overflow-style: none;
    scrollbar-width: none;
}

.animate-pulse-slow {
  animation: pulse 8s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.3; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(1.1); }
}

.bg-noise {
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
}

/* Transitions */
.fade-up-enter-active,
.fade-up-leave-active {
  transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}
.fade-up-enter-from {
  opacity: 0;
  transform: translateY(20px);
}
.fade-up-leave-to {
  opacity: 0;
  transform: translateY(-20px);
}

.scale-enter-active,
.scale-leave-active {
  transition: all 0.3s ease;
}
.scale-enter-from,
.scale-leave-to {
  opacity: 0;
  transform: scale(0.8);
}

.fade-down-enter-active,
.fade-down-leave-active {
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.fade-down-enter-from,
.fade-down-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}
.slide-up-enter-from,
.slide-up-leave-to {
  transform: translate(-50%, 100%);
}

.animate-slide-up-modal {
    animation: slideUpModal 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes slideUpModal {
    from { transform: translateY(100%); }
    to { transform: translateY(0); }
}

.animate-slide-left {
    animation: slideLeft 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes slideLeft {
    from { transform: translateX(100%); }
    to { transform: translateX(0); }
}

.animate-bounce-slow {
   animation: bounce 3s infinite;
}
@keyframes bounce {
  0%, 100% {
    transform: translateY(-5%);
    animation-timing-function: cubic-bezier(0.8, 0, 1, 1);
  }
  50% {
    transform: translateY(0);
    animation-timing-function: cubic-bezier(0, 0, 0.2, 1);
  }
}

.animate-float {
  animation: float 10s ease-in-out infinite;
}
@keyframes float {
  0%, 100% { transform: translate(0, 0) scale(1); }
  33% { transform: translate(2%, 4%) scale(1.05); }
  66% { transform: translate(-2%, 2%) scale(0.95); }
}

.animate-spin-slow {
  animation: spin 12s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.animate-fade-in {
  animation: fadeIn 1s ease-out forwards;
}
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes pulse-slow {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 0.6; }
}

.animate-pulse-slow {
  animation: pulse-slow 8s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes slide-up-modal {
  from { transform: translateY(100px); opacity: 0; filter: blur(10px); }
  to { transform: translateY(0); opacity: 1; filter: blur(0); }
}

.animate-slide-up-modal {
  animation: slide-up-modal 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

/* Scrollbar Hide */
.scrollbar-hide::-webkit-scrollbar {
  display: none;
}
.scrollbar-hide {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
