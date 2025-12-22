<script setup lang="ts">
import { ref, computed } from 'vue'
import { usePlayerStore } from '@/store/player'
import { usePlaylistStore } from '@/store/playlist'
import { searchSongs, searchResultToTrack, type MusicSource } from '@/services/source/OnlineApiSource'
import { getAIRecommendations, isAIConfigured, AI_ROLES, getCurrentRole, setCurrentRole, loadPreferences, savePreferences, LANGUAGE_OPTIONS, ERA_OPTIONS, MOOD_OPTIONS, VOCAL_OPTIONS, type AIRole, type AIPreferences } from '@/services/ai/AIService'
import { trackStorage } from '@/services/TrackStorage'

const playerStore = usePlayerStore()
const playlistStore = usePlaylistStore()

function getFavorites(): string[] { return JSON.parse(localStorage.getItem('favorites') || '[]') }
function isFavorite(trackId: string): boolean { return getFavorites().includes(trackId) }
function toggleFavorite(trackId: string, track?: any) {
  const ids = getFavorites()
  const favData = JSON.parse(localStorage.getItem('favorites_data') || '[]')
  const idx = ids.indexOf(trackId)
  if (idx >= 0) {
    ids.splice(idx, 1)
    const dataIdx = favData.findIndex((t: any) => t.id === trackId)
    if (dataIdx >= 0) favData.splice(dataIdx, 1)
  } else {
    ids.push(trackId)
    // 保存完整歌曲数据
    if (track && !favData.some((t: any) => t.id === trackId)) {
      favData.push(track)
    }
  }
  localStorage.setItem('favorites', JSON.stringify(ids))
  localStorage.setItem('favorites_data', JSON.stringify(favData))
}

const showPlaylistModal = ref(false)
const selectedSongForPlaylist = ref<any>(null)
const isAddAllMode = ref(false)

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
const error = ref('')
const aiReason = ref('')
const thinkingText = ref('')
const thinkingPhase = ref<'thinking' | 'searching' | 'done'>('thinking')
const recommendations = ref<{ title: string; artist: string; searchResult?: any }[]>([])
const searchProgress = ref({ current: 0, total: 0, currentSong: '' })

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
  searchProgress.value = { current: 0, total: 0, currentSong: '' }
  try {
    const result = await getAIRecommendations(userInput.value, { onThinking: (text) => { thinkingText.value = text } }, currentRole.value)
    if (!result || result.songs.length === 0) { error.value = 'AI 没有返回推荐结果，请换个描述试试'; loading.value = false; return }
    aiReason.value = result.reason
    recommendations.value = result.songs.map(s => ({ ...s }))
    thinkingPhase.value = 'searching'
    searchProgress.value.total = result.songs.length
    const sources: MusicSource[] = ['netease', 'kuwo', 'kugou']
    for (let i = 0; i < recommendations.value.length; i++) {
      const song = recommendations.value[i]
      searchProgress.value.current = i + 1
      searchProgress.value.currentSong = `${song.title} - ${song.artist}`
      for (const source of sources) {
        try {
          const results = await searchSongs(source, `${song.title} ${song.artist}`, 5)
          const match = results.find(r => r.name.toLowerCase().includes(song.title.toLowerCase()) || song.title.toLowerCase().includes(r.name.toLowerCase())) || results[0]
          if (match) { song.searchResult = match; break }
        } catch { continue }
      }
    }
    thinkingPhase.value = 'done'
  } catch (e: any) { error.value = e.message || '获取推荐失败' }
  finally { loading.value = false }
}

function useQuickPrompt(prompt: string) { userInput.value = prompt; getRecommendations() }
function playSong(song: any) {
  if (!song.searchResult) return
  const track = searchResultToTrack(song.searchResult)
  playerStore.addTrack(track)
  playerStore.playTrack(playerStore.playlist.length - 1)
}
function addToPlaylist(song: any) {
  if (!song.searchResult) return
  playerStore.addTrack(searchResultToTrack(song.searchResult))
}
function addAll() { recommendations.value.forEach(song => { if (song.searchResult) playerStore.addTrack(searchResultToTrack(song.searchResult)) }) }
function playAll() {
  const validSongs = recommendations.value.filter(s => s.searchResult)
  if (validSongs.length === 0) return
  validSongs.forEach((song, idx) => {
    playerStore.addTrack(searchResultToTrack(song.searchResult))
    if (idx === 0) playerStore.playTrack(playerStore.playlist.length - 1)
  })
}
function _refreshRecommendations() { if (userInput.value.trim()) getRecommendations() }
void _refreshRecommendations
function reset() { userInput.value = ''; recommendations.value = []; aiReason.value = ''; thinkingText.value = ''; error.value = '' }
</script>

<template>
  <div class="flex-1 overflow-y-auto bg-gradient-to-b from-slate-900 via-slate-900 to-black">
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
                <div>
                  <span class="text-white font-medium">{{ currentRole.name }}</span>
                  <span class="text-purple-300 text-sm ml-2">正在思考...</span>
                </div>
              </div>
              <div class="relative pl-4 border-l-2 border-purple-500/30">
                <div class="text-white/70 text-sm font-mono whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">
                  {{ thinkingText || '分析你的需求中...' }}
                  <span class="inline-block w-2 h-4 bg-purple-400 ml-1 animate-pulse"></span>
                </div>
              </div>
            </div>
          </div>
        </Transition>

        <!-- 搜索进度 -->
        <Transition name="fade">
          <div v-if="loading && thinkingPhase === 'searching'" class="mb-5">
            <div class="p-5 rounded-2xl bg-gradient-to-br from-green-500/10 to-emerald-500/10 border border-green-500/20 backdrop-blur-xl">
              <div class="flex items-center gap-3 mb-4">
                <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-green-500 to-emerald-500 flex items-center justify-center">
                  <svg class="w-5 h-5 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                </div>
                <div>
                  <span class="text-white font-medium">搜索歌曲</span>
                  <span class="text-green-300 text-sm ml-2">{{ searchProgress.current }}/{{ searchProgress.total }}</span>
                </div>
              </div>
              <p class="text-white/50 text-sm mb-3 truncate flex items-center gap-2">
                <svg class="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                </svg>
                {{ searchProgress.currentSong }}
              </p>
              <div class="h-2 bg-white/10 rounded-full overflow-hidden">
                <div
                  class="h-full bg-gradient-to-r from-green-500 to-emerald-500 transition-all duration-500 ease-out rounded-full"
                  :style="{ width: `${(searchProgress.current / searchProgress.total) * 100}%` }"
                ></div>
              </div>
            </div>
          </div>
        </Transition>

        <!-- 推荐结果 -->
        <Transition name="fade">
          <div v-if="!loading && recommendations.length > 0">
            <!-- AI 推荐理由 -->
            <div v-if="aiReason" class="mb-4 p-4 rounded-2xl bg-gradient-to-br from-purple-500/10 to-pink-500/10 border border-purple-500/20">
              <div class="flex items-start gap-3">
                <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-sm flex-shrink-0">
                  {{ currentRole.avatar }}
                </div>
                <p class="text-purple-200/90 text-sm leading-relaxed">{{ aiReason }}</p>
              </div>
            </div>

            <!-- 操作栏 -->
            <div class="flex items-center justify-between mb-4 p-3 rounded-xl bg-white/5 border border-white/10">
              <div class="flex items-center gap-2">
                <div class="w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center">
                  <svg class="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/>
                  </svg>
                </div>
                <span class="text-white/60 text-sm">
                  找到 <span class="text-green-400 font-medium">{{ recommendations.filter(s => s.searchResult).length }}</span> / {{ recommendations.length }} 首
                </span>
              </div>
              <div class="flex gap-2">
                <button @click="playAll" class="px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white text-xs font-medium transition-all shadow-lg shadow-purple-500/20 flex items-center gap-1.5">
                  <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"/>
                  </svg>
                  播放全部
                </button>
                <button @click="addAll" class="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition-all flex items-center gap-1.5">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                  </svg>
                  全部添加
                </button>
                <button @click="reset" class="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/60 hover:text-white text-xs font-medium transition-all flex items-center gap-1.5">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                  </svg>
                  重选
                </button>
              </div>
            </div>

            <!-- 歌曲列表 -->
            <div class="space-y-1">
              <div
                v-for="(song, index) in recommendations"
                :key="`${song.title}-${song.artist}`"
                :class="[
                  'group relative flex items-center gap-4 p-3 rounded-xl transition-all duration-200',
                  song.searchResult 
                    ? 'hover:bg-white/10 cursor-pointer' 
                    : 'opacity-40 cursor-not-allowed'
                ]"
                @click="song.searchResult && playSong(song)"
              >
                <!-- 序号 -->
                <div class="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-white/30 text-sm font-medium group-hover:bg-purple-500/20 group-hover:text-purple-300 transition-all">
                  {{ index + 1 }}
                </div>
                
                <!-- 歌曲信息 -->
                <div class="flex-1 min-w-0">
                  <p class="text-white text-sm font-medium truncate group-hover:text-purple-200 transition-colors">{{ song.title }}</p>
                  <p class="text-white/40 text-xs truncate">{{ song.artist }}</p>
                </div>
                
                <!-- 状态/操作 -->
                <div class="flex items-center gap-2">
                  <span v-if="!song.searchResult" class="px-2 py-1 rounded-lg bg-red-500/10 text-red-400/60 text-xs">未找到</span>
                  <template v-else>
                    <button
                      @click.stop="toggleFavorite(song.searchResult.id, searchResultToTrack(song.searchResult))"
                      class="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-all opacity-0 group-hover:opacity-100"
                    >
                      <svg :class="isFavorite(song.searchResult.id) ? 'text-pink-500' : 'text-white/40'" class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clip-rule="evenodd"/>
                      </svg>
                    </button>
                    <button
                      @click.stop="addToPlaylist(song)"
                      class="w-8 h-8 rounded-lg bg-white/5 hover:bg-purple-500/20 flex items-center justify-center transition-all opacity-0 group-hover:opacity-100"
                    >
                      <svg class="w-4 h-4 text-white/60 hover:text-purple-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                      </svg>
                    </button>
                    <button
                      @click.stop="playSong(song)"
                      class="w-8 h-8 rounded-lg bg-purple-500/20 hover:bg-purple-500/40 flex items-center justify-center transition-all opacity-0 group-hover:opacity-100"
                    >
                      <svg class="w-4 h-4 text-purple-300" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"/>
                      </svg>
                    </button>
                  </template>
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
