<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { usePlayerStore } from '@/store/player'
import { usePlaylistStore } from '@/store/playlist'
import { searchSongs, searchResultToTrack, type MusicSource } from '@/services/source/OnlineApiSource'
import { getAIRecommendations, isAIConfigured, AI_ROLES, getCurrentRole, setCurrentRole, loadPreferences, savePreferences, LANGUAGE_OPTIONS, ERA_OPTIONS, MOOD_OPTIONS, VOCAL_OPTIONS, type AIRole, type AIPreferences } from '@/services/ai/AIService'
import { trackStorage } from '@/services/TrackStorage'
import { setSelectMode } from '@/store/ui'

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
const recommendations = ref<{ title: string; artist: string; category?: string; comment?: string; searchResult?: any; selected?: boolean }[]>([])
const addingProgress = ref({ current: 0, total: 0, currentSong: '', addedCount: 0 })

// UI 状态
const currentRole = ref<AIRole>(getCurrentRole())
const showRoleSelector = ref(false)
const showPreferences = ref(false)
const showPlaylistModal = ref(false)
const preferences = ref<AIPreferences>(loadPreferences())
const newFavoriteArtist = ref('')
const newDislikedArtist = ref('')

// 沉浸模式：思考中、有推荐结果、添加中都进入沉浸模式
const isImmersive = computed(() => 
  (thinkingPhase.value === 'thinking' && loading.value) ||
  (thinkingPhase.value === 'confirming' && recommendations.value.length > 0) ||
  (thinkingPhase.value === 'adding' && searching.value)
)

// 同步沉浸模式到全局状态（只在有推荐结果时隐藏底部栏）
const shouldHideBottomBar = computed(() => thinkingPhase.value === 'confirming' && recommendations.value.length > 0 && !searching.value)
watch(shouldHideBottomBar, (val) => setSelectMode(val), { immediate: true })
onUnmounted(() => setSelectMode(false))

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
  setTimeout(() => { toast.value.show = false }, 2500)
}

// 选中数量
const selectedCount = computed(() => recommendations.value.filter(s => s.selected !== false).length)

// 快捷提示
const quickPrompts = computed(() => {
  const role = currentRole.value
  const defaultPrompts = [
    { icon: '🌿', label: '放松', prompt: '推荐放松的音乐' },
    { icon: '💼', label: '工作', prompt: '推荐适合工作听的音乐' },
    { icon: '🏃', label: '运动', prompt: '推荐适合运动的音乐' },
    { icon: '🌙', label: '夜晚', prompt: '推荐适合夜晚的音乐' },
    { icon: '🚗', label: '开车', prompt: '推荐适合开车听的歌' },
    { icon: '☕', label: '咖啡', prompt: '推荐适合咖啡厅的音乐' }
  ]
  const rolePrompts: Record<string, typeof defaultPrompts> = {
    rocker: [
      { icon: '🎸', label: '经典摇滚', prompt: '推荐经典摇滚乐队的歌' },
      { icon: '🤘', label: '重金属', prompt: '来点重金属音乐' },
      { icon: '⚡', label: '朋克', prompt: '推荐朋克摇滚' },
      { icon: '🔥', label: '另类', prompt: '推荐另类摇滚音乐' }
    ],
    classical: [
      { icon: '🎹', label: '钢琴曲', prompt: '推荐优美的钢琴曲' },
      { icon: '🎻', label: '交响乐', prompt: '推荐著名的交响乐' },
      { icon: '🎬', label: '电影配乐', prompt: '推荐经典电影配乐' },
      { icon: '🌙', label: '夜曲', prompt: '推荐浪漫的夜曲' }
    ],
    hipster: [
      { icon: '🔥', label: '热歌', prompt: '推荐最近最火的歌' },
      { icon: '🎤', label: '说唱', prompt: '推荐好听的说唱' },
      { icon: '🎛️', label: '电子', prompt: '推荐好听的电子音乐' },
      { icon: '💜', label: 'R&B', prompt: '推荐好听的R&B' }
    ],
    folk: [
      { icon: '🎸', label: '民谣', prompt: '推荐好听的华语民谣' },
      { icon: '🌿', label: '独立', prompt: '推荐小众独立音乐' },
      { icon: '☕', label: '咖啡厅', prompt: '推荐适合咖啡厅的音乐' },
      { icon: '📖', label: '文艺', prompt: '推荐文艺范的歌曲' }
    ],
    retro: [
      { icon: '📻', label: '90年代', prompt: '推荐90年代经典老歌' },
      { icon: '🎵', label: '粤语', prompt: '推荐粤语经典金曲' },
      { icon: '🌍', label: '欧美', prompt: '推荐欧美经典老歌' },
      { icon: '🎷', label: '爵士', prompt: '推荐经典爵士乐' }
    ],
    chill: [
      { icon: '😴', label: '助眠', prompt: '推荐适合睡前听的音乐' },
      { icon: '🧘', label: '冥想', prompt: '推荐适合冥想的音乐' },
      { icon: '🎧', label: 'Lo-fi', prompt: '推荐好听的Lo-fi音乐' },
      { icon: '🎶', label: '轻音乐', prompt: '推荐轻柔的纯音乐' }
    ],
    party: [
      { icon: '🎛️', label: 'EDM', prompt: '推荐嗨爆的EDM' },
      { icon: '🎉', label: '派对', prompt: '推荐适合派对的歌' },
      { icon: '🪩', label: '蹦迪', prompt: '推荐蹦迪神曲' },
      { icon: '🔥', label: '嗨曲', prompt: '推荐超嗨的歌' }
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

// 开始播放
async function startSearching() {
  const selectedSongs = recommendations.value.filter(s => s.selected !== false)
  if (selectedSongs.length === 0) { error.value = '请至少选择一首歌曲'; return }
  
  searching.value = true
  thinkingPhase.value = 'adding'
  addingProgress.value = { current: 0, total: selectedSongs.length, currentSong: '', addedCount: 0 }
  
  const sources: MusicSource[] = ['netease', 'kuwo', 'kugou']
  let firstTrackIndex = -1
  
  for (let i = 0; i < selectedSongs.length; i++) {
    const song = selectedSongs[i]
    addingProgress.value.current = i + 1
    addingProgress.value.currentSong = `${song.title} - ${song.artist}`
    
    for (const source of sources) {
      try {
        const results = await searchSongs(source, `${song.title} ${song.artist}`, 5)
        const match = results.find(r => r.name.toLowerCase().includes(song.title.toLowerCase()) || song.title.toLowerCase().includes(r.name.toLowerCase())) || results[0]
        if (match) { 
          song.searchResult = match
          const track = searchResultToTrack(match)
          playerStore.addTrack(track)
          addingProgress.value.addedCount++
          if (firstTrackIndex === -1) firstTrackIndex = playerStore.playlist.length - 1
          break 
        }
      } catch { continue }
    }
  }
  
  if (firstTrackIndex !== -1) playerStore.playTrack(firstTrackIndex)
  
  const addedCount = addingProgress.value.addedCount
  showToast(addedCount > 0 ? `🎵 已添加 ${addedCount} 首歌曲` : '未能找到可播放的歌曲', addedCount > 0 ? 'success' : 'error')
  
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
  
  const sources: MusicSource[] = ['netease', 'kuwo', 'kugou']
  
  for (let i = 0; i < selectedSongs.length; i++) {
    const song = selectedSongs[i]
    addingProgress.value.current = i + 1
    addingProgress.value.currentSong = `${song.title} - ${song.artist}`
    
    if (!song.searchResult) {
      for (const source of sources) {
        try {
          const results = await searchSongs(source, `${song.title} ${song.artist}`, 5)
          const match = results.find(r => r.name.toLowerCase().includes(song.title.toLowerCase()) || song.title.toLowerCase().includes(r.name.toLowerCase())) || results[0]
          if (match) { song.searchResult = match; break }
        } catch { continue }
      }
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

    <div class="px-4 pt-4 pb-8">
      <!-- 非沉浸模式：显示角色选择和输入框 -->
      <template v-if="!isImmersive">
        <!-- 顶部：角色 + 设置 -->
        <div class="flex items-center gap-3 mb-4">
          <button @click="showRoleSelector = !showRoleSelector" class="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10 flex-1">
            <span class="text-xl">{{ currentRole.avatar }}</span>
            <span class="text-white text-sm font-medium flex-1 text-left truncate">{{ currentRole.name }}</span>
            <svg class="w-4 h-4 text-white/40" :class="showRoleSelector && 'rotate-180'" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
            </svg>
          </button>
          <button @click="showPreferences = true" class="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
            </svg>
          </button>
        </div>

        <!-- 角色选择器 -->
        <Transition name="slide">
          <div v-if="showRoleSelector" class="mb-4 p-3 rounded-xl bg-black/50 border border-white/10">
            <div class="grid grid-cols-4 gap-2">
              <button v-for="role in AI_ROLES" :key="role.id" @click="selectRole(role)" :class="['p-2.5 rounded-xl text-center transition-all', currentRole.id === role.id ? 'bg-purple-600/30 border border-purple-500/50' : 'bg-white/5 hover:bg-white/10']">
                <span class="text-xl block mb-1">{{ role.avatar }}</span>
                <span class="text-white text-[10px] block truncate">{{ role.name }}</span>
              </button>
            </div>
          </div>
        </Transition>
      </template>

      <!-- 输入框（非沉浸模式） -->
      <template v-if="!isImmersive">
        <div class="flex gap-2 mb-4">
          <div class="flex-1 relative">
            <input v-model="userInput" type="text" :placeholder="`想听什么？问问 ${currentRole.name}`" class="w-full h-12 pl-4 pr-10 rounded-xl bg-white/5 text-white placeholder-white/30 outline-none border border-white/10 focus:border-purple-500/50 text-sm" @keyup.enter="getRecommendations" :disabled="loading"/>
            <button v-if="userInput" @click="userInput = ''" class="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-white/10 flex items-center justify-center text-white/40">
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
          <button @click="getRecommendations" :disabled="loading || !userInput.trim()" :class="['h-12 w-12 rounded-xl flex items-center justify-center transition-all', userInput.trim() && !loading ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white' : 'bg-white/10 text-white/30']">
            <svg v-if="!loading" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
            <div v-else class="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
          </button>
        </div>

        <!-- 未配置提示 -->
        <div v-if="!isAIConfigured()" class="mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center gap-3">
          <span class="text-amber-400">⚠️</span>
          <span class="text-amber-200 text-xs">请先在设置中配置 AI API Key</span>
        </div>

        <!-- 错误提示 -->
        <div v-if="error" class="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-2">
          <span class="text-red-400">❌</span>
          <span class="text-red-200 text-xs">{{ error }}</span>
        </div>
      </template>

      <!-- 快捷提示（仅在空闲状态显示） -->
      <div v-if="thinkingPhase === 'idle' && !loading && !isImmersive" class="mb-4">
        <p class="text-white/40 text-xs mb-2">快捷选择</p>
        <div class="flex flex-wrap gap-2">
          <button v-for="item in quickPrompts" :key="item.label" @click="useQuickPrompt(item.prompt)" class="px-3 py-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white text-xs transition-all flex items-center gap-1.5">
            <span>{{ item.icon }}</span>
            <span>{{ item.label }}</span>
          </button>
        </div>
      </div>

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

          <!-- AI 说明 -->
          <div v-if="aiReason" class="mb-3 p-3 rounded-xl bg-purple-500/10 border border-purple-500/20">
            <p class="text-white/70 text-xs leading-relaxed">{{ aiReason }}</p>
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
            <button @click="startSearching" :disabled="selectedCount === 0" class="flex flex-col items-center gap-1 px-4 py-1.5 rounded-xl hover:bg-white/5 disabled:opacity-40 transition-colors group">
              <div class="w-10 h-10 rounded-full bg-purple-600 flex items-center justify-center group-hover:bg-purple-500 transition-colors">
                <svg class="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
              </div>
              <span class="text-white/70 text-xs">播放</span>
            </button>
            <button @click="showPlaylistModal = true" :disabled="selectedCount === 0" class="flex flex-col items-center gap-1 px-4 py-1.5 rounded-xl hover:bg-white/5 disabled:opacity-40 transition-colors group">
              <div class="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center group-hover:bg-blue-600/20 transition-colors">
                <svg class="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
              </div>
              <span class="text-white/70 text-xs">收藏</span>
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
  </div>
</template>

<style scoped>
.slide-enter-active, .slide-leave-active { transition: all 0.2s ease; }
.slide-enter-from, .slide-leave-to { opacity: 0; transform: translateY(-10px); }

.slide-up-enter-active, .slide-up-leave-active { transition: all 0.3s ease; }
.slide-up-enter-from, .slide-up-leave-to { opacity: 0; transform: translateY(100%); }

.fade-enter-active, .fade-leave-active { transition: all 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.toast-enter-active, .toast-leave-active { transition: all 0.3s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translate(-50%, -20px); }

.safe-area-bottom { padding-bottom: env(safe-area-inset-bottom, 0px); }

::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 2px; }
</style>
