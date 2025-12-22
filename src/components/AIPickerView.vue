<script setup lang="ts">
import { ref, computed } from 'vue'
import { usePlayerStore } from '@/store/player'
import { usePlaylistStore } from '@/store/playlist'
import { searchSongs, searchResultToTrack, type MusicSource } from '@/services/source/OnlineApiSource'
import { getAIRecommendations, isAIConfigured, AI_ROLES, getCurrentRole, setCurrentRole, loadPreferences, savePreferences, LANGUAGE_OPTIONS, ERA_OPTIONS, MOOD_OPTIONS, VOCAL_OPTIONS, type AIRole, type AIPreferences } from '@/services/ai/AIService'
import { trackStorage } from '@/services/TrackStorage'

const playerStore = usePlayerStore()
const playlistStore = usePlaylistStore()

const showPlaylistModal = ref(false)
const selectedSongForPlaylist = ref<any>(null)
const isAddAllMode = ref(false)

// 打开歌单选择弹窗
function openPlaylistModal() {
  isAddAllMode.value = true
  showPlaylistModal.value = true
}

// 添加选中的歌曲到指定歌单
async function addToUserPlaylist(playlistId: string) {
  const selectedSongs = recommendations.value.filter(s => s.selected !== false)
  if (selectedSongs.length === 0) {
    showPlaylistModal.value = false
    return
  }
  
  // 获取歌单名称
  const playlist = playlistStore.playlists.find(p => p.id === playlistId)
  const playlistName = playlist?.name || '歌单'
  
  showPlaylistModal.value = false
  searching.value = true
  thinkingPhase.value = 'adding'
  addingProgress.value = { current: 0, total: selectedSongs.length, currentSong: '', addedCount: 0 }
  
  const sources: MusicSource[] = ['netease', 'kuwo', 'kugou']
  
  for (let i = 0; i < selectedSongs.length; i++) {
    const song = selectedSongs[i]
    addingProgress.value.current = i + 1
    addingProgress.value.currentSong = `${song.title} - ${song.artist}`
    
    // 如果还没搜索过，先搜索
    if (!song.searchResult) {
      for (const source of sources) {
        try {
          const results = await searchSongs(source, `${song.title} ${song.artist}`, 5)
          const match = results.find(r => r.name.toLowerCase().includes(song.title.toLowerCase()) || song.title.toLowerCase().includes(r.name.toLowerCase())) || results[0]
          if (match) { 
            song.searchResult = match
            break 
          }
        } catch { continue }
      }
    }
    
    // 添加到歌单
    if (song.searchResult) {
      const track = searchResultToTrack(song.searchResult)
      playerStore.addTrack(track)
      trackStorage.saveTrack(track)
      playlistStore.addToPlaylist(playlistId, track.id)
      addingProgress.value.addedCount++
    }
  }
  
  // 显示提示
  const addedCount = addingProgress.value.addedCount
  if (addedCount > 0) {
    showToast(`📁 已添加 ${addedCount} 首歌曲到「${playlistName}」`)
  } else {
    showToast('未能找到可添加的歌曲', 'error')
  }
  
  // 返回到推荐确认状态
  searching.value = false
  thinkingPhase.value = 'confirming'
}

function _openPlaylistModal(song: any, addAll = false) {
  selectedSongForPlaylist.value = song
  isAddAllMode.value = addAll
  showPlaylistModal.value = true
}

function _addToUserPlaylist(playlistId: string) {
  if (isAddAllMode.value) {
    recommendations.value.forEach(song => {
      if (song.searchResult) {
        const track = searchResultToTrack(song.searchResult)
        playerStore.addTrack(track)
        trackStorage.saveTrack(track)
        playlistStore.addToPlaylist(playlistId, track.id)
      }
    })
  } else if (selectedSongForPlaylist.value?.searchResult) {
    const track = searchResultToTrack(selectedSongForPlaylist.value.searchResult)
    playerStore.addTrack(track)
    trackStorage.saveTrack(track)
    playlistStore.addToPlaylist(playlistId, track.id)
  }
  showPlaylistModal.value = false
}
// 保留引用避免编译警告
void _openPlaylistModal
void _addToUserPlaylist

// Toast 提示
const toast = ref({ show: false, message: '', type: 'success' as 'success' | 'error' })
function showToast(message: string, type: 'success' | 'error' = 'success') {
  toast.value = { show: true, message, type }
  setTimeout(() => { toast.value.show = false }, 3000)
}

const currentRole = ref<AIRole>(getCurrentRole())
const showRoleSelector = ref(false)
const preferences = ref<AIPreferences>(loadPreferences())
const showPreferences = ref(false)
const newFavoriteArtist = ref('')
const newDislikedArtist = ref('')

function selectRole(role: AIRole) {
  currentRole.value = role
  setCurrentRole(role.id)
  showRoleSelector.value = false
  recommendations.value = []
  thinkingText.value = ''
}

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

const userInput = ref('')
const loading = ref(false)
const searching = ref(false)
const error = ref('')
const aiReason = ref('')
const thinkingText = ref('')
const thinkingPhase = ref<'thinking' | 'confirming' | 'adding' | 'done'>('thinking')
const recommendations = ref<{ title: string; artist: string; category?: string; comment?: string; searchResult?: any; selected?: boolean }[]>([])
const addingProgress = ref({ current: 0, total: 0, currentSong: '', addedCount: 0 })

// 选中的歌曲数量
const selectedCount = computed(() => recommendations.value.filter(s => s.selected !== false).length)

// 按分类分组的歌曲
const groupedRecommendations = computed(() => {
  const groups: { category: string; songs: typeof recommendations.value }[] = []
  const categoryMap = new Map<string, typeof recommendations.value>()
  
  recommendations.value.forEach((song, index) => {
    const category = song.category || '🎵 推荐歌曲'
    if (!categoryMap.has(category)) {
      categoryMap.set(category, [])
    }
    categoryMap.get(category)!.push({ ...song, _index: index } as any)
  })
  
  categoryMap.forEach((songs, category) => {
    groups.push({ category, songs })
  })
  
  return groups
})

// 切换歌曲选中状态
function toggleSongSelection(index: number) {
  const song = recommendations.value[index]
  song.selected = song.selected === false ? true : false
}

// 全选/取消全选
function toggleSelectAll() {
  const allSelected = selectedCount.value === recommendations.value.length
  recommendations.value.forEach(s => (s.selected = !allSelected))
}

// 解析思考内容，提取歌曲和理由
const parsedThinking = computed(() => {
  const text = thinkingText.value
  if (!text) return { songs: [], reason: '' }
  
  const result: { songs: { title: string; artist: string }[]; reason: string } = {
    songs: [],
    reason: ''
  }
  
  // 尝试提取 reason
  const reasonMatch = text.match(/"reason"\s*:\s*"([^"]*)"/)
  if (reasonMatch) {
    result.reason = reasonMatch[1]
  }
  
  // 尝试提取 songs 数组中的歌曲
  const songMatches = text.matchAll(/"title"\s*:\s*"([^"]*)"\s*,\s*"artist"\s*:\s*"([^"]*)"/g)
  for (const match of songMatches) {
    result.songs.push({ title: match[1], artist: match[2] })
  }
  
  // 如果没有匹配到结构化数据，尝试从纯文本中提取
  if (result.songs.length === 0 && !result.reason) {
    // 检查是否有类似 "1. 歌名 - 歌手" 的格式
    const lineMatches = text.matchAll(/\d+\.\s*[《"]?([^》"—\-]+)[》"]?\s*[-—]\s*([^\n,，]+)/g)
    for (const match of lineMatches) {
      result.songs.push({ title: match[1].trim(), artist: match[2].trim() })
    }
  }
  
  return result
})

const historyKey = 'ai_picker_history'
const searchHistory = ref<string[]>(JSON.parse(localStorage.getItem(historyKey) || '[]'))

function addToHistory(query: string) {
  const q = query.trim()
  if (!q) return
  searchHistory.value = [q, ...searchHistory.value.filter(h => h !== q)].slice(0, 10)
  localStorage.setItem(historyKey, JSON.stringify(searchHistory.value))
}

function _clearHistory() { searchHistory.value = []; localStorage.removeItem(historyKey) }
void _clearHistory

const quickPrompts = computed(() => {
  const role = currentRole.value
  const defaultPrompts = [
    { icon: '🌿', label: '放松', prompt: '推荐放松的音乐', color: 'from-green-500 to-emerald-600' },
    { icon: '💼', label: '工作', prompt: '推荐适合工作听的音乐', color: 'from-blue-500 to-indigo-600' },
    { icon: '🏃', label: '运动', prompt: '推荐适合运动的音乐', color: 'from-orange-500 to-red-600' },
    { icon: '📚', label: '学习', prompt: '推荐适合学习的音乐', color: 'from-purple-500 to-violet-600' },
    { icon: '🚗', label: '开车', prompt: '推荐适合开车听的歌', color: 'from-cyan-500 to-blue-600' },
    { icon: '🌙', label: '夜晚', prompt: '推荐适合夜晚的音乐', color: 'from-indigo-500 to-purple-600' }
  ]
  const rolePrompts: Record<string, typeof defaultPrompts> = {
    rocker: [
      { icon: '🎸', label: '经典摇滚', prompt: '推荐经典摇滚乐队的歌', color: 'from-red-500 to-orange-600' },
      { icon: '🤘', label: '重金属', prompt: '来点重金属音乐', color: 'from-zinc-500 to-slate-600' },
      { icon: '⚡', label: '朋克', prompt: '推荐朋克摇滚', color: 'from-green-500 to-emerald-600' },
      { icon: '🔥', label: '另类摇滚', prompt: '推荐另类摇滚音乐', color: 'from-blue-500 to-cyan-600' }
    ],
    classical: [
      { icon: '🎹', label: '钢琴曲', prompt: '推荐优美的钢琴曲', color: 'from-indigo-500 to-purple-600' },
      { icon: '🎻', label: '交响乐', prompt: '推荐著名的交响乐', color: 'from-amber-500 to-orange-600' },
      { icon: '🎬', label: '电影配乐', prompt: '推荐经典电影配乐', color: 'from-rose-500 to-pink-600' },
      { icon: '🌙', label: '夜曲', prompt: '推荐浪漫的夜曲', color: 'from-slate-500 to-zinc-600' }
    ],
    hipster: [
      { icon: '🔥', label: '最新热歌', prompt: '推荐最近最火的歌', color: 'from-red-500 to-orange-600' },
      { icon: '🎤', label: '说唱', prompt: '推荐好听的说唱', color: 'from-purple-500 to-violet-600' },
      { icon: '🎛️', label: '电子音乐', prompt: '推荐好听的电子音乐', color: 'from-cyan-500 to-blue-600' },
      { icon: '💜', label: 'R&B', prompt: '推荐好听的R&B', color: 'from-indigo-500 to-blue-600' }
    ],
    folk: [
      { icon: '🎸', label: '华语民谣', prompt: '推荐好听的华语民谣', color: 'from-amber-500 to-yellow-600' },
      { icon: '🌿', label: '独立音乐', prompt: '推荐小众独立音乐', color: 'from-teal-500 to-cyan-600' },
      { icon: '☕', label: '咖啡厅', prompt: '推荐适合咖啡厅的音乐', color: 'from-stone-500 to-zinc-600' },
      { icon: '📖', label: '文艺', prompt: '推荐文艺范的歌曲', color: 'from-violet-500 to-purple-600' }
    ],
    retro: [
      { icon: '📻', label: '90年代', prompt: '推荐90年代经典老歌', color: 'from-amber-500 to-orange-600' },
      { icon: '🎵', label: '粤语金曲', prompt: '推荐粤语经典金曲', color: 'from-red-500 to-rose-600' },
      { icon: '🌍', label: '欧美经典', prompt: '推荐欧美经典老歌', color: 'from-blue-500 to-indigo-600' },
      { icon: '🎷', label: '爵士经典', prompt: '推荐经典爵士乐', color: 'from-yellow-500 to-amber-600' }
    ],
    chill: [
      { icon: '😴', label: '助眠', prompt: '推荐适合睡前听的音乐', color: 'from-indigo-500 to-purple-600' },
      { icon: '🧘', label: '冥想', prompt: '推荐适合冥想的音乐', color: 'from-teal-500 to-cyan-600' },
      { icon: '🎧', label: 'Lo-fi', prompt: '推荐好听的Lo-fi音乐', color: 'from-violet-500 to-purple-600' },
      { icon: '🎶', label: '轻音乐', prompt: '推荐轻柔的纯音乐', color: 'from-amber-500 to-yellow-600' }
    ],
    party: [
      { icon: '🎛️', label: 'EDM', prompt: '推荐嗨爆的EDM', color: 'from-pink-500 to-rose-600' },
      { icon: '🎉', label: '派对歌单', prompt: '推荐适合派对的歌', color: 'from-orange-500 to-red-600' },
      { icon: '🪩', label: '蹦迪神曲', prompt: '推荐蹦迪神曲', color: 'from-purple-500 to-violet-600' },
      { icon: '🔥', label: '嗨曲', prompt: '推荐超嗨的歌', color: 'from-yellow-500 to-amber-600' }
    ]
  }
  return rolePrompts[role.id] || defaultPrompts
})

async function getRecommendations() {
  if (!userInput.value.trim()) { error.value = '请输入你想听什么样的音乐'; return }
  if (!isAIConfigured()) { error.value = '请先在设置中配置 AI API Key'; return }
  addToHistory(userInput.value)
  loading.value = true
  error.value = ''
  aiReason.value = ''
  thinkingText.value = ''
  thinkingPhase.value = 'thinking'
  recommendations.value = []
  addingProgress.value = { current: 0, total: 0, currentSong: '', addedCount: 0 }
  try {
    const result = await getAIRecommendations(userInput.value, { onThinking: (text) => { thinkingText.value = text } }, currentRole.value)
    if (!result || result.songs.length === 0) { error.value = 'AI 没有返回推荐结果，请换个描述试试'; loading.value = false; return }
    aiReason.value = result.reason
    // 默认全部选中
    recommendations.value = result.songs.map(s => ({ ...s, selected: true }))
    // 进入确认阶段，等待用户选择
    thinkingPhase.value = 'confirming'
  } catch (e: any) { 
    error.value = e.message || '获取推荐失败'
    thinkingPhase.value = 'thinking'
  }
  finally { loading.value = false }
}

// 用户确认后开始添加歌曲到播放列表
async function startSearching() {
  // 只处理选中的歌曲
  const selectedSongs = recommendations.value.filter(s => s.selected !== false)
  if (selectedSongs.length === 0) { 
    error.value = '请至少选择一首歌曲'
    return 
  }
  
  searching.value = true
  thinkingPhase.value = 'adding'
  addingProgress.value = { current: 0, total: selectedSongs.length, currentSong: '', addedCount: 0 }
  
  const sources: MusicSource[] = ['netease', 'kuwo', 'kugou']
  let firstTrackIndex = -1
  
  for (let i = 0; i < selectedSongs.length; i++) {
    const song = selectedSongs[i]
    addingProgress.value.current = i + 1
    addingProgress.value.currentSong = `${song.title} - ${song.artist}`
    
    // 搜索歌曲
    for (const source of sources) {
      try {
        const results = await searchSongs(source, `${song.title} ${song.artist}`, 5)
        const match = results.find(r => r.name.toLowerCase().includes(song.title.toLowerCase()) || song.title.toLowerCase().includes(r.name.toLowerCase())) || results[0]
        if (match) { 
          song.searchResult = match
          // 找到后立即添加到播放列表
          const track = searchResultToTrack(match)
          playerStore.addTrack(track)
          addingProgress.value.addedCount++
          // 记录第一首歌的位置
          if (firstTrackIndex === -1) {
            firstTrackIndex = playerStore.playlist.length - 1
          }
          break 
        }
      } catch { continue }
    }
  }
  
  // 开始播放第一首添加的歌曲
  if (firstTrackIndex !== -1) {
    playerStore.playTrack(firstTrackIndex)
  }
  
  // 显示提示
  const addedCount = addingProgress.value.addedCount
  if (addedCount > 0) {
    showToast(`🎵 已添加 ${addedCount} 首歌曲到播放列表`)
  } else {
    showToast('未能找到可播放的歌曲', 'error')
  }
  
  // 返回到推荐确认状态
  searching.value = false
  thinkingPhase.value = 'confirming'
}

// 换一批推荐
function refreshRecommendations() {
  if (userInput.value.trim()) {
    getRecommendations()
  }
}

function useQuickPrompt(prompt: string) { userInput.value = prompt; getRecommendations() }
</script>

<template>
  <div class="flex-1 overflow-y-auto bg-gradient-to-b from-slate-900 via-slate-900 to-black">
    <!-- Toast 提示 -->
    <Transition name="toast">
      <div v-if="toast.show" class="fixed top-20 left-1/2 -translate-x-1/2 z-50">
        <div :class="[
          'px-5 py-3 rounded-2xl shadow-2xl backdrop-blur-xl flex items-center gap-3 border',
          toast.type === 'success' 
            ? 'bg-green-500/20 border-green-500/30 text-green-200' 
            : 'bg-red-500/20 border-red-500/30 text-red-200'
        ]">
          <div :class="[
            'w-8 h-8 rounded-xl flex items-center justify-center',
            toast.type === 'success' ? 'bg-green-500/30' : 'bg-red-500/30'
          ]">
            <svg v-if="toast.type === 'success'" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
            </svg>
            <svg v-else class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </div>
          <span class="text-sm font-medium">{{ toast.message }}</span>
        </div>
      </div>
    </Transition>

    <!-- 顶部装饰背景 -->
    <div class="relative">
      <div class="absolute inset-0 overflow-hidden">
        <div class="absolute -top-24 -right-24 w-96 h-96 bg-purple-600/20 rounded-full blur-3xl"></div>
        <div class="absolute -top-12 -left-12 w-64 h-64 bg-pink-600/15 rounded-full blur-3xl"></div>
        <div class="absolute top-32 right-1/4 w-48 h-48 bg-blue-600/10 rounded-full blur-3xl"></div>
      </div>
      
      <div class="relative px-4 md:px-6 pt-6 pb-4">
        <!-- AI 角色卡片 -->
        <div class="mb-6">
          <div
            @click="showRoleSelector = !showRoleSelector"
            class="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-white/10 to-white/5 backdrop-blur-xl border border-white/10 p-4 cursor-pointer transition-all duration-300 hover:border-purple-500/30 hover:shadow-lg hover:shadow-purple-500/10"
          >
            <div class="absolute inset-0 bg-gradient-to-r from-purple-600/10 via-transparent to-pink-600/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <div class="relative flex items-center gap-4">
              <div class="relative">
                <div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500 via-pink-500 to-rose-500 flex items-center justify-center text-2xl shadow-lg shadow-purple-500/25">
                  {{ currentRole.avatar }}
                </div>
                <div class="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-slate-900"></div>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <span class="text-white font-semibold text-lg">{{ currentRole.name }}</span>
                  <span class="px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 text-xs font-medium">AI</span>
                </div>
                <p class="text-white/50 text-sm truncate">{{ currentRole.greeting }}</p>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-white/30 text-xs hidden sm:block">切换角色</span>
                <svg class="w-5 h-5 text-white/40 transition-transform" :class="showRoleSelector ? 'rotate-180' : ''" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
                </svg>
              </div>
            </div>
          </div>

          <!-- 角色选择器 -->
          <Transition name="expand">
            <div v-if="showRoleSelector" class="mt-3 p-4 rounded-2xl bg-black/60 backdrop-blur-xl border border-white/10">
              <p class="text-white/40 text-xs mb-3 flex items-center gap-2">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/>
                </svg>
                选择 AI 角色，不同角色有不同的音乐品味
              </p>
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <button
                  v-for="role in AI_ROLES"
                  :key="role.id"
                  @click="selectRole(role)"
                  :class="[
                    'group relative p-3 rounded-xl text-left transition-all duration-200 overflow-hidden',
                    currentRole.id === role.id
                      ? 'bg-gradient-to-br from-purple-600/40 to-pink-600/40 border-2 border-purple-400/50 shadow-lg shadow-purple-500/20'
                      : 'bg-white/5 hover:bg-white/10 border border-transparent hover:border-white/20'
                  ]"
                >
                  <div class="flex items-center gap-2 mb-1.5">
                    <span class="text-xl">{{ role.avatar }}</span>
                    <span class="text-white text-sm font-medium">{{ role.name }}</span>
                  </div>
                  <p class="text-white/40 text-xs line-clamp-2">{{ role.description }}</p>
                  <div v-if="currentRole.id === role.id" class="absolute top-2 right-2">
                    <svg class="w-4 h-4 text-purple-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
                    </svg>
                  </div>
                </button>
              </div>
            </div>
          </Transition>
        </div>

        <!-- 偏好设置按钮 -->
        <div class="mb-5 flex items-center gap-3 flex-wrap">
          <button
            @click="showPreferences = !showPreferences"
            :class="[
              'px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 flex items-center gap-2',
              showPreferences 
                ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg shadow-purple-500/25' 
                : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white border border-white/10'
            ]"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"/>
            </svg>
            偏好设置
          </button>
          <!-- 当前偏好标签 -->
          <div class="flex flex-wrap gap-1.5">
            <span 
              v-for="lang in preferences.languages"
              :key="lang"
              class="px-2.5 py-1 rounded-full bg-gradient-to-r from-purple-500/20 to-purple-600/20 text-purple-300 text-xs font-medium border border-purple-500/20"
            >
              {{ LANGUAGE_OPTIONS.find(o => o.value === lang)?.label }}
            </span>
            <span
              v-for="era in preferences.eras"
              :key="era"
              class="px-2.5 py-1 rounded-full bg-gradient-to-r from-blue-500/20 to-blue-600/20 text-blue-300 text-xs font-medium border border-blue-500/20"
            >
              {{ ERA_OPTIONS.find(o => o.value === era)?.label }}
            </span>
            <span
              v-for="mood in preferences.moods"
              :key="mood"
              class="px-2.5 py-1 rounded-full bg-gradient-to-r from-green-500/20 to-green-600/20 text-green-300 text-xs font-medium border border-green-500/20"
            >
              {{ MOOD_OPTIONS.find(o => o.value === mood)?.label }}
            </span>
            <span
              v-for="vocal in preferences.vocals"
              :key="vocal"
              class="px-2.5 py-1 rounded-full bg-gradient-to-r from-orange-500/20 to-orange-600/20 text-orange-300 text-xs font-medium border border-orange-500/20"
            >
              {{ VOCAL_OPTIONS.find(o => o.value === vocal)?.label }}
            </span>
          </div>
        </div>

        <!-- 偏好设置面板 -->
        <Transition name="expand">
          <div v-if="showPreferences" class="mb-5 p-5 rounded-2xl bg-black/40 backdrop-blur-xl border border-white/10 space-y-5">
            <!-- 语言偏好 -->
            <div>
              <p class="text-white/70 text-sm mb-3 flex items-center gap-2 font-medium">
                <span class="w-6 h-6 rounded-lg bg-purple-500/20 flex items-center justify-center text-xs">🌐</span>
                语言偏好 <span class="text-white/30 font-normal">（可多选）</span>
              </p>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="opt in LANGUAGE_OPTIONS"
                  :key="opt.value"
                  @click="togglePreference('languages', opt.value)"
                  :class="[
                    'px-4 py-2 rounded-xl text-sm transition-all duration-200',
                    preferences.languages.includes(opt.value)
                      ? 'bg-gradient-to-r from-purple-600 to-purple-700 text-white shadow-lg shadow-purple-500/20'
                      : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white border border-white/5'
                  ]"
                >
                  {{ opt.icon }} {{ opt.label }}
                </button>
              </div>
            </div>

            <!-- 年代偏好 -->
            <div>
              <p class="text-white/70 text-sm mb-3 flex items-center gap-2 font-medium">
                <span class="w-6 h-6 rounded-lg bg-blue-500/20 flex items-center justify-center text-xs">📅</span>
                年代偏好 <span class="text-white/30 font-normal">（可多选）</span>
              </p>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="opt in ERA_OPTIONS"
                  :key="opt.value"
                  @click="togglePreference('eras', opt.value)"
                  :class="[
                    'px-4 py-2 rounded-xl text-sm transition-all duration-200',
                    preferences.eras.includes(opt.value)
                      ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg shadow-blue-500/20'
                      : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white border border-white/5'
                  ]"
                >
                  {{ opt.icon }} {{ opt.label }}
                </button>
              </div>
            </div>

            <!-- 情绪偏好 -->
            <div>
              <p class="text-white/70 text-sm mb-3 flex items-center gap-2 font-medium">
                <span class="w-6 h-6 rounded-lg bg-green-500/20 flex items-center justify-center text-xs">🎭</span>
                情绪偏好 <span class="text-white/30 font-normal">（可多选）</span>
              </p>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="opt in MOOD_OPTIONS"
                  :key="opt.value"
                  @click="togglePreference('moods', opt.value)"
                  :class="[
                    'px-4 py-2 rounded-xl text-sm transition-all duration-200',
                    preferences.moods.includes(opt.value)
                      ? 'bg-gradient-to-r from-green-600 to-green-700 text-white shadow-lg shadow-green-500/20'
                      : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white border border-white/5'
                  ]"
                >
                  {{ opt.icon }} {{ opt.label }}
                </button>
              </div>
            </div>

            <!-- 人声偏好 -->
            <div>
              <p class="text-white/70 text-sm mb-3 flex items-center gap-2 font-medium">
                <span class="w-6 h-6 rounded-lg bg-orange-500/20 flex items-center justify-center text-xs">🎤</span>
                人声偏好 <span class="text-white/30 font-normal">（可多选）</span>
              </p>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="opt in VOCAL_OPTIONS"
                  :key="opt.value"
                  @click="togglePreference('vocals', opt.value)"
                  :class="[
                    'px-4 py-2 rounded-xl text-sm transition-all duration-200',
                    preferences.vocals.includes(opt.value)
                      ? 'bg-gradient-to-r from-orange-600 to-orange-700 text-white shadow-lg shadow-orange-500/20'
                      : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white border border-white/5'
                  ]"
                >
                  {{ opt.icon }} {{ opt.label }}
                </button>
              </div>
            </div>

            <!-- 喜欢的歌手 -->
            <div>
              <p class="text-white/70 text-sm mb-3 flex items-center gap-2 font-medium">
                <span class="w-6 h-6 rounded-lg bg-pink-500/20 flex items-center justify-center text-xs">❤️</span>
                喜欢的歌手
              </p>
              <div class="flex flex-wrap gap-2 mb-3">
                <span
                  v-for="artist in preferences.favoriteArtists"
                  :key="artist"
                  class="group px-3 py-1.5 rounded-xl bg-gradient-to-r from-pink-500/20 to-rose-500/20 text-pink-300 text-sm flex items-center gap-2 border border-pink-500/20"
                >
                  {{ artist }}
                  <button @click="removeFavoriteArtist(artist)" class="w-4 h-4 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-xs transition-colors">×</button>
                </span>
                <span v-if="preferences.favoriteArtists.length === 0" class="text-white/30 text-sm">暂无</span>
              </div>
              <div class="flex gap-2">
                <input
                  v-model="newFavoriteArtist"
                  type="text"
                  placeholder="添加歌手名"
                  class="flex-1 h-10 px-4 rounded-xl bg-white/5 text-white text-sm placeholder-white/30 outline-none border border-white/10 focus:border-pink-500/50 focus:bg-white/10 transition-all"
                  @keyup.enter="addFavoriteArtist"
                />
                <button @click="addFavoriteArtist" class="w-10 h-10 rounded-xl bg-gradient-to-r from-pink-600 to-rose-600 text-white flex items-center justify-center hover:shadow-lg hover:shadow-pink-500/25 transition-all">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                  </svg>
                </button>
              </div>
            </div>

            <!-- 不喜欢的歌手 -->
            <div>
              <p class="text-white/70 text-sm mb-3 flex items-center gap-2 font-medium">
                <span class="w-6 h-6 rounded-lg bg-red-500/20 flex items-center justify-center text-xs">💔</span>
                不喜欢的歌手 <span class="text-white/30 font-normal">（会避免推荐）</span>
              </p>
              <div class="flex flex-wrap gap-2 mb-3">
                <span
                  v-for="artist in preferences.dislikedArtists"
                  :key="artist"
                  class="group px-3 py-1.5 rounded-xl bg-gradient-to-r from-red-500/20 to-red-600/20 text-red-300 text-sm flex items-center gap-2 border border-red-500/20"
                >
                  {{ artist }}
                  <button @click="removeDislikedArtist(artist)" class="w-4 h-4 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-xs transition-colors">×</button>
                </span>
                <span v-if="preferences.dislikedArtists.length === 0" class="text-white/30 text-sm">暂无</span>
              </div>
              <div class="flex gap-2">
                <input
                  v-model="newDislikedArtist"
                  type="text"
                  placeholder="添加歌手名"
                  class="flex-1 h-10 px-4 rounded-xl bg-white/5 text-white text-sm placeholder-white/30 outline-none border border-white/10 focus:border-red-500/50 focus:bg-white/10 transition-all"
                  @keyup.enter="addDislikedArtist"
                />
                <button @click="addDislikedArtist" class="w-10 h-10 rounded-xl bg-gradient-to-r from-red-600 to-red-700 text-white flex items-center justify-center hover:shadow-lg hover:shadow-red-500/25 transition-all">
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </Transition>

        <!-- 未配置提示 -->
        <div v-if="!isAIConfigured()" class="mb-5 p-4 rounded-2xl bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/20 flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
            <svg class="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
            </svg>
          </div>
          <div>
            <p class="text-amber-200 text-sm font-medium">需要配置 AI</p>
            <p class="text-amber-200/60 text-xs">请先在设置中配置 AI API Key</p>
          </div>
        </div>

        <!-- 输入区域 -->
        <div class="mb-5">
          <div class="relative">
            <div class="flex gap-3">
              <div class="flex-1 relative">
                <input
                  v-model="userInput"
                  type="text"
                  :placeholder="`问 ${currentRole.name}：想听什么歌？`"
                  class="w-full h-12 pl-5 pr-12 rounded-2xl bg-white/5 text-white placeholder-white/30 outline-none border border-white/10 focus:border-purple-500/50 focus:bg-white/10 focus:shadow-lg focus:shadow-purple-500/10 transition-all text-sm"
                  @keyup.enter="getRecommendations"
                  :disabled="loading"
                />
                <div class="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  <button v-if="userInput" @click="userInput = ''" class="w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/40 hover:text-white transition-all">
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                  </button>
                </div>
              </div>
              <button
                @click="getRecommendations"
                :disabled="loading || !userInput.trim()"
                class="px-6 h-12 rounded-2xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40 flex items-center gap-2"
              >
                <svg v-if="!loading" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
                </svg>
                <svg v-else class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                {{ loading ? '推荐中' : '推荐' }}
              </button>
            </div>
          </div>
        </div>

        <!-- 快捷提示 -->
        <div v-if="!loading && recommendations.length === 0" class="mb-5">
          <p class="text-white/40 text-xs mb-3 flex items-center gap-2">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
            </svg>
            快速开始
          </p>
          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            <button
              v-for="item in quickPrompts"
              :key="item.label"
              @click="useQuickPrompt(item.prompt)"
              class="group relative overflow-hidden p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/20 transition-all duration-200 text-left"
            >
              <div class="absolute inset-0 bg-gradient-to-br opacity-0 group-hover:opacity-100 transition-opacity" :class="item.color"></div>
              <div class="relative flex items-center gap-2">
                <span class="text-lg">{{ item.icon }}</span>
                <span class="text-white/70 group-hover:text-white text-sm font-medium transition-colors">{{ item.label }}</span>
              </div>
            </button>
          </div>
        </div>

        <!-- 错误提示 -->
        <Transition name="fade">
          <div v-if="error" class="mb-5 p-4 rounded-2xl bg-gradient-to-r from-red-500/10 to-red-600/10 border border-red-500/20 flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center flex-shrink-0">
              <svg class="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
            </div>
            <p class="text-red-200 text-sm">{{ error }}</p>
          </div>
        </Transition>

        <!-- AI 思考过程 -->
        <Transition name="fade">
          <div v-if="loading && thinkingPhase === 'thinking'" class="mb-5">
            <div class="p-5 rounded-2xl bg-gradient-to-br from-purple-500/10 to-pink-500/10 border border-purple-500/20 backdrop-blur-xl">
              <div class="flex items-center gap-3 mb-4">
                <div class="relative">
                  <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-lg animate-pulse">
                    {{ currentRole.avatar }}
                  </div>
                  <div class="absolute -bottom-1 -right-1 w-3 h-3 bg-purple-500 rounded-full animate-ping"></div>
                </div>
                <div class="flex-1">
                  <span class="text-white font-medium">{{ currentRole.name }}</span>
                  <span class="text-purple-300 text-sm ml-2">正在为你挑选歌曲...</span>
                </div>
                <div class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-purple-500/20 text-purple-300 text-xs">
                  <svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                  思考中
                </div>
              </div>
              
              <!-- 思考内容展示 -->
              <div class="relative">
                <!-- 解析并展示思考内容 -->
                <div v-if="parsedThinking.reason || parsedThinking.songs.length > 0" class="space-y-4">
                  <!-- 推荐理由 -->
                  <div v-if="parsedThinking.reason" class="p-3 rounded-xl bg-white/5 border border-white/10">
                    <div class="flex items-center gap-2 mb-2">
                      <span class="text-purple-400 text-xs font-medium">💭 推荐理由</span>
                    </div>
                    <p class="text-white/80 text-sm leading-relaxed">{{ parsedThinking.reason }}</p>
                  </div>
                  
                  <!-- 已识别的歌曲 -->
                  <div v-if="parsedThinking.songs.length > 0">
                    <div class="flex items-center gap-2 mb-2">
                      <span class="text-green-400 text-xs font-medium">🎵 正在推荐</span>
                      <span class="text-white/30 text-xs">{{ parsedThinking.songs.length }} 首</span>
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div 
                        v-for="(song, idx) in parsedThinking.songs" 
                        :key="idx"
                        class="flex items-center gap-2 p-2 rounded-lg bg-white/5 border border-white/5"
                      >
                        <span class="w-5 h-5 rounded bg-purple-500/20 text-purple-300 text-xs flex items-center justify-center">{{ idx + 1 }}</span>
                        <div class="flex-1 min-w-0">
                          <p class="text-white/90 text-xs font-medium truncate">{{ song.title }}</p>
                          <p class="text-white/40 text-xs truncate">{{ song.artist }}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                
                <!-- 原始文本（当无法解析时显示） -->
                <div v-else class="pl-4 border-l-2 border-purple-500/30">
                  <div class="text-white/70 text-sm whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">
                    {{ thinkingText || '分析你的需求中...' }}
                    <span class="inline-block w-2 h-4 bg-purple-400 ml-1 animate-pulse"></span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Transition>

        <!-- 添加到播放列表进度 -->
        <Transition name="fade">
          <div v-if="searching && thinkingPhase === 'adding'" class="mb-5">
            <div class="p-5 rounded-2xl bg-gradient-to-br from-green-500/10 to-emerald-500/10 border border-green-500/20 backdrop-blur-xl">
              <div class="flex items-center gap-3 mb-4">
                <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center">
                  <svg class="w-5 h-5 text-white animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/>
                  </svg>
                </div>
                <div class="flex-1">
                  <span class="text-white font-medium">正在添加到播放列表</span>
                  <span class="text-green-300 text-sm ml-2">{{ addingProgress.current }}/{{ addingProgress.total }}</span>
                </div>
                <div v-if="addingProgress.addedCount > 0" class="px-2 py-1 rounded-full bg-green-500/20 text-green-300 text-xs">
                  已添加 {{ addingProgress.addedCount }} 首
                </div>
              </div>
              <div class="flex items-center gap-3 p-3 rounded-xl bg-white/5">
                <div class="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
                  <svg class="w-4 h-4 text-purple-300 animate-pulse" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z"/>
                  </svg>
                </div>
                <div class="flex-1 min-w-0">
                  <p class="text-white text-sm font-medium truncate">{{ addingProgress.currentSong }}</p>
                </div>
              </div>
              <div class="mt-3 h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  class="h-full bg-gradient-to-r from-green-500 to-emerald-500 transition-all duration-300 ease-out rounded-full"
                  :style="{ width: `${(addingProgress.current / addingProgress.total) * 100}%` }"
                ></div>
              </div>
            </div>
          </div>
        </Transition>

        <!-- AI 推荐确认阶段 -->
        <Transition name="fade">
          <div v-if="!loading && !searching && thinkingPhase === 'confirming' && recommendations.length > 0" class="mb-5">
            <!-- AI 主持人卡片 -->
            <div class="mb-4 p-4 rounded-2xl bg-gradient-to-br from-purple-600/20 via-pink-500/10 to-purple-600/20 border border-purple-500/30 backdrop-blur-xl relative overflow-hidden">
              <!-- 装饰背景 -->
              <div class="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 rounded-full blur-2xl"></div>
              <div class="absolute bottom-0 left-0 w-24 h-24 bg-pink-500/10 rounded-full blur-2xl"></div>
              
              <div class="relative flex items-start gap-4">
                <!-- 头像 -->
                <div class="relative flex-shrink-0">
                  <div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500 via-pink-500 to-rose-500 flex items-center justify-center text-2xl shadow-lg shadow-purple-500/30">
                    {{ currentRole.avatar }}
                  </div>
                  <div class="absolute -bottom-1 -right-1 w-5 h-5 bg-green-500 rounded-full border-2 border-slate-900 flex items-center justify-center">
                    <svg class="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
                    </svg>
                  </div>
                </div>
                
                <!-- 内容 -->
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-2">
                    <span class="text-white font-semibold text-lg">{{ currentRole.name }}</span>
                    <span class="px-2.5 py-1 rounded-full bg-gradient-to-r from-green-500/20 to-emerald-500/20 text-green-300 text-xs font-medium border border-green-500/30">
                      🎵 推荐完成
                    </span>
                  </div>
                  <!-- 开场白 -->
                  <p v-if="aiReason" class="text-white/80 text-sm leading-relaxed">{{ aiReason }}</p>
                  <p v-else class="text-white/60 text-sm leading-relaxed italic">为你精心挑选了 {{ recommendations.length }} 首歌曲，希望你喜欢~</p>
                </div>
              </div>
            </div>
            
            <!-- 歌曲列表卡片 -->
            <div class="rounded-2xl bg-black/40 border border-white/10 backdrop-blur-xl overflow-hidden">
              <!-- 标题栏 -->
              <div class="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-white/5">
                <div class="flex items-center gap-2">
                  <span class="text-lg">🎧</span>
                  <span class="text-white font-medium">专属歌单</span>
                  <span class="text-white/40 text-sm">{{ recommendations.length }} 首</span>
                </div>
                <button 
                  @click="toggleSelectAll"
                  class="text-xs text-purple-300 hover:text-purple-200 transition-colors flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-white/5"
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/>
                  </svg>
                  {{ selectedCount === recommendations.length ? '取消全选' : '全选' }}
                </button>
              </div>
              
              <!-- 分类歌曲列表 -->
              <div class="max-h-96 overflow-y-auto">
                <div v-for="(group, groupIdx) in groupedRecommendations" :key="group.category" class="border-b border-white/5 last:border-b-0">
                  <!-- 分类标题 -->
                  <div class="sticky top-0 z-10 px-4 py-2.5 bg-gradient-to-r from-purple-900/50 to-pink-900/30 backdrop-blur-sm border-b border-white/5">
                    <span class="text-white/90 text-sm font-medium">{{ group.category || `🎵 推荐歌曲 ${groupIdx + 1}` }}</span>
                  </div>
                  
                  <!-- 歌曲列表 -->
                  <div class="divide-y divide-white/5">
                    <div 
                      v-for="song in group.songs" 
                      :key="(song as any)._index"
                      @click="toggleSongSelection((song as any)._index)"
                      :class="[
                        'flex items-center gap-3 px-4 py-3 cursor-pointer transition-all duration-200',
                        song.selected !== false 
                          ? 'bg-purple-500/10 hover:bg-purple-500/15' 
                          : 'hover:bg-white/5 opacity-50'
                      ]"
                    >
                      <!-- 勾选框 -->
                      <div :class="[
                        'w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 transition-all duration-200',
                        song.selected !== false 
                          ? 'bg-gradient-to-br from-purple-500 to-pink-500 shadow-lg shadow-purple-500/30' 
                          : 'bg-white/10 border border-white/20'
                      ]">
                        <svg v-if="song.selected !== false" class="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/>
                        </svg>
                      </div>
                      
                      <!-- 歌曲信息 -->
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 mb-0.5">
                          <p :class="['text-sm font-medium truncate', song.selected !== false ? 'text-white' : 'text-white/60']">
                            {{ song.title }}
                          </p>
                          <span class="text-white/20 text-xs">•</span>
                          <p class="text-white/40 text-sm truncate flex-shrink-0">{{ song.artist }}</p>
                        </div>
                        <p v-if="song.comment" :class="['text-xs line-clamp-1', song.selected !== false ? 'text-purple-300/70' : 'text-white/30']">
                          💡 {{ song.comment }}
                        </p>
                      </div>
                      
                      <!-- 音乐图标 -->
                      <div v-if="song.selected !== false" class="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                        <svg class="w-4 h-4 text-purple-300" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z"/>
                        </svg>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              
              <!-- 底部操作栏 -->
              <div class="px-4 py-4 border-t border-white/10 bg-gradient-to-r from-purple-900/30 to-pink-900/20">
                <div class="flex items-center gap-2">
                  <button 
                    @click="startSearching"
                    :disabled="selectedCount === 0"
                    :class="[
                      'flex-1 h-11 rounded-xl text-white text-sm font-medium transition-all duration-300 flex items-center justify-center gap-2',
                      selectedCount > 0 
                        ? 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 shadow-lg shadow-purple-500/30 hover:shadow-purple-500/50 hover:scale-[1.02]' 
                        : 'bg-white/10 cursor-not-allowed opacity-50'
                    ]"
                  >
                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"/>
                    </svg>
                    听听看
                  </button>
                  <button 
                    @click="openPlaylistModal"
                    :disabled="selectedCount === 0"
                    :class="[
                      'h-11 px-4 rounded-xl text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2',
                      selectedCount > 0 
                        ? 'bg-white/10 hover:bg-white/20 text-white hover:scale-105' 
                        : 'bg-white/5 cursor-not-allowed opacity-50 text-white/50'
                    ]"
                  >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                    </svg>
                    加入歌单
                  </button>
                  <button 
                    @click="refreshRecommendations"
                    class="h-11 px-4 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2 hover:scale-105"
                  >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                    </svg>
                    换一批
                  </button>
                </div>
                <p class="text-center text-white/30 text-xs mt-2">已选 {{ selectedCount }} 首</p>
              </div>
            </div>
          </div>
        </Transition>

        <!-- 歌单选择弹窗 -->
        <Transition name="fade">
          <div v-if="showPlaylistModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" @click.self="showPlaylistModal = false">
            <div class="w-full max-w-sm bg-slate-900 rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
              <!-- 弹窗标题 -->
              <div class="px-5 py-4 border-b border-white/10 bg-gradient-to-r from-purple-900/30 to-pink-900/20">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                      <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/>
                      </svg>
                    </div>
                    <div>
                      <h3 class="text-white font-semibold">添加到歌单</h3>
                      <p class="text-white/50 text-xs">{{ selectedCount }} 首歌曲</p>
                    </div>
                  </div>
                  <button @click="showPlaylistModal = false" class="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/50 hover:text-white transition-colors">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                  </button>
                </div>
              </div>
              
              <!-- 歌单列表 -->
              <div class="max-h-64 overflow-y-auto">
                <div v-if="playlistStore.playlists.length === 0" class="px-5 py-8 text-center">
                  <div class="w-16 h-16 mx-auto mb-3 rounded-2xl bg-white/5 flex items-center justify-center">
                    <svg class="w-8 h-8 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/>
                    </svg>
                  </div>
                  <p class="text-white/50 text-sm">还没有歌单</p>
                  <p class="text-white/30 text-xs mt-1">去「我的」页面创建一个吧</p>
                </div>
                <div v-else class="divide-y divide-white/5">
                  <button
                    v-for="playlist in playlistStore.playlists"
                    :key="playlist.id"
                    @click="addToUserPlaylist(playlist.id)"
                    class="w-full px-5 py-3 flex items-center gap-3 hover:bg-white/5 transition-colors text-left"
                  >
                    <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center flex-shrink-0">
                      <svg class="w-6 h-6 text-purple-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/>
                      </svg>
                    </div>
                    <div class="flex-1 min-w-0">
                      <p class="text-white text-sm font-medium truncate">{{ playlist.name }}</p>
                      <p class="text-white/40 text-xs">{{ playlist.trackIds.length }} 首歌曲</p>
                    </div>
                    <svg class="w-5 h-5 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>

<style scoped>
.expand-enter-active,
.expand-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}
.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  max-height: 0;
  transform: translateY(-10px);
}
.expand-enter-to,
.expand-leave-from {
  opacity: 1;
  max-height: 1000px;
}

.fade-enter-active,
.fade-leave-active {
  transition: all 0.25s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(10px);
}

/* Toast 动画 */
.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, -20px);
}

/* 自定义滚动条 */
::-webkit-scrollbar {
  width: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.2);
}

/* 行截断 */
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
