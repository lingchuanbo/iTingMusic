<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { usePlayerStore } from '@/store/player'
import { soulService } from '@/services/SoulService'
import { getAIRecommendations, getCurrentRole } from '@/services/ai/AIService'
import { searchAndMatch } from '@/utils/songMatcher'
import { searchResultToTrack } from '@/services/source/OnlineApiSource'
import { audioPlayer } from '@/services/player/AudioPlayer'
import { isRandomListenOpen } from '@/store/ui'

const emit = defineEmits(['close'])

const playerStore = usePlayerStore()
const currentRole = ref(getCurrentRole())

const loading = ref(true)
const recommendations = ref<any[]>([])
const currentSongIndex = ref(0)
const thinkingText = ref('正在感应你的心灵频率...')

// 反馈追踪
const feedbackMap = ref<Record<string, 'like' | 'dislike'>>({})

// Toast
const activeToast = ref({ show: false, message: '', type: 'success' as 'success' | 'info' })

// 标记无法播放的歌曲
const unavailableSongs = ref<Set<string>>(new Set())

// 音乐偏好设置
const showPreferences = ref(false)
const PREFERENCE_KEY = 'random_listen_preferences'

const defaultPreferences = {
  languages: ['chinese'] as string[],
  genres: [] as string[]
}

const loadPreferences = () => {
  try {
    const saved = localStorage.getItem(PREFERENCE_KEY)
    if (saved) return { ...defaultPreferences, ...JSON.parse(saved) }
  } catch (e) {}
  return defaultPreferences
}

const preferences = ref(loadPreferences())

const savePreferences = () => {
  localStorage.setItem(PREFERENCE_KEY, JSON.stringify(preferences.value))
}

const toggleLanguage = (lang: string) => {
  const idx = preferences.value.languages.indexOf(lang)
  if (idx >= 0) {
    preferences.value.languages.splice(idx, 1)
  } else {
    preferences.value.languages.push(lang)
  }
  savePreferences()
}

const toggleGenre = (genre: string) => {
  const idx = preferences.value.genres.indexOf(genre)
  if (idx >= 0) {
    preferences.value.genres.splice(idx, 1)
  } else {
    preferences.value.genres.push(genre)
  }
  savePreferences()
}

const languageOptions = [
  { id: 'chinese', label: '华语' },
  { id: 'english', label: '英文' },
  { id: 'japanese', label: '日语' },
  { id: 'korean', label: '韩语' },
  { id: 'cantonese', label: '粤语' }
]

const genreOptions = [
  { id: 'pop', label: '流行' },
  { id: 'rock', label: '摇滚' },
  { id: 'hiphop', label: '说唱' },
  { id: 'electronic', label: '电子' },
  { id: 'folk', label: '民谣' },
  { id: 'classical', label: '古典' },
  { id: 'jazz', label: '爵士' },
  { id: 'rnb', label: 'R&B' }
]

// 当前展示的歌曲
const currentSong = computed(() => recommendations.value[currentSongIndex.value])

// 封面图片
const coverImage = computed(() => {
  return playerStore.currentTrack?.cover || ''
})

// 进度相关 - 用于环形进度条
const progressPercent = computed(() => {
  if (playerStore.duration <= 0) return 0
  return (playerStore.currentTime / playerStore.duration) * 100
})

// 环形进度条的 stroke-dashoffset
const progressOffset = computed(() => {
  const circumference = 2 * Math.PI * 140 // 半径140
  return circumference - (progressPercent.value / 100) * circumference
})

// 快照原始状态
onMounted(async () => {
  isRandomListenOpen.value = true
  soulService.captureSnapshot(playerStore.playlist, playerStore.currentIndex)
  await fetchRandomRecommendations(true)
})

onUnmounted(() => {
  isRandomListenOpen.value = false
  const snapshot = soulService.getSnapshot()
  if (snapshot) {
    playerStore.setPlaylist(snapshot.playlist)
    if (snapshot.index !== -1) {
      playerStore.playTrack(snapshot.index)
    }
    soulService.clearSnapshot()
  }
})

const fetchRandomRecommendations = async (autoPlayFirst = false) => {
  loading.value = true
  thinkingText.value = '正在连通音乐星云...'
  
  try {
    const soulContext = soulService.getSoulContextPrompt()
    
    // 构建偏好提示
    let preferenceHint = ''
    if (preferences.value.languages.length > 0) {
      const langMap: Record<string, string> = {
        chinese: '华语',
        english: '英文',
        japanese: '日语',
        korean: '韩语',
        cantonese: '粤语'
      }
      const langs = preferences.value.languages.map((l: string) => langMap[l] || l).join('、')
      preferenceHint += `请主要推荐${langs}歌曲。`
    }
    if (preferences.value.genres.length > 0) {
      const genreMap: Record<string, string> = {
        pop: '流行',
        rock: '摇滚',
        hiphop: '说唱',
        electronic: '电子',
        folk: '民谣',
        classical: '古典',
        jazz: '爵士',
        rnb: 'R&B'
      }
      const genres = preferences.value.genres.map((g: string) => genreMap[g] || g).join('、')
      preferenceHint += `风格偏好：${genres}。`
    }
    
    const prompt = `[心灵感应模式] ${soulContext} ${preferenceHint}\n请为我推荐一套能够产生深度共鸣的曲目。`
    
    const result = await getAIRecommendations(prompt, {
      onThinking: (text) => { thinkingText.value = text }
    }, currentRole.value)
    
    if (result && result.songs.length > 0) {
      recommendations.value = result.songs.slice(0, 10)
      currentSongIndex.value = 0
      
      if (autoPlayFirst && recommendations.value.length > 0) {
        playSong(recommendations.value[0], true)
      }
    }
  } catch (e) {
    console.error('Random recommendations failed:', e)
  } finally {
    loading.value = false
  }
}

const playSong = async (song: any, autoNextOnFail = false) => {
  if (unavailableSongs.value.has(song.title)) {
    if (autoNextOnFail) skipToNext()
    return
  }

  const match = await searchAndMatch(song.title, song.artist)
  if (match) {
    const track = searchResultToTrack(match)
    
    const allTracks = await Promise.all(recommendations.value.map(async s => {
      if (s.title === song.title) return track
      return { title: s.title, artist: s.artist, id: Math.random().toString(), cover: '', url: '' } as any
    }))
    
    playerStore.setPlaylist(allTracks)
    const idx = recommendations.value.findIndex(s => s.title === song.title)
    playerStore.playTrack(idx)
    currentSongIndex.value = idx
    
    soulService.evolve({ resonance: 0.8 }, 0.05)
  } else {
    unavailableSongs.value.add(song.title)
    showToast(`「${song.title}」暂无音源，正在切换...`, 'info')
    if (autoNextOnFail) skipToNext()
  }
}

const skipToNext = () => {
  for (let i = currentSongIndex.value + 1; i < recommendations.value.length; i++) {
    if (!unavailableSongs.value.has(recommendations.value[i].title)) {
      playSong(recommendations.value[i], true)
      return
    }
  }
  showToast('本批歌曲已播完，正在换一批...', 'info')
  fetchRandomRecommendations(true)
}

const togglePlay = () => {
  audioPlayer.toggle()
}

const handleLike = () => {
  if (!currentSong.value) return
  if (feedbackMap.value[currentSong.value.title] === 'like') {
    delete feedbackMap.value[currentSong.value.title]
    return
  }
  
  feedbackMap.value[currentSong.value.title] = 'like'
  soulService.recordFeedback(`${currentSong.value.title} - ${currentSong.value.artist}`, true)
  showToast('✨ 已添加到喜欢', 'success')
}

const showToast = (message: string, type: 'success' | 'info') => {
  activeToast.value = { show: true, message, type }
  setTimeout(() => { activeToast.value.show = false }, 2000)
}

const close = () => {
  emit('close')
}

watch(() => playerStore.currentIndex, (newIdx) => {
  if (newIdx !== currentSongIndex.value && newIdx < recommendations.value.length) {
    currentSongIndex.value = newIdx
  }
})
</script>

<template>
  <Transition name="fade-scale" appear>
    <div class="fixed inset-0 z-[100] overflow-hidden flex flex-col select-none">
      <!-- Animated Background -->
      <div class="absolute inset-0 z-0 vinyl-bg">
        <!-- Animated Ambient Blobs -->
        <div class="absolute top-[-20%] left-[-10%] w-[60vh] h-[60vh] blob-1 rounded-full pointer-events-none"></div>
        <div class="absolute bottom-[-15%] right-[-15%] w-[70vh] h-[70vh] blob-2 rounded-full pointer-events-none"></div>
        <div class="absolute top-[40%] left-[50%] w-[40vh] h-[40vh] blob-3 rounded-full pointer-events-none"></div>
      </div>
      
      <!-- Toast -->
      <Transition name="fade-up">
        <div v-if="activeToast.show" class="fixed top-12 left-1/2 -translate-x-1/2 z-[110] px-5 py-2.5 rounded-2xl bg-white/10 backdrop-blur-2xl border border-white/10 shadow-2xl flex items-center gap-2.5">
          <span class="text-xs font-medium text-white/80">{{ activeToast.message }}</span>
        </div>
      </Transition>

      <!-- Preferences Modal -->
      <Transition name="fade-up">
        <div v-if="showPreferences" class="fixed inset-0 z-[120] flex items-center justify-center p-6" @click.self="showPreferences = false">
          <div class="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>
          <div class="relative w-full max-w-sm bg-zinc-900/95 backdrop-blur-2xl rounded-3xl border border-white/10 shadow-2xl p-6 space-y-6">
            <!-- Header -->
            <div class="flex items-center justify-between">
              <h3 class="text-lg font-bold text-white">音乐偏好</h3>
              <button @click="showPreferences = false" class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/20 transition-all">
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <!-- Language Selection -->
            <div>
              <p class="text-xs uppercase tracking-widest text-white/40 font-bold mb-3">语言</p>
              <div class="flex flex-wrap gap-2">
                <button 
                  v-for="lang in languageOptions" 
                  :key="lang.id"
                  @click="toggleLanguage(lang.id)"
                  :class="[
                    'px-4 py-2 rounded-xl text-sm font-medium transition-all active:scale-95',
                    preferences.languages.includes(lang.id) 
                      ? 'bg-pink-500 text-white shadow-lg shadow-pink-500/20' 
                      : 'bg-white/10 text-white/60 hover:bg-white/20'
                  ]"
                >
                  {{ lang.label }}
                </button>
              </div>
            </div>
            
            <!-- Genre Selection -->
            <div>
              <p class="text-xs uppercase tracking-widest text-white/40 font-bold mb-3">风格 <span class="text-white/20">(可选)</span></p>
              <div class="flex flex-wrap gap-2">
                <button 
                  v-for="genre in genreOptions" 
                  :key="genre.id"
                  @click="toggleGenre(genre.id)"
                  :class="[
                    'px-4 py-2 rounded-xl text-sm font-medium transition-all active:scale-95',
                    preferences.genres.includes(genre.id) 
                      ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/20' 
                      : 'bg-white/10 text-white/60 hover:bg-white/20'
                  ]"
                >
                  {{ genre.label }}
                </button>
              </div>
            </div>
            
            <!-- Apply Button -->
            <button 
              @click="showPreferences = false; fetchRandomRecommendations(true)"
              class="w-full py-3 rounded-2xl bg-gradient-to-r from-pink-500 to-purple-500 text-white font-bold text-sm shadow-lg shadow-pink-500/20 hover:shadow-xl transition-all active:scale-98"
            >
              应用并刷新
            </button>
          </div>
        </div>
      </Transition>

      <!-- Main Container -->
      <div class="relative z-10 flex flex-col h-full w-full max-w-md mx-auto">
        
        <!-- Top Bar -->
        <header class="flex items-center justify-between p-6 pt-8">
          <button @click="close" class="text-white/60 hover:text-white transition-colors flex items-center justify-center size-10 rounded-full hover:bg-white/10 active:scale-95">
            <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          
          <!-- Title -->
          <div class="flex-1 text-center">
            <h1 class="text-2xl font-black tracking-tighter text-white">随便听听</h1>
            <p class="text-[9px] uppercase tracking-[0.3em] text-pink-400/60 font-bold">Random Resonance</p>
          </div>
          
          <!-- Actions -->
          <div class="flex items-center gap-1">
            <button @click="showPreferences = true" class="text-white/60 hover:text-white transition-colors flex items-center justify-center size-10 rounded-full hover:bg-white/10 active:scale-95">
              <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
            </button>
            <button @click="fetchRandomRecommendations(true)" :disabled="loading" class="text-white/60 hover:text-white transition-colors flex items-center justify-center size-10 rounded-full hover:bg-white/10 active:scale-95 disabled:opacity-50">
              <svg :class="['w-5 h-5', loading ? 'animate-spin' : '']" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </header>

        <!-- Main Content -->
        <main class="flex-1 flex flex-col items-center justify-center w-full px-6 relative">
          
          <!-- Loading State -->
          <div v-if="loading" class="flex flex-col items-center justify-center gap-8">
            <div class="relative w-24 h-24">
              <div class="absolute inset-0 bg-pink-500/10 rounded-full animate-ping opacity-20"></div>
              <div class="absolute inset-0 border-2 border-dashed border-white/10 rounded-full animate-spin-slow"></div>
              <div class="absolute inset-0 flex items-center justify-center">
                <svg class="w-8 h-8 text-pink-400 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
              </div>
            </div>
            <p class="text-[10px] uppercase tracking-[0.4em] text-white/30 font-medium animate-pulse">{{ thinkingText }}</p>
          </div>

          <!-- Vinyl Player -->
          <template v-else>
            <div class="relative flex flex-col items-center">
              
              <!-- Vinyl Disc Container -->
              <div class="relative w-72 h-72 flex items-center justify-center">
                
                <!-- Neon Glow Effect -->
                <div :class="['absolute w-60 h-60 rounded-full neon-glow', playerStore.isPlaying ? 'neon-glow-active' : '']"></div>
                
                <!-- Progress Ring (SVG) -->
                <svg class="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 300 300">
                  <!-- Background ring -->
                  <circle 
                    cx="150" cy="150" r="140" 
                    fill="none" 
                    stroke="rgba(255,255,255,0.1)" 
                    stroke-width="6"
                  />
                  <!-- Progress ring -->
                  <circle 
                    cx="150" cy="150" r="140" 
                    fill="none" 
                    stroke="url(#progressGradient)" 
                    stroke-width="6"
                    stroke-linecap="round"
                    :stroke-dasharray="2 * Math.PI * 140"
                    :stroke-dashoffset="progressOffset"
                    class="transition-all duration-300"
                  />
                  <defs>
                    <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stop-color="#06b6d4" />
                      <stop offset="100%" stop-color="#22d3ee" />
                    </linearGradient>
                  </defs>
                </svg>

                <!-- Vinyl Disc -->
                <div :class="['vinyl-disc', playerStore.isPlaying ? 'animate-spin-vinyl' : '']">
                  <!-- Vinyl grooves -->
                  <div class="absolute inset-2 rounded-full border border-white/5"></div>
                  <div class="absolute inset-6 rounded-full border border-white/5"></div>
                  <div class="absolute inset-10 rounded-full border border-white/5"></div>
                  <div class="absolute inset-14 rounded-full border border-white/5"></div>
                  
                  <!-- Center hole -->
                  <div class="absolute inset-0 flex items-center justify-center">
                    <div class="w-4 h-4 rounded-full bg-zinc-900"></div>
                  </div>
                  
                  <!-- Album Cover (circular) -->
                  <div class="absolute inset-0 flex items-center justify-center">
                    <div 
                      class="w-28 h-28 rounded-full shadow-2xl overflow-hidden border-4 border-zinc-900"
                      :style="coverImage ? { backgroundImage: `url('${coverImage}')`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}"
                    >
                      <div v-if="!coverImage" class="w-full h-full bg-gradient-to-br from-amber-200 via-orange-100 to-amber-300 flex items-center justify-center">
                        <svg class="w-10 h-10 text-amber-600/50" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z"/>
                        </svg>
                      </div>
                    </div>
                  </div>
                </div>
                
                <!-- Like Button (positioned on right) -->
                <button 
                  @click="handleLike"
                  :class="[
                    'absolute right-0 top-1/2 translate-x-4 -translate-y-1/2 w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-all active:scale-95',
                    feedbackMap[currentSong?.title] === 'like' 
                      ? 'bg-pink-500 text-white' 
                      : 'bg-zinc-800/80 text-pink-400 hover:bg-zinc-700/80'
                  ]"
                >
                  <svg class="w-5 h-5" viewBox="0 0 24 24" :fill="feedbackMap[currentSong?.title] === 'like' ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                  </svg>
                </button>
              </div>

              <!-- Song Info -->
              <div class="mt-10 text-center">
                <h1 class="text-2xl font-bold tracking-wide text-white uppercase">
                  {{ currentSong?.title || playerStore.currentTrack?.title || '等待中...' }}
                </h1>
                <p class="mt-2 text-pink-400 font-medium tracking-wide">
                  {{ currentSong?.artist || playerStore.currentTrack?.artist || '' }}
                </p>
              </div>
            </div>
          </template>
        </main>

        <!-- Bottom Controls -->
        <footer class="flex items-center justify-between px-12 pb-12 pt-6">
          <!-- Play Button -->
          <button 
            @click="togglePlay"
            class="w-16 h-16 rounded-full bg-pink-500 text-white shadow-lg shadow-pink-500/30 flex items-center justify-center hover:bg-pink-400 transition-all active:scale-95"
          >
            <svg v-if="playerStore.isPlaying" class="w-7 h-7" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
            </svg>
            <svg v-else class="w-7 h-7 ml-1" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z"/>
            </svg>
          </button>
          
          <!-- Next Button -->
          <button 
            @click="skipToNext"
            class="w-12 h-12 rounded-full bg-zinc-800/60 text-white/80 flex items-center justify-center hover:bg-zinc-700/60 transition-all active:scale-95"
          >
            <svg class="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>
            </svg>
          </button>
        </footer>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* Background */
.vinyl-bg {
  background: linear-gradient(180deg, #1a1a2e 0%, #16213e 30%, #0f0f23 70%, #1a0a1a 100%);
  overflow: hidden;
}

/* Animated Blobs */
.blob-1 {
  background: radial-gradient(circle, rgba(236, 72, 153, 0.25) 0%, rgba(236, 72, 153, 0) 70%);
  filter: blur(80px);
  animation: blob-float-1 12s ease-in-out infinite;
}

.blob-2 {
  background: radial-gradient(circle, rgba(34, 211, 238, 0.2) 0%, rgba(34, 211, 238, 0) 70%);
  filter: blur(80px);
  animation: blob-float-2 15s ease-in-out infinite;
}

.blob-3 {
  background: radial-gradient(circle, rgba(139, 92, 246, 0.15) 0%, rgba(139, 92, 246, 0) 70%);
  filter: blur(60px);
  animation: blob-float-3 10s ease-in-out infinite;
}

@keyframes blob-float-1 {
  0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.3; }
  33% { transform: translate(30px, -20px) scale(1.1); opacity: 0.5; }
  66% { transform: translate(-20px, 20px) scale(0.95); opacity: 0.35; }
}

@keyframes blob-float-2 {
  0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.25; }
  50% { transform: translate(-40px, 30px) scale(1.15); opacity: 0.4; }
}

@keyframes blob-float-3 {
  0%, 100% { transform: translate(-50%, 0) scale(1); opacity: 0.2; }
  50% { transform: translate(-50%, -30px) scale(1.2); opacity: 0.35; }
}

/* Neon Glow under Vinyl - GPU Optimized */
.neon-glow {
  background: radial-gradient(circle, rgba(139, 92, 246, 0.6) 0%, rgba(139, 92, 246, 0.3) 40%, rgba(139, 92, 246, 0) 70%);
  opacity: 0.5;
  will-change: opacity;
  transform: translateZ(0);
  -webkit-transform: translateZ(0);
}

.neon-glow-active {
  animation: neon-pulse 2s ease-in-out infinite;
}

@keyframes neon-pulse {
  0%, 100% { 
    opacity: 0.5;
  }
  50% { 
    opacity: 1;
  }
}

/* Vinyl Disc */
.vinyl-disc {
  width: 240px;
  height: 240px;
  border-radius: 50%;
  background: linear-gradient(145deg, #2a2a2a 0%, #1a1a1a 50%, #0f0f0f 100%);
  box-shadow: 
    inset 0 0 60px rgba(0,0,0,0.8),
    0 10px 40px rgba(0,0,0,0.5);
  position: relative;
}



/* Vinyl Spin Animation */
.animate-spin-vinyl {
  animation: spin-vinyl 4s linear infinite;
}

@keyframes spin-vinyl {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* Loading Animation */
.animate-spin-slow { animation: spin-slow 12s linear infinite; }
@keyframes spin-slow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

/* Transitions */
.fade-scale-enter-active, .fade-scale-leave-active { transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1); }
.fade-scale-enter-from { opacity: 0; transform: scale(1.05); }
.fade-scale-leave-to { opacity: 0; transform: scale(0.95); }

.fade-up-enter-active, .fade-up-leave-active { transition: all 0.3s ease; }
.fade-up-enter-from, .fade-up-leave-to { opacity: 0; transform: translateX(-50%) translateY(-10px); }
</style>
