<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { usePlayerStore } from '@/store/player'
import {
  getToplists,
  getToplistSongs,
  searchResultToTrack,
  getLyrics,
  getCoverUrl,
  getEnabledSources,
  type MusicSource,
  type ToplistItem,
  type SearchResult
} from '@/services/source/OnlineApiSource'
import { toplistJumpState } from '@/store/ui'
import { watch } from 'vue'

const store = usePlayerStore()

// 所有可用的音乐源配置
const allSources: { value: MusicSource; label: string; icon: string }[] = [
  { value: 'netease', label: '网易云', icon: '🎵' },
  { value: 'kuwo', label: '酷我', icon: '🎶' },
  { value: 'kugou', label: '酷狗', icon: '🎤' },
  { value: 'qq', label: 'QQ', icon: '🎧' },
  { value: 'migu', label: '咪咕', icon: '📻' }
]

// 只显示启用的音乐源
const sources = computed(() => {
  const enabled = getEnabledSources()
  return allSources.filter(s => enabled.includes(s.value))
})

// 状态
const currentSource = ref<MusicSource>(getEnabledSources()[0] || 'netease')
const toplists = ref<(ToplistItem & { cover?: string })[]>([])
const selectedList = ref<ToplistItem | null>(null)
const songs = ref<SearchResult[]>([])
const loading = ref(false)
const loadingSongs = ref(false)
const songLoadError = ref('')

// 计算当前榜单封面
const selectedListCover = computed(() => {
  if (songs.value.length > 0) {
    return songs.value[0].cover || getCoverUrl(songs.value[0].platform, songs.value[0].id, songs.value[0].pic_id)
  }
  return selectedList.value?.pic || ''
})

// 缓存配置
const CACHE_KEY_TOPLISTS = 'toplist_cache_lists_v2'
const CACHE_KEY_SONGS = 'toplist_cache_songs_v2'
const CACHE_KEY_TIME = 'toplist_cache_time_v2'
const CACHE_DURATION = 24 * 60 * 60 * 1000 // 24小时

// 检查缓存是否过期
function isCacheValid(): boolean {
  const cacheTime = localStorage.getItem(CACHE_KEY_TIME)
  if (!cacheTime) return false
  return Date.now() - parseInt(cacheTime) < CACHE_DURATION
}

// 从 localStorage 加载缓存
function loadCache() {
  if (!isCacheValid()) {
    // 缓存过期，清除
    localStorage.removeItem(CACHE_KEY_TOPLISTS)
    localStorage.removeItem(CACHE_KEY_SONGS)
    localStorage.removeItem(CACHE_KEY_TIME)
    return { toplists: {}, songs: {} }
  }
  try {
    const toplistsData = JSON.parse(localStorage.getItem(CACHE_KEY_TOPLISTS) || '{}')
    const songsData = JSON.parse(localStorage.getItem(CACHE_KEY_SONGS) || '{}')
    return { toplists: toplistsData, songs: songsData }
  } catch {
    return { toplists: {}, songs: {} }
  }
}

// 保存缓存到 localStorage
function saveToplistsCache(source: MusicSource, data: ToplistItem[]) {
  try {
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY_TOPLISTS) || '{}')
    cache[source] = data
    localStorage.setItem(CACHE_KEY_TOPLISTS, JSON.stringify(cache))
    if (!localStorage.getItem(CACHE_KEY_TIME)) {
      localStorage.setItem(CACHE_KEY_TIME, Date.now().toString())
    }
  } catch { /* ignore */ }
}

function saveSongsCache(cacheKey: string, data: SearchResult[]) {
  try {
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY_SONGS) || '{}')
    cache[cacheKey] = data
    localStorage.setItem(CACHE_KEY_SONGS, JSON.stringify(cache))
  } catch { /* ignore */ }
}

// 初始化缓存
const cachedData = loadCache()
const toplistsCache = ref<Record<string, ToplistItem[]>>(cachedData.toplists)
const songsCache = ref<Record<string, SearchResult[]>>(cachedData.songs)

async function loadToplists() {
  // 切换平台时重置选中状态
  selectedList.value = null

  // 检查缓存
  if (toplistsCache.value[currentSource.value]?.length) {
    toplists.value = toplistsCache.value[currentSource.value]
    return
  }

  // 无缓存时显示加载
  toplists.value = []
  loading.value = true
  try {
    const data = await getToplists(currentSource.value)
    // 初步设置数据
    toplists.value = data.map(item => ({ ...item, cover: item.pic || '' }))
    
    // 异步补充加载缺失的封面
    data.forEach(async (item, idx) => {
      if (toplists.value[idx].cover) return
      try {
        const songs = await getToplistSongs(currentSource.value, item.id)
        if (songs && songs.length > 0) {
          toplists.value[idx].cover = songs[0].cover || getCoverUrl(songs[0].platform, songs[0].id, songs[0].pic_id)
        }
      } catch (e) { console.warn(`获取榜单[${item.name}]预览封面失败:`, e) }
    })

    toplistsCache.value[currentSource.value] = toplists.value
    saveToplistsCache(currentSource.value, toplists.value)
  } finally {
    loading.value = false
  }
}

async function selectToplist(item: ToplistItem) {
  // 缓存 key: 平台+榜单ID
  const cacheKey = `${currentSource.value}_${item.id}`

  // 检查缓存 - 先设置数据再更新选中状态，避免闪烁
  if (songsCache.value[cacheKey]?.length) {
    songs.value = songsCache.value[cacheKey]
    selectedList.value = item
    songLoadError.value = ''
    return
  }

  // 无缓存时显示加载
  selectedList.value = item
  songs.value = []
  loadingSongs.value = true
  songLoadError.value = ''
  try {
    const data = await getToplistSongs(currentSource.value, item.id)
    if (!data || data.length === 0) {
      songLoadError.value = '榜单内容为空或加载失败'
    } else {
      songs.value = data
      songsCache.value[cacheKey] = data
      saveSongsCache(cacheKey, data)
    }
  } catch (e) {
    console.error('加载详情出错:', e)
    songLoadError.value = '网络请求失败，请稍后重试'
  } finally {
    loadingSongs.value = false
  }
}

function backToList() {
  selectedList.value = null
  // 不清空 songs，保留缓存数据以便快速切换
}

async function playSong(result: SearchResult) {
  const track = searchResultToTrack(result)
  getLyrics(result.platform, result.id).then(lrc => {
    const t = store.playlist.find(t => t.id === track.id)
    if (t) t.lrc = lrc
  })
  store.addTrack(track)
  store.playTrack(store.playlist.length - 1)
}

function addToPlaylist(result: SearchResult) {
  const track = searchResultToTrack(result)
  store.addTrack(track)
}

function addAllToPlaylist() {
  songs.value.forEach(song => {
    const track = searchResultToTrack(song)
    store.addTrack(track)
  })
}

// 全部播放：添加所有歌曲并开始播放第一首
function playAll() {
  if (songs.value.length === 0) return
  
  // 清空当前播放列表
  store.clearPlaylist()
  
  // 添加所有歌曲
  songs.value.forEach(song => {
    const track = searchResultToTrack(song)
    store.addTrack(track)
  })
  
  // 播放第一首
  store.playTrack(0)
  
  // 异步加载第一首歌的歌词
  const firstSong = songs.value[0]
  getLyrics(firstSong.platform, firstSong.id).then(lrc => {
    const t = store.playlist.find(t => t.id === store.currentTrack?.id)
    if (t) t.lrc = lrc
  })
}


// 处理跳转状态
async function handleJumpState() {
  if (toplistJumpState.value) {
    const { source, id } = toplistJumpState.value
    currentSource.value = source as MusicSource
    await loadToplists()
    
    const target = toplists.value.find(t => t.id === id)
    if (target) {
      selectToplist(target)
    }
    
    // 消费掉状态
    toplistJumpState.value = null
  }
}

watch(toplistJumpState, (val) => {
  if (val) handleJumpState()
})

onMounted(async () => {
  await loadToplists()
  handleJumpState()
})
</script>

<template>
  <div class="flex-1 overflow-hidden relative flex flex-col h-full bg-[#050505] text-white selection:bg-purple-500/30">
    <!-- 全屏动态背景 (Cinematic Modern Edition) -->
    <div class="absolute inset-0 pointer-events-none overflow-hidden">
      <!-- Mesh Gradients -->
      <div class="absolute -top-[10%] -left-[10%] w-[80vh] h-[80vh] bg-cyan-500/10 blur-[120px] rounded-full mix-blend-screen animate-pulse-slow"></div>
      <div class="absolute top-[20%] -right-[10%] w-[70vh] h-[70vh] bg-rose-600/10 blur-[100px] rounded-full mix-blend-screen animate-float"></div>
      <div class="absolute -bottom-[10%] left-[20%] w-[60vh] h-[60vh] bg-indigo-600/10 blur-[100px] rounded-full mix-blend-screen animate-pulse-slow"></div>
      
      <!-- List Cover Mood Light (Dynamic) -->
      <div v-if="selectedListCover" class="absolute inset-0 transition-opacity duration-1000">
         <img :src="selectedListCover" class="w-full h-full object-cover opacity-10 blur-[120px] scale-150" />
      </div>

      <!-- Overlays -->
      <div class="absolute inset-0 bg-gradient-to-b from-[#08080a]/40 via-transparent to-[#050505] opacity-90"></div>
      <div class="absolute inset-0 bg-noise opacity-[0.04] mix-blend-overlay"></div>
    </div>

    <!-- 顶部导航栏 (Editorial Style) -->
    <header class="relative z-30 px-6 pt-12 pb-6 flex items-center justify-between transition-all duration-700">
       <div class="flex items-center gap-6">
          <button v-if="selectedList" @click="backToList" class="w-12 h-12 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/60 transition-all border border-white/5 group/back">
             <svg class="w-6 h-6 group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7"/></svg>
          </button>
          <div>
             <div v-if="!selectedList" class="inline-block px-3 py-1 rounded-full bg-white/5 border border-white/10 backdrop-blur-md mb-4 animate-fade-in shadow-xl">
                <span class="text-[9px] uppercase tracking-[0.4em] text-cyan-400 font-black">Sonic Top Charts</span>
             </div>
             <h2 class="text-3xl md:text-5xl font-black text-white tracking-tighter flex items-center gap-3 filter drop-shadow-2xl whitespace-nowrap">
                <span class="truncate max-w-[50vw] md:max-w-none">{{ selectedList ? selectedList.name : '榜单巅峰' }}</span>
                <span v-if="!selectedList" class="text-[10px] uppercase tracking-[0.4em] text-white/20 font-bold ml-4 hidden md:inline">GLOBAL RANKINGS</span>
             </h2>
          </div>
       </div>
 
       <!-- 平台选择 (Permanent Luxury Tags) -->
       <div v-if="!selectedList" class="flex items-center gap-2 overflow-x-auto scrollbar-hide py-2 px-1 -mr-6 md:mr-0 max-w-[50vw] md:max-w-none">
          <button 
            v-for="s in sources" 
            :key="s.value"
            @click="currentSource = s.value; loadToplists()" 
            :class="['flex items-center gap-2 px-4 py-2 rounded-full transition-all duration-500 border backdrop-blur-3xl shadow-lg hover:scale-105 active:scale-95 whitespace-nowrap', 
                      currentSource === s.value ? 'bg-white text-black border-white shadow-[0_10px_30px_rgba(255,255,255,0.2)]' : 'bg-white/5 text-white/50 border-white/5 hover:bg-white/10 hover:text-white']"
          >
             <span class="text-xs">{{ s.icon }}</span>
             <span class="text-[9px] font-black uppercase tracking-[0.2em]">{{ s.label }}</span>
          </button>
       </div>
       
       <div v-if="selectedList" class="flex gap-4">
          <button v-if="songs.length > 0" @click="playAll" class="group flex items-center gap-3 px-8 py-3 rounded-full bg-white text-black text-[10px] font-black uppercase tracking-[0.2em] shadow-xl hover:bg-cyan-400 transition-all active:scale-95 whitespace-nowrap flex-shrink-0">
             <svg class="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
             立即播放
          </button>
          <button v-if="songs.length > 0" @click="addAllToPlaylist" class="group flex items-center gap-3 px-6 py-3 rounded-full bg-white/5 border border-white/10 text-white/60 text-[10px] font-black uppercase tracking-[0.2em] hover:bg-white/10 transition-all active:scale-95 whitespace-nowrap flex-shrink-0">
             <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M12 4v16m8-8H4"/></svg>
             全部添加
          </button>
       </div>
    </header>

    <!-- 主体区域 -->
    <main class="flex-1 overflow-y-auto relative z-20 scrollbar-hide">
      <!-- 1. 榜单网格选择模式 (Luxury Modular Grid) -->
      <div v-if="!selectedList" class="p-6 md:p-10">
        <div v-if="loading" class="flex flex-col items-center justify-center py-40 gap-6">
           <div class="w-16 h-16 border-4 border-white/5 border-t-cyan-400 rounded-full animate-spin"></div>
           <p class="text-white/20 text-[10px] font-black tracking-[0.6em] uppercase">Syncing Peak Charts...</p>
        </div>
        
        <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          <button
            v-for="(item, idx) in toplists"
            :key="item.id"
            @click="selectToplist(item)"
            class="group relative flex items-center p-4 rounded-[2.5rem] bg-white/[0.03] border border-white/5 hover:bg-white/[0.08] hover:border-white/20 transition-all duration-500 overflow-hidden backdrop-blur-md shadow-2xl text-left"
          >
             <!-- Interior glow -->
             <div :class="['absolute top-0 right-0 w-32 h-32 blur-3xl opacity-0 group-hover:opacity-10 transition-opacity duration-700', idx % 3 === 0 ? 'bg-orange-500' : idx % 3 === 1 ? 'bg-cyan-500' : 'bg-purple-500']"></div>
             
             <!-- Cover / Icon -->
             <div class="relative w-16 h-16 rounded-2xl overflow-hidden flex-shrink-0 transition-all duration-500 group-hover:scale-105 shadow-xl ring-1 ring-white/10">
                <img v-if="item.cover" :src="item.cover" class="w-full h-full object-cover transition-transform duration-[5s] group-hover:scale-110" />
                <div v-else class="w-full h-full bg-gradient-to-br from-indigo-900/40 to-black"></div>
                <div class="absolute inset-0 bg-black/10 group-hover:bg-transparent transition-colors duration-1000"></div>
             </div>
 
             <!-- Content -->
             <div class="ml-4 flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1 px-0.5">
                   <div :class="['w-1 h-3 rounded-full', idx % 3 === 0 ? 'bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.5)]' : 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.5)]']"></div>
                   <span class="text-[8px] font-black text-white/40 uppercase tracking-[0.3em]">{{ item.updateFrequency || 'DAILY' }}</span>
                </div>
                <h4 class="text-white font-black text-base md:text-lg leading-snug tracking-tighter truncate group-hover:text-white transition-colors">{{ item.name }}</h4>
             </div>
 
             <!-- Floating Rank Indicator (Subtle) -->
             <div class="absolute -right-2 top-0 text-5xl font-black text-white/[0.01] italic tracking-tighter transition-all duration-1000 group-hover:text-white/[0.04] pointer-events-none select-none leading-none">
                {{ (idx + 1).toString().padStart(2, '0') }}
             </div>

             <!-- Arrow Indicator -->
             <div class="ml-auto opacity-0 group-hover:opacity-100 transition-all duration-500 translate-x-2 group-hover:translate-x-0 pr-1">
                <svg class="w-4 h-4 text-white/20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M9 5l7 7-7 7"/></svg>
             </div>
          </button>
        </div>
      </div>
 
      <!-- 2. 歌曲列表沉浸模式 (Cinematic List Edition) -->
      <div v-else>
         <!-- 电影感头部区域 (Integrated & Bold) -->
         <div class="px-6 md:px-10 py-12 md:py-24 flex flex-col md:flex-row items-center md:items-end gap-12">
            <div class="relative w-56 h-56 md:w-72 md:h-72 rounded-[3.5rem] overflow-hidden shadow-[0_40px_100px_rgba(0,0,0,0.8)] group ring-1 ring-white/10">
               <img v-if="selectedListCover" :src="selectedListCover" class="w-full h-full object-cover transition-transform duration-[6s] group-hover:scale-110" />
               <div v-else class="w-full h-full bg-gradient-to-br from-cyan-600 to-indigo-700 flex items-center justify-center text-6xl">🏆</div>
               <!-- Animated Gradient Overlay -->
               <div class="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-1000"></div>
            </div>
            
            <div class="flex-1 text-center md:text-left">
               <div class="flex items-center justify-center md:justify-start gap-4 mb-8">
                  <span class="px-4 py-1.5 rounded-full bg-white/5 text-white/40 text-[9px] font-black tracking-[0.4em] uppercase border border-white/5">{{ currentSource }} Peak Level</span>
                  <div class="flex gap-1.5">
                     <div class="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse-slow"></div>
                     <div class="w-1.5 h-1.5 rounded-full bg-white/20"></div>
                  </div>
               </div>
               
               <h1 class="text-6xl md:text-8xl font-black text-white tracking-tighter mb-8 filter drop-shadow-[0_15px_15px_rgba(0,0,0,0.6)] leading-[0.85] selection:text-cyan-400">
                  {{ selectedList.name }}
               </h1>
               
               <div class="flex flex-wrap items-center justify-center md:justify-start gap-10 text-white/20 text-[10px] font-black tracking-[0.5em] uppercase">
                  <div class="flex items-center gap-4">
                     <span class="text-white/5 italic">COLLECTION</span>
                     <span class="text-white/80 font-mono tracking-normal">{{ songs.length }} ITEMS</span>
                  </div>
                  <div class="flex items-center gap-4">
                     <span class="text-white/5 italic">DYNAMIC</span>
                     <span class="text-white/80">{{ selectedList.updateFrequency || 'DAILY' }}</span>
                  </div>
               </div>
            </div>
         </div>
 
         <!-- 歌曲列表主体 (Luxury Sheet Design) -->
         <div class="mx-6 md:mx-10 mb-20 rounded-[4rem] bg-white/[0.02] border border-white/5 backdrop-blur-3xl overflow-hidden shadow-[0_30px_80px_rgba(0,0,0,0.4)] relative">
            <div v-if="loadingSongs" class="py-40 flex flex-col items-center gap-6">
               <div class="w-14 h-14 border-4 border-white/5 border-t-cyan-400 rounded-full animate-spin"></div>
               <p class="text-white/20 text-[10px] font-black tracking-[0.6em] uppercase">Calibrating Sonics...</p>
            </div>
            
            <div v-else-if="songLoadError" class="py-40 flex flex-col items-center gap-6">
               <p class="text-4xl">📭</p>
               <p class="text-white/40 text-sm font-medium">{{ songLoadError }}</p>
               <button @click="selectToplist(selectedList!)" class="px-6 py-2 rounded-full bg-white/5 border border-white/10 text-white/60 text-[10px] font-black uppercase tracking-widest hover:bg-white/10 transition-all">
                 Retry Fetch
               </button>
            </div>
            
            <div v-else class="divide-y divide-white/[0.02]">
              <div
                v-for="(song, idx) in songs"
                :key="song.id"
                class="group flex items-center gap-6 p-6 md:p-8 hover:bg-white/[0.04] transition-all duration-700 cursor-pointer relative"
                @click="playSong(song)"
              >
                <!-- Selection Indicator -->
                <div class="absolute left-0 top-0 w-2 h-full bg-cyan-400 scale-y-0 group-hover:scale-y-100 transition-transform duration-700 origin-center"></div>
 
                <!-- Rank Positioning -->
                <div class="w-16 flex-shrink-0 flex items-center justify-center">
                   <span :class="['text-3xl font-black italic tracking-tighter transition-all duration-1000 group-hover:scale-125 group-hover:translate-x-1', 
                      idx === 0 ? 'text-transparent bg-clip-text bg-gradient-to-br from-cyan-300 via-white to-blue-500 drop-shadow-[0_0_10px_rgba(34,211,238,0.4)]' : 
                      idx === 1 ? 'text-white/60' : 
                      idx === 2 ? 'text-white/40' : 'text-white/5 group-hover:text-white/20']">
                      {{ (idx + 1).toString().padStart(2, '0') }}
                   </span>
                </div>
 
                <div class="flex-1 min-w-0">
                  <h4 class="text-white font-black text-lg md:text-xl truncate tracking-tight group-hover:text-cyan-400 transition-colors duration-500">{{ song.name }}</h4>
                  <div class="flex items-center gap-4 mt-2">
                     <p class="text-white/30 text-[10px] font-black uppercase tracking-[0.25em] group-hover:text-white/60 transition-colors duration-700">{{ song.artist }}</p>
                     <div class="h-px flex-1 bg-white/[0.03] group-hover:bg-white/10 transition-colors"></div>
                  </div>
                </div>
 
                <!-- Luxury Call to Action -->
                <div class="flex items-center gap-4 opacity-0 group-hover:opacity-100 transition-all duration-700 translate-x-4 group-hover:translate-x-0">
                   <button
                     @click.stop="addToPlaylist(song)"
                     class="w-14 h-14 rounded-full bg-white text-black flex items-center justify-center transition-all duration-500 hover:bg-cyan-400 hover:scale-110 shadow-2xl active:scale-95"
                   >
                     <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M12 4v16m8-8H4"/></svg>
                   </button>
                </div>
              </div>
            </div>
         </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.scrollbar-hide {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
.scrollbar-hide::-webkit-scrollbar {
  display: none;
}

@keyframes pulse-slow {
  0%, 100% { opacity: 0.3; transform: scale(1); }
  50% { opacity: 0.6; transform: scale(1.1); }
}

.transition-delay-300 {
   animation-delay: 300ms;
}
</style>
