<script setup lang="ts">
import { ref, computed } from 'vue'
import { usePlayerStore } from '@/store/player'
import { usePlaylistStore } from '@/store/playlist'
import { searchSongs, searchResultToTrack, type MusicSource } from '@/services/source/OnlineApiSource'
import { getAIRecommendations, isAIConfigured, AI_ROLES, getCurrentRole, setCurrentRole, type AIRole } from '@/services/ai/AIService'
import { trackStorage } from '@/services/TrackStorage'

const playerStore = usePlayerStore()
const playlistStore = usePlaylistStore()

// 状态
const userInput = ref('')
const loading = ref(false)
const error = ref('')
const currentRole = ref<AIRole>(getCurrentRole())
const recommendations = ref<{ title: string; artist: string; selected?: boolean; searchResult?: any }[]>([])
const addingProgress = ref({ current: 0, total: 0 })
const aiReason = ref('')

// Toast
const toast = ref({ show: false, message: '', icon: '✓' })
function showToast(msg: string, icon = '✓') {
  toast.value = { show: true, message: msg, icon }
  setTimeout(() => { toast.value.show = false }, 2500)
}

// 选中数量
const selectedCount = computed(() => recommendations.value.filter(s => s.selected !== false).length)

// 场景标签 - 更精致的设计
const scenes = [
  { icon: '☀️', label: '早晨', prompt: '推荐适合早晨听的清新音乐', gradient: 'from-amber-400 to-orange-500' },
  { icon: '💼', label: '专注', prompt: '推荐适合专注工作的音乐', gradient: 'from-blue-400 to-indigo-500' },
  { icon: '�', llabel: '放松', prompt: '推荐放松舒缓的音乐', gradient: 'from-emerald-400 to-teal-500' },
  { icon: '🏃', label: '运动', prompt: '推荐适合运动的动感音乐', gradient: 'from-rose-400 to-pink-500' },
  { icon: '🌙', label: '夜晚', prompt: '推荐适合夜晚的音乐', gradient: 'from-violet-400 to-purple-500' },
  { icon: '❤️', label: '心情', prompt: '推荐治愈心情的音乐', gradient: 'from-pink-400 to-rose-500' },
]

// 切换角色
function selectRole(role: AIRole) {
  currentRole.value = role
  setCurrentRole(role.id)
  recommendations.value = []
  aiReason.value = ''
}

// 获取推荐
async function getRecommendations(prompt?: string) {
  const query = prompt || userInput.value.trim()
  if (!query) { error.value = '告诉我你想听什么吧'; return }
  if (!isAIConfigured()) { error.value = '请先在设置中配置 AI'; return }

  if (prompt) userInput.value = prompt
  loading.value = true
  error.value = ''
  recommendations.value = []
  aiReason.value = ''
  
  try {
    const result = await getAIRecommendations(query, {}, currentRole.value)
    if (!result?.songs.length) { error.value = '没有找到推荐，换个描述试试'; return }
    recommendations.value = result.songs.map(s => ({ ...s, selected: true }))
    aiReason.value = result.reason || ''
  } catch (e: any) {
    error.value = e.message || '获取推荐失败'
  } finally {
    loading.value = false
  }
}

// 播放选中歌曲
async function playSelected() {
  const selected = recommendations.value.filter(s => s.selected !== false)
  if (!selected.length) return
  
  loading.value = true
  addingProgress.value = { current: 0, total: selected.length }
  const sources: MusicSource[] = ['netease', 'kuwo', 'kugou']
  let firstIdx = -1
  let added = 0
  
  for (let i = 0; i < selected.length; i++) {
    const song = selected[i]
    addingProgress.value.current = i + 1
    
    for (const source of sources) {
      try {
        const results = await searchSongs(source, `${song.title} ${song.artist}`, 5)
        const match = results.find(r => 
          r.name.toLowerCase().includes(song.title.toLowerCase()) || 
          song.title.toLowerCase().includes(r.name.toLowerCase())
        ) || results[0]
        if (match) {
          song.searchResult = match
          const track = searchResultToTrack(match)
          playerStore.addTrack(track)
          added++
          if (firstIdx === -1) firstIdx = playerStore.playlist.length - 1
          break
        }
      } catch { continue }
    }
  }
  
  if (firstIdx !== -1) playerStore.playTrack(firstIdx)
  showToast(added > 0 ? `已添加 ${added} 首歌曲` : '未找到可播放歌曲', added > 0 ? '🎵' : '😢')
  loading.value = false
  addingProgress.value = { current: 0, total: 0 }
}

// 添加到歌单
const showPlaylistModal = ref(false)
async function addToPlaylist(playlistId: string) {
  const selected = recommendations.value.filter(s => s.selected !== false)
  if (!selected.length) { showPlaylistModal.value = false; return }
  
  showPlaylistModal.value = false
  loading.value = true
  addingProgress.value = { current: 0, total: selected.length }
  const sources: MusicSource[] = ['netease', 'kuwo', 'kugou']
  let added = 0
  
  for (let i = 0; i < selected.length; i++) {
    const song = selected[i]
    addingProgress.value.current = i + 1
    
    if (!song.searchResult) {
      for (const source of sources) {
        try {
          const results = await searchSongs(source, `${song.title} ${song.artist}`, 5)
          const match = results.find(r => 
            r.name.toLowerCase().includes(song.title.toLowerCase()) || 
            song.title.toLowerCase().includes(r.name.toLowerCase())
          ) || results[0]
          if (match) { song.searchResult = match; break }
        } catch { continue }
      }
    }
    
    if (song.searchResult) {
      const track = searchResultToTrack(song.searchResult)
      playerStore.addTrack(track)
      trackStorage.saveTrack(track)
      playlistStore.addToPlaylist(playlistId, track.id)
      added++
    }
  }
  
  const name = playlistStore.playlists.find(p => p.id === playlistId)?.name || '歌单'
  showToast(added > 0 ? `已收藏到「${name}」` : '未找到可添加歌曲', added > 0 ? '💜' : '😢')
  loading.value = false
  addingProgress.value = { current: 0, total: 0 }
}

// 切换选中
function toggleSelect(idx: number) {
  recommendations.value[idx].selected = recommendations.value[idx].selected === false
}

// 全选/取消
function toggleAll() {
  const allSelected = selectedCount.value === recommendations.value.length
  recommendations.value.forEach(s => s.selected = !allSelected)
}
</script>

<template>
  <div class="flex-1 overflow-y-auto bg-gradient-to-b from-slate-900 via-slate-900 to-black min-h-0">
    <!-- Toast -->
    <Transition name="toast">
      <div v-if="toast.show" class="fixed top-16 left-1/2 -translate-x-1/2 z-50">
        <div class="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-white/10 backdrop-blur-xl border border-white/20 shadow-xl">
          <span class="text-lg">{{ toast.icon }}</span>
          <span class="text-white text-sm font-medium">{{ toast.message }}</span>
        </div>
      </div>
    </Transition>

    <div class="px-4 py-5 max-w-lg mx-auto">
      <!-- 顶部装饰 -->
      <div class="absolute top-0 left-0 right-0 h-64 overflow-hidden pointer-events-none">
        <div class="absolute -top-32 left-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-purple-600/20 rounded-full blur-[100px]"></div>
      </div>

      <!-- AI 助手卡片 -->
      <div class="relative mb-6">
        <div class="p-4 rounded-3xl bg-gradient-to-br from-white/10 to-white/5 backdrop-blur-xl border border-white/10 shadow-2xl">
          <!-- 角色头像和信息 -->
          <div class="flex items-center gap-4 mb-4">
            <div class="relative">
              <div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-2xl shadow-lg shadow-purple-500/30 ring-2 ring-white/20">
                {{ currentRole.avatar }}
              </div>
              <div class="absolute -bottom-1 -right-1 w-5 h-5 bg-green-500 rounded-full border-2 border-slate-900 flex items-center justify-center">
                <div class="w-2 h-2 bg-white rounded-full animate-pulse"></div>
              </div>
            </div>
            <div class="flex-1">
              <h2 class="text-white font-bold text-lg">{{ currentRole.name }}</h2>
              <p class="text-white/50 text-sm">{{ currentRole.greeting || '让我为你推荐好听的音乐' }}</p>
            </div>
          </div>
          
          <!-- 角色切换 -->
          <div class="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
            <button
              v-for="role in AI_ROLES"
              :key="role.id"
              @click="selectRole(role)"
              :class="[
                'flex items-center gap-1.5 px-3 py-1.5 rounded-xl whitespace-nowrap transition-all duration-300',
                currentRole.id === role.id
                  ? 'bg-white/20 text-white shadow-lg'
                  : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/70'
              ]"
            >
              <span>{{ role.avatar }}</span>
              <span class="text-xs font-medium">{{ role.name }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 输入区域 -->
      <div class="relative mb-5">
        <div class="relative">
          <input
            v-model="userInput"
            type="text"
            :placeholder="`想听什么？`"
            class="w-full h-14 pl-5 pr-14 rounded-2xl bg-white/5 text-white placeholder-white/30 outline-none border border-white/10 focus:border-purple-500/50 focus:bg-white/10 transition-all text-base"
            @keyup.enter="getRecommendations()"
            :disabled="loading"
          />
          <button
            @click="getRecommendations()"
            :disabled="loading || !userInput.trim()"
            :class="[
              'absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300',
              userInput.trim() && !loading 
                ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg shadow-purple-500/30 hover:shadow-purple-500/50 hover:scale-105' 
                : 'bg-white/10 text-white/30'
            ]"
          >
            <svg v-if="!loading" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
            </svg>
            <div v-else class="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
          </button>
        </div>
      </div>

      <!-- 场景标签 -->
      <div v-if="!loading && !recommendations.length" class="mb-6">
        <p class="text-white/40 text-xs mb-3 px-1">✨ 选择一个场景</p>
        <div class="grid grid-cols-3 gap-2">
          <button
            v-for="scene in scenes"
            :key="scene.label"
            @click="getRecommendations(scene.prompt)"
            class="group relative overflow-hidden p-4 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/20 transition-all duration-300"
          >
            <div :class="['absolute inset-0 opacity-0 group-hover:opacity-20 transition-opacity bg-gradient-to-br', scene.gradient]"></div>
            <div class="relative text-center">
              <span class="text-2xl block mb-1 group-hover:scale-110 transition-transform duration-300">{{ scene.icon }}</span>
              <span class="text-white/70 group-hover:text-white text-xs font-medium transition-colors">{{ scene.label }}</span>
            </div>
          </button>
        </div>
      </div>

      <!-- 未配置提示 -->
      <div v-if="!isAIConfigured()" class="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 mb-4">
        <div class="flex items-center gap-3">
          <span class="text-2xl">⚙️</span>
          <div>
            <p class="text-amber-200 text-sm font-medium">需要配置 AI</p>
            <p class="text-amber-200/60 text-xs">请在设置中添加 API Key</p>
          </div>
        </div>
      </div>

      <!-- 错误提示 -->
      <Transition name="fade">
        <div v-if="error" class="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 mb-4">
          <div class="flex items-center gap-3">
            <span class="text-xl">😅</span>
            <p class="text-red-200 text-sm">{{ error }}</p>
          </div>
        </div>
      </Transition>

      <!-- 加载动画 -->
      <Transition name="fade">
        <div v-if="loading && !recommendations.length" class="py-16 text-center">
          <div class="relative w-20 h-20 mx-auto mb-4">
            <!-- 外圈 -->
            <div class="absolute inset-0 rounded-full border-2 border-purple-500/20"></div>
            <!-- 旋转圈 -->
            <div class="absolute inset-0 rounded-full border-2 border-transparent border-t-purple-500 animate-spin"></div>
            <!-- 头像 -->
            <div class="absolute inset-2 rounded-full bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
              <span class="text-3xl animate-bounce">{{ currentRole.avatar }}</span>
            </div>
          </div>
          <p class="text-white/60 text-sm">{{ currentRole.name }} 正在挑选...</p>
          <div class="flex justify-center gap-1 mt-3">
            <span class="w-1.5 h-1.5 bg-purple-500 rounded-full animate-bounce" style="animation-delay: 0ms"></span>
            <span class="w-1.5 h-1.5 bg-purple-500 rounded-full animate-bounce" style="animation-delay: 150ms"></span>
            <span class="w-1.5 h-1.5 bg-purple-500 rounded-full animate-bounce" style="animation-delay: 300ms"></span>
          </div>
        </div>
      </Transition>

      <!-- 添加进度 -->
      <Transition name="fade">
        <div v-if="loading && addingProgress.total > 0" class="py-12 text-center">
          <div class="relative w-24 h-24 mx-auto mb-4">
            <svg class="w-full h-full -rotate-90">
              <circle cx="48" cy="48" r="44" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="4"/>
              <circle 
                cx="48" cy="48" r="44" fill="none" 
                stroke="url(#progressGradient)" stroke-width="4" stroke-linecap="round"
                :stroke-dasharray="276.46"
                :stroke-dashoffset="276.46 * (1 - addingProgress.current / addingProgress.total)"
                class="transition-all duration-300"
              />
              <defs>
                <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stop-color="#a855f7"/>
                  <stop offset="100%" stop-color="#ec4899"/>
                </linearGradient>
              </defs>
            </svg>
            <div class="absolute inset-0 flex items-center justify-center">
              <span class="text-white text-lg font-bold">{{ addingProgress.current }}/{{ addingProgress.total }}</span>
            </div>
          </div>
          <p class="text-white/60 text-sm">正在添加歌曲...</p>
        </div>
      </Transition>

      <!-- 推荐结果 -->
      <Transition name="slide">
        <div v-if="!loading && recommendations.length" class="space-y-4">
          <!-- AI 说明 -->
          <div v-if="aiReason" class="p-4 rounded-2xl bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20">
            <div class="flex gap-3">
              <span class="text-xl flex-shrink-0">💬</span>
              <p class="text-white/70 text-sm leading-relaxed">{{ aiReason }}</p>
            </div>
          </div>

          <!-- 歌曲列表 -->
          <div class="rounded-3xl bg-white/5 border border-white/10 overflow-hidden">
            <!-- 标题栏 -->
            <div class="flex items-center justify-between px-4 py-3 border-b border-white/5">
              <div class="flex items-center gap-2">
                <span class="text-lg">🎧</span>
                <span class="text-white font-medium">为你推荐</span>
                <span class="text-white/30 text-sm">{{ recommendations.length }}首</span>
              </div>
              <button @click="toggleAll" class="text-xs text-purple-400 hover:text-purple-300 transition-colors px-2 py-1 rounded-lg hover:bg-white/5">
                {{ selectedCount === recommendations.length ? '取消全选' : '全选' }}
              </button>
            </div>
            
            <!-- 列表 -->
            <div class="divide-y divide-white/5 max-h-80 overflow-y-auto">
              <div
                v-for="(song, idx) in recommendations"
                :key="idx"
                @click="toggleSelect(idx)"
                :class="[
                  'flex items-center gap-3 px-4 py-3.5 cursor-pointer transition-all duration-200 group',
                  song.selected !== false ? 'bg-purple-500/5 hover:bg-purple-500/10' : 'hover:bg-white/5 opacity-50'
                ]"
              >
                <!-- 序号/勾选 -->
                <div class="relative w-8 h-8 flex-shrink-0">
                  <div :class="[
                    'absolute inset-0 rounded-lg flex items-center justify-center transition-all duration-300',
                    song.selected !== false 
                      ? 'bg-gradient-to-br from-purple-500 to-pink-500 shadow-lg shadow-purple-500/20' 
                      : 'bg-white/10'
                  ]">
                    <svg v-if="song.selected !== false" class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/>
                    </svg>
                    <span v-else class="text-white/40 text-xs font-medium">{{ idx + 1 }}</span>
                  </div>
                </div>
                
                <!-- 歌曲信息 -->
                <div class="flex-1 min-w-0">
                  <p :class="['text-sm font-medium truncate transition-colors', song.selected !== false ? 'text-white' : 'text-white/50']">
                    {{ song.title }}
                  </p>
                  <p class="text-white/40 text-xs truncate mt-0.5">{{ song.artist }}</p>
                </div>
                
                <!-- 音符图标 -->
                <div v-if="song.selected !== false" class="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <svg class="w-4 h-4 text-purple-400" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z"/>
                  </svg>
                </div>
              </div>
            </div>
          </div>

          <!-- 底部操作 -->
          <div class="flex gap-3">
            <button
              @click="playSelected"
              :disabled="selectedCount === 0"
              :class="[
                'flex-1 h-14 rounded-2xl font-medium transition-all duration-300 flex items-center justify-center gap-2',
                selectedCount > 0 
                  ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-xl shadow-purple-500/30 hover:shadow-purple-500/50 hover:scale-[1.02] active:scale-[0.98]' 
                  : 'bg-white/10 text-white/30'
              ]"
            >
              <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"/>
              </svg>
              <span>播放 {{ selectedCount > 0 ? selectedCount + ' 首' : '' }}</span>
            </button>
            
            <button
              @click="showPlaylistModal = true"
              :disabled="selectedCount === 0"
              :class="[
                'w-14 h-14 rounded-2xl transition-all duration-300 flex items-center justify-center',
                selectedCount > 0 
                  ? 'bg-white/10 text-white hover:bg-white/20 hover:scale-105 active:scale-95' 
                  : 'bg-white/5 text-white/30'
              ]"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/>
              </svg>
            </button>
            
            <button
              @click="getRecommendations()"
              class="w-14 h-14 rounded-2xl bg-white/10 text-white hover:bg-white/20 transition-all duration-300 flex items-center justify-center hover:scale-105 active:scale-95"
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
              </svg>
            </button>
          </div>
        </div>
      </Transition>
    </div>

    <!-- 歌单选择弹窗 -->
    <Transition name="modal">
      <div v-if="showPlaylistModal" class="fixed inset-0 z-50 flex items-end justify-center" @click.self="showPlaylistModal = false">
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>
        <div class="relative w-full max-w-lg bg-gradient-to-b from-slate-800 to-slate-900 rounded-t-[2rem] border-t border-white/10 overflow-hidden">
          <!-- 拖动条 -->
          <div class="flex justify-center pt-3 pb-2">
            <div class="w-10 h-1 bg-white/20 rounded-full"></div>
          </div>
          
          <!-- 标题 -->
          <div class="px-5 pb-4 flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg">
                <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/>
                </svg>
              </div>
              <div>
                <h3 class="text-white font-semibold">收藏到歌单</h3>
                <p class="text-white/40 text-xs">{{ selectedCount }} 首歌曲</p>
              </div>
            </div>
            <button @click="showPlaylistModal = false" class="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/50 hover:text-white transition-all">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>
          
          <!-- 歌单列表 -->
          <div class="max-h-72 overflow-y-auto px-3 pb-8">
            <div v-if="!playlistStore.playlists.length" class="py-12 text-center">
              <div class="w-16 h-16 mx-auto mb-3 rounded-2xl bg-white/5 flex items-center justify-center">
                <span class="text-3xl">📁</span>
              </div>
              <p class="text-white/50 text-sm">还没有歌单</p>
              <p class="text-white/30 text-xs mt-1">去「我的」创建一个吧</p>
            </div>
            <div v-else class="space-y-2">
              <button
                v-for="pl in playlistStore.playlists"
                :key="pl.id"
                @click="addToPlaylist(pl.id)"
                class="w-full p-3 flex items-center gap-3 rounded-2xl bg-white/5 hover:bg-white/10 transition-all duration-200 group"
              >
                <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center group-hover:scale-105 transition-transform">
                  <span class="text-xl">🎵</span>
                </div>
                <div class="flex-1 min-w-0 text-left">
                  <p class="text-white text-sm font-medium truncate">{{ pl.name }}</p>
                  <p class="text-white/40 text-xs">{{ pl.trackIds.length }} 首歌曲</p>
                </div>
                <svg class="w-5 h-5 text-white/20 group-hover:text-purple-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<template>
  <div class="flex-1 flex flex-col bg-gradient-to-b from-slate-900 to-black min-h-0 overflow-hidden">
    <!-- Toast -->
    <Transition name="toast">
      <div v-if="toast.show" class="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 rounded-full bg-black/80 backdrop-blur-xl border border-white/10 shadow-xl">
        <span>{{ toast.icon }}</span>
        <span class="text-white text-sm">{{ toast.message }}</span>
      </div>
    </Transition>

    <!-- ===== 初始状态 ===== -->
    <div v-if="!hasResults" class="flex-1 overflow-y-auto px-4 py-6">
      <div class="max-w-md mx-auto">
        <!-- AI 卡片 -->
        <div class="mb-6 p-4 rounded-3xl bg-white/5 border border-white/10">
          <div class="flex items-center gap-3 mb-4">
            <div class="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-xl shadow-lg">
              {{ currentRole.avatar }}
            </div>
            <div class="flex-1">
              <h2 class="text-white font-semibold">{{ currentRole.name }}</h2>
              <p class="text-white/40 text-xs">{{ currentRole.greeting || '让我为你推荐音乐' }}</p>
            </div>
          </div>
          <div class="flex gap-2 overflow-x-auto scrollbar-hide">
            <button v-for="role in AI_ROLES" :key="role.id" @click="selectRole(role)"
              :class="['px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-all', currentRole.id === role.id ? 'bg-purple-500 text-white' : 'bg-white/5 text-white/50 hover:bg-white/10']">
              {{ role.avatar }} {{ role.name }}
            </button>
          </div>
        </div>

        <!-- 输入框 -->
        <div class="relative mb-5">
          <input v-model="userInput" type="text" placeholder="想听什么？" :disabled="loading"
            class="w-full h-12 pl-4 pr-12 rounded-2xl bg-white/5 text-white placeholder-white/30 border border-white/10 focus:border-purple-500/50 outline-none transition-all"
            @keyup.enter="getRecommendations()" />
          <button @click="getRecommendations()" :disabled="loading || !userInput.trim()"
            :class="['absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-xl flex items-center justify-center transition-all', userInput.trim() && !loading ? 'bg-purple-500 text-white' : 'bg-white/10 text-white/30']">
            <svg v-if="!loading" class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
            <div v-else class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
          </button>
        </div>

        <!-- 场景 -->
        <div v-if="!loading" class="grid grid-cols-3 gap-2">
          <button v-for="s in scenes" :key="s.label" @click="getRecommendations(s.prompt)"
            :class="['p-3 rounded-2xl text-center transition-all hover:scale-105', s.color]">
            <span class="text-xl block mb-1">{{ s.icon }}</span>
            <span class="text-white/70 text-xs">{{ s.label }}</span>
          </button>
        </div>

        <!-- 加载 -->
        <div v-if="loading" class="py-16 text-center">
          <div class="w-16 h-16 mx-auto mb-3 rounded-full border-2 border-purple-500/30 border-t-purple-500 animate-spin"></div>
          <p class="text-white/50 text-sm">{{ currentRole.name }} 正在挑选...</p>
        </div>

        <!-- 提示 -->
        <div v-if="!isAIConfigured()" class="mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-200 text-sm">
          ⚙️ 请先在设置中配置 AI
        </div>
        <div v-if="error" class="mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-sm">
          {{ error }}
        </div>
      </div>
    </div>
