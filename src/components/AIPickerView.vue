<script setup lang="ts">
import { ref, computed } from 'vue'
import { usePlayerStore } from '@/store/player'
import {
  searchSongs,
  searchResultToTrack,
  type MusicSource
} from '@/services/source/OnlineApiSource'
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

const playerStore = usePlayerStore()

// 当前角色
const currentRole = ref<AIRole>(getCurrentRole())
const showRoleSelector = ref(false)

// 偏好设置
const preferences = ref<AIPreferences>(loadPreferences())
const showPreferences = ref(false)
const newFavoriteArtist = ref('')
const newDislikedArtist = ref('')

// 切换角色
function selectRole(role: AIRole) {
  currentRole.value = role
  setCurrentRole(role.id)
  showRoleSelector.value = false
  recommendations.value = []
  thinkingText.value = ''
}

// 切换多选偏好
function togglePreference(key: 'languages' | 'eras' | 'moods' | 'vocals', value: string) {
  const arr = preferences.value[key]
  const idx = arr.indexOf(value)
  if (idx >= 0) {
    arr.splice(idx, 1)
  } else {
    arr.push(value)
  }
  savePreferences(preferences.value)
}

// 添加喜欢的歌手
function addFavoriteArtist() {
  const artist = newFavoriteArtist.value.trim()
  if (artist && !preferences.value.favoriteArtists.includes(artist)) {
    preferences.value.favoriteArtists.push(artist)
    savePreferences(preferences.value)
  }
  newFavoriteArtist.value = ''
}

// 移除喜欢的歌手
function removeFavoriteArtist(artist: string) {
  const idx = preferences.value.favoriteArtists.indexOf(artist)
  if (idx >= 0) {
    preferences.value.favoriteArtists.splice(idx, 1)
    savePreferences(preferences.value)
  }
}

// 添加不喜欢的歌手
function addDislikedArtist() {
  const artist = newDislikedArtist.value.trim()
  if (artist && !preferences.value.dislikedArtists.includes(artist)) {
    preferences.value.dislikedArtists.push(artist)
    savePreferences(preferences.value)
  }
  newDislikedArtist.value = ''
}

// 移除不喜欢的歌手
function removeDislikedArtist(artist: string) {
  const idx = preferences.value.dislikedArtists.indexOf(artist)
  if (idx >= 0) {
    preferences.value.dislikedArtists.splice(idx, 1)
    savePreferences(preferences.value)
  }
}

// 状态
const userInput = ref('')
const loading = ref(false)
const error = ref('')
const aiReason = ref('')
const thinkingText = ref('')
const thinkingPhase = ref<'thinking' | 'searching' | 'done'>('thinking')
const recommendations = ref<{ title: string; artist: string; searchResult?: any }[]>([])
const searchProgress = ref({ current: 0, total: 0, currentSong: '' })

// 根据角色生成快捷提示
const quickPrompts = computed(() => {
  const role = currentRole.value
  switch (role.id) {
    case 'rocker':
      return [
        { label: '经典摇滚', prompt: '推荐经典摇滚乐队的歌' },
        { label: '重金属', prompt: '来点重金属音乐' },
        { label: '独立摇滚', prompt: '推荐独立摇滚乐队' }
      ]
    case 'classical':
      return [
        { label: '钢琴曲', prompt: '推荐优美的钢琴曲' },
        { label: '交响乐', prompt: '推荐著名的交响乐' },
        { label: '电影配乐', prompt: '推荐经典电影配乐' }
      ]
    case 'hipster':
      return [
        { label: '最新热歌', prompt: '推荐最近最火的歌' },
        { label: '说唱', prompt: '推荐好听的说唱' },
        { label: '电子音乐', prompt: '推荐好听的电子音乐' }
      ]
    case 'folk':
      return [
        { label: '华语民谣', prompt: '推荐好听的华语民谣' },
        { label: '独立音乐', prompt: '推荐小众独立音乐' },
        { label: '吉他弹唱', prompt: '推荐适合吉他弹唱的歌' }
      ]
    case 'retro':
      return [
        { label: '90年代', prompt: '推荐90年代经典老歌' },
        { label: '粤语金曲', prompt: '推荐粤语经典金曲' },
        { label: '欧美经典', prompt: '推荐欧美经典老歌' }
      ]
    case 'chill':
      return [
        { label: '助眠', prompt: '推荐适合睡前听的音乐' },
        { label: '冥想', prompt: '推荐适合冥想的音乐' },
        { label: 'Lo-fi', prompt: '推荐好听的Lo-fi音乐' }
      ]
    case 'party':
      return [
        { label: 'EDM', prompt: '推荐嗨爆的EDM' },
        { label: '派对歌单', prompt: '推荐适合派对的歌' },
        { label: '蹦迪神曲', prompt: '推荐蹦迪神曲' }
      ]
    default:
      return [
        { label: '放松', prompt: '推荐放松的音乐' },
        { label: '工作', prompt: '推荐适合工作听的音乐' },
        { label: '运动', prompt: '推荐适合运动的音乐' }
      ]
  }
})

// 获取 AI 推荐
async function getRecommendations() {
  if (!userInput.value.trim()) {
    error.value = '请输入你想听什么样的音乐'
    return
  }

  if (!isAIConfigured()) {
    error.value = '请先在设置中配置 AI API Key'
    return
  }

  loading.value = true
  error.value = ''
  aiReason.value = ''
  thinkingText.value = ''
  thinkingPhase.value = 'thinking'
  recommendations.value = []
  searchProgress.value = { current: 0, total: 0, currentSong: '' }

  try {
    const result = await getAIRecommendations(
      userInput.value,
      {
        onThinking: (text) => {
          thinkingText.value = text
        }
      },
      currentRole.value
    )
    
    if (!result || result.songs.length === 0) {
      error.value = 'AI 没有返回推荐结果，请换个描述试试'
      loading.value = false
      return
    }

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
          const searchKey = `${song.title} ${song.artist}`
          const results = await searchSongs(source, searchKey, 5)
          
          const match = results.find(r => 
            r.name.toLowerCase().includes(song.title.toLowerCase()) ||
            song.title.toLowerCase().includes(r.name.toLowerCase())
          ) || results[0]
          
          if (match) {
            song.searchResult = match
            break
          }
        } catch {
          continue
        }
      }
    }
    
    thinkingPhase.value = 'done'
  } catch (e: any) {
    error.value = e.message || '获取推荐失败'
  } finally {
    loading.value = false
  }
}

function useQuickPrompt(prompt: string) {
  userInput.value = prompt
  getRecommendations()
}

function playSong(song: typeof recommendations.value[0]) {
  if (!song.searchResult) return
  const track = searchResultToTrack(song.searchResult)
  playerStore.addTrack(track)
  playerStore.playTrack(playerStore.playlist.length - 1)
}

function addToPlaylist(song: typeof recommendations.value[0]) {
  if (!song.searchResult) return
  const track = searchResultToTrack(song.searchResult)
  playerStore.addTrack(track)
}

function addAll() {
  recommendations.value.forEach(song => {
    if (song.searchResult) {
      const track = searchResultToTrack(song.searchResult)
      playerStore.addTrack(track)
    }
  })
}

function reset() {
  userInput.value = ''
  recommendations.value = []
  aiReason.value = ''
  thinkingText.value = ''
  error.value = ''
}
</script>

<template>
  <div class="flex-1 overflow-y-auto p-6">
    <!-- 角色卡片 -->
    <div class="mb-4">
      <div 
        @click="showRoleSelector = !showRoleSelector"
        class="inline-flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 cursor-pointer transition-colors"
      >
        <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-xl">
          {{ currentRole.avatar }}
        </div>
        <div class="flex-1">
          <div class="flex items-center gap-2">
            <span class="text-white font-medium">{{ currentRole.name }}</span>
            <span class="text-white/40 text-xs">{{ currentRole.description }}</span>
          </div>
          <p class="text-white/50 text-xs">{{ currentRole.greeting }}</p>
        </div>
        <span class="text-white/40">{{ showRoleSelector ? '▲' : '▼' }}</span>
      </div>

      <!-- 角色选择器 -->
      <Transition name="slide">
        <div v-if="showRoleSelector" class="mt-2 p-2 rounded-xl bg-black/40 backdrop-blur-xl border border-white/10">
          <p class="text-white/40 text-xs px-2 mb-2">选择 AI 角色，不同角色有不同的音乐品味</p>
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button
              v-for="role in AI_ROLES"
              :key="role.id"
              @click="selectRole(role)"
              :class="[
                'p-2 rounded-lg text-left transition-all',
                currentRole.id === role.id 
                  ? 'bg-purple-600/50 border border-purple-400' 
                  : 'bg-white/5 hover:bg-white/10 border border-transparent'
              ]"
            >
              <div class="flex items-center gap-2 mb-1">
                <span class="text-lg">{{ role.avatar }}</span>
                <span class="text-white text-sm font-medium">{{ role.name }}</span>
              </div>
              <p class="text-white/50 text-xs truncate">{{ role.description }}</p>
            </button>
          </div>
        </div>
      </Transition>
    </div>

    <!-- 偏好设置按钮 -->
    <div class="mb-4 flex items-center gap-2">
      <button
        @click="showPreferences = !showPreferences"
        :class="[
          'px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-1',
          showPreferences ? 'bg-purple-600 text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'
        ]"
      >
        ⚙️ 偏好设置
      </button>
      <!-- 当前偏好标签 -->
      <div class="flex flex-wrap gap-1">
        <span 
          v-for="lang in preferences.languages" 
          :key="lang"
          class="px-2 py-0.5 rounded-full bg-purple-500/30 text-purple-200 text-xs"
        >
          {{ LANGUAGE_OPTIONS.find(o => o.value === lang)?.label }}
        </span>
        <span 
          v-for="era in preferences.eras" 
          :key="era"
          class="px-2 py-0.5 rounded-full bg-blue-500/30 text-blue-200 text-xs"
        >
          {{ ERA_OPTIONS.find(o => o.value === era)?.label }}
        </span>
        <span 
          v-for="mood in preferences.moods" 
          :key="mood"
          class="px-2 py-0.5 rounded-full bg-green-500/30 text-green-200 text-xs"
        >
          {{ MOOD_OPTIONS.find(o => o.value === mood)?.label }}
        </span>
        <span 
          v-for="vocal in preferences.vocals" 
          :key="vocal"
          class="px-2 py-0.5 rounded-full bg-orange-500/30 text-orange-200 text-xs"
        >
          {{ VOCAL_OPTIONS.find(o => o.value === vocal)?.label }}
        </span>
      </div>
    </div>

    <!-- 偏好设置面板 -->
    <Transition name="slide">
      <div v-if="showPreferences" class="mb-4 p-4 rounded-xl bg-black/40 backdrop-blur-xl border border-white/10 space-y-4">
        <!-- 语言偏好（多选） -->
        <div>
          <p class="text-white/60 text-xs mb-2">🌍 语言偏好 <span class="text-white/30">（可多选）</span></p>
          <div class="flex flex-wrap gap-1">
            <button
              v-for="opt in LANGUAGE_OPTIONS"
              :key="opt.value"
              @click="togglePreference('languages', opt.value)"
              :class="[
                'px-3 py-1 rounded-full text-xs transition-colors',
                preferences.languages.includes(opt.value)
                  ? 'bg-purple-600 text-white'
                  : 'bg-white/5 text-white/60 hover:bg-white/10'
              ]"
            >
              {{ opt.icon }} {{ opt.label }}
            </button>
          </div>
        </div>

        <!-- 年代偏好（多选） -->
        <div>
          <p class="text-white/60 text-xs mb-2">📅 年代偏好 <span class="text-white/30">（可多选）</span></p>
          <div class="flex flex-wrap gap-1">
            <button
              v-for="opt in ERA_OPTIONS"
              :key="opt.value"
              @click="togglePreference('eras', opt.value)"
              :class="[
                'px-3 py-1 rounded-full text-xs transition-colors',
                preferences.eras.includes(opt.value)
                  ? 'bg-blue-600 text-white'
                  : 'bg-white/5 text-white/60 hover:bg-white/10'
              ]"
            >
              {{ opt.icon }} {{ opt.label }}
            </button>
          </div>
        </div>

        <!-- 情绪偏好（多选） -->
        <div>
          <p class="text-white/60 text-xs mb-2">🎭 情绪偏好 <span class="text-white/30">（可多选）</span></p>
          <div class="flex flex-wrap gap-1">
            <button
              v-for="opt in MOOD_OPTIONS"
              :key="opt.value"
              @click="togglePreference('moods', opt.value)"
              :class="[
                'px-3 py-1 rounded-full text-xs transition-colors',
                preferences.moods.includes(opt.value)
                  ? 'bg-green-600 text-white'
                  : 'bg-white/5 text-white/60 hover:bg-white/10'
              ]"
            >
              {{ opt.icon }} {{ opt.label }}
            </button>
          </div>
        </div>

        <!-- 人声偏好（多选） -->
        <div>
          <p class="text-white/60 text-xs mb-2">🎤 人声偏好 <span class="text-white/30">（可多选）</span></p>
          <div class="flex flex-wrap gap-1">
            <button
              v-for="opt in VOCAL_OPTIONS"
              :key="opt.value"
              @click="togglePreference('vocals', opt.value)"
              :class="[
                'px-3 py-1 rounded-full text-xs transition-colors',
                preferences.vocals.includes(opt.value)
                  ? 'bg-orange-600 text-white'
                  : 'bg-white/5 text-white/60 hover:bg-white/10'
              ]"
            >
              {{ opt.icon }} {{ opt.label }}
            </button>
          </div>
        </div>

        <!-- 喜欢的歌手 -->
        <div>
          <p class="text-white/60 text-xs mb-2">❤️ 喜欢的歌手</p>
          <div class="flex flex-wrap gap-1 mb-2">
            <span
              v-for="artist in preferences.favoriteArtists"
              :key="artist"
              class="px-2 py-1 rounded-full bg-green-600/30 text-green-300 text-xs flex items-center gap-1"
            >
              {{ artist }}
              <button @click="removeFavoriteArtist(artist)" class="hover:text-white">×</button>
            </span>
            <span v-if="preferences.favoriteArtists.length === 0" class="text-white/30 text-xs">暂无</span>
          </div>
          <div class="flex gap-2">
            <input
              v-model="newFavoriteArtist"
              type="text"
              placeholder="添加歌手名"
              class="flex-1 h-8 px-3 rounded-lg bg-white/10 text-white text-xs placeholder-white/30 outline-none"
              @keyup.enter="addFavoriteArtist"
            />
            <button @click="addFavoriteArtist" class="px-3 h-8 rounded-lg bg-white/10 text-white text-xs hover:bg-white/20">+</button>
          </div>
        </div>

        <!-- 不喜欢的歌手 -->
        <div>
          <p class="text-white/60 text-xs mb-2">💔 不喜欢的歌手（会避免推荐）</p>
          <div class="flex flex-wrap gap-1 mb-2">
            <span
              v-for="artist in preferences.dislikedArtists"
              :key="artist"
              class="px-2 py-1 rounded-full bg-red-600/30 text-red-300 text-xs flex items-center gap-1"
            >
              {{ artist }}
              <button @click="removeDislikedArtist(artist)" class="hover:text-white">×</button>
            </span>
            <span v-if="preferences.dislikedArtists.length === 0" class="text-white/30 text-xs">暂无</span>
          </div>
          <div class="flex gap-2">
            <input
              v-model="newDislikedArtist"
              type="text"
              placeholder="添加歌手名"
              class="flex-1 h-8 px-3 rounded-lg bg-white/10 text-white text-xs placeholder-white/30 outline-none"
              @keyup.enter="addDislikedArtist"
            />
            <button @click="addDislikedArtist" class="px-3 h-8 rounded-lg bg-white/10 text-white text-xs hover:bg-white/20">+</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 未配置提示 -->
    <div v-if="!isAIConfigured()" class="mb-4 p-3 rounded-lg bg-yellow-500/20 border border-yellow-500/30 text-yellow-200 text-sm">
      ⚠️ 请先在设置中配置 AI API Key
    </div>

    <!-- 输入区域 -->
    <div class="mb-4">
      <div class="flex gap-2">
        <input
          v-model="userInput"
          type="text"
          :placeholder="`问${currentRole.name}：想听什么歌？`"
          class="flex-1 h-10 px-4 rounded-xl bg-white/10 text-white placeholder-white/30 outline-none focus:bg-white/15"
          @keyup.enter="getRecommendations"
          :disabled="loading"
        />
        <button
          @click="getRecommendations"
          :disabled="loading || !userInput.trim()"
          class="px-5 h-10 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium disabled:opacity-50 transition-colors"
        >
          {{ loading ? '...' : '推荐' }}
        </button>
      </div>
    </div>

    <!-- 快捷提示 -->
    <div v-if="!loading && recommendations.length === 0" class="mb-4">
      <div class="flex flex-wrap gap-2">
        <button
          v-for="item in quickPrompts"
          :key="item.label"
          @click="useQuickPrompt(item.prompt)"
          class="px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-white/70 text-sm transition-colors"
        >
          {{ item.label }}
        </button>
      </div>
    </div>

    <!-- 错误提示 -->
    <div v-if="error" class="mb-4 p-3 rounded-lg bg-red-500/20 text-red-200 text-sm">
      {{ error }}
    </div>

    <!-- AI 思考过程 -->
    <div v-if="loading && thinkingPhase === 'thinking'" class="mb-4">
      <div class="p-4 rounded-xl bg-white/5 border border-white/10">
        <div class="flex items-center gap-2 mb-2">
          <span class="text-lg">{{ currentRole.avatar }}</span>
          <span class="text-white/60 text-sm">{{ currentRole.name }} 正在思考...</span>
        </div>
        <div class="text-white/80 text-sm font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">
          {{ thinkingText || '分析你的需求中...' }}
          <span class="animate-pulse">▊</span>
        </div>
      </div>
    </div>

    <!-- 搜索进度 -->
    <div v-if="loading && thinkingPhase === 'searching'" class="mb-4">
      <div class="p-4 rounded-xl bg-white/5 border border-white/10">
        <div class="flex items-center gap-2 mb-2">
          <div class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
          <span class="text-white/60 text-sm">搜索歌曲 ({{ searchProgress.current }}/{{ searchProgress.total }})</span>
        </div>
        <p class="text-white/50 text-sm truncate">🔍 {{ searchProgress.currentSong }}</p>
        <div class="mt-2 h-1 bg-white/10 rounded-full overflow-hidden">
          <div 
            class="h-full bg-purple-500 transition-all duration-300"
            :style="{ width: `${(searchProgress.current / searchProgress.total) * 100}%` }"
          ></div>
        </div>
      </div>
    </div>

    <!-- 推荐结果 -->
    <div v-if="!loading && recommendations.length > 0">
      <div v-if="aiReason" class="mb-3 p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
        <p class="text-purple-200 text-sm">{{ currentRole.avatar }} {{ aiReason }}</p>
      </div>

      <div class="flex items-center justify-between mb-3">
        <p class="text-white/40 text-sm">找到 {{ recommendations.filter(s => s.searchResult).length }}/{{ recommendations.length }} 首</p>
        <div class="flex gap-2">
          <button @click="addAll" class="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs">
            全部添加
          </button>
          <button @click="reset" class="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs">
            重选
          </button>
        </div>
      </div>

      <div class="space-y-1">
        <div
          v-for="(song, index) in recommendations"
          :key="`${song.title}-${song.artist}`"
          :class="[
            'group flex items-center gap-3 p-2 rounded-lg transition-colors',
            song.searchResult ? 'hover:bg-white/10 cursor-pointer' : 'opacity-40'
          ]"
          @click="song.searchResult && playSong(song)"
        >
          <span class="w-5 text-white/30 text-xs text-right">{{ index + 1 }}</span>
          <div class="flex-1 min-w-0">
            <p class="text-white text-sm truncate">{{ song.title }}</p>
            <p class="text-white/40 text-xs truncate">{{ song.artist }}</p>
          </div>
          <span v-if="!song.searchResult" class="text-red-400/60 text-xs">未找到</span>
          <button
            v-if="song.searchResult"
            @click.stop="addToPlaylist(song)"
            class="opacity-0 group-hover:opacity-100 px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white text-xs transition-all"
          >
            +
          </button>
        </div>
      </div>
    </div>
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
</style>
