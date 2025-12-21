<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { usePlayerStore } from '@/store/player'
import {
  getToplists,
  getToplistSongs,
  searchResultToTrack,
  getLyrics,
  getCoverUrl,
  type ToplistItem,
  type SearchResult
} from '@/services/source/OnlineApiSource'

// 获取歌曲封面URL
function getSongCover(song: SearchResult): string {
  return getCoverUrl(song.platform, song.id)
}

const store = usePlayerStore()
const emit = defineEmits<{
  (e: 'navigate', view: string): void
}>()

// 数据状态
const loading = ref(true)
const loadError = ref('')
const hotSongs = ref<SearchResult[]>([])
const newSongs = ref<SearchResult[]>([])
const toplists = ref<ToplistItem[]>([])
const currentBannerIndex = ref(0)

// 新歌筛选
type NewSongFilter = 'all' | 'netease' | 'qq' | 'kuwo'
const newSongFilter = ref<NewSongFilter>('all')
const filteredNewSongs = computed(() => {
  if (newSongFilter.value === 'all') return newSongs.value
  return newSongs.value.filter(song => song.platform === newSongFilter.value)
})

// 缓存配置
const CACHE_KEY = 'home_recommend_cache'
const CACHE_TIME_KEY = 'home_recommend_cache_time'
const CACHE_DURATION = 2 * 60 * 60 * 1000 // 2小时

// Banner 数据（从热门歌曲中取前5首）
const bannerSongs = computed(() => hotSongs.value.slice(0, 5))

// 检查缓存
function isCacheValid(): boolean {
  const cacheTime = localStorage.getItem(CACHE_TIME_KEY)
  if (!cacheTime) return false
  return Date.now() - parseInt(cacheTime) < CACHE_DURATION
}

// 加载缓存
function loadCache() {
  if (!isCacheValid()) {
    localStorage.removeItem(CACHE_KEY)
    localStorage.removeItem(CACHE_TIME_KEY)
    return null
  }
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
  } catch {
    return null
  }
}

// 保存缓存
function saveCache(data: { hotSongs: SearchResult[]; newSongs: SearchResult[]; toplists: ToplistItem[] }) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data))
    localStorage.setItem(CACHE_TIME_KEY, Date.now().toString())
  } catch { /* ignore */ }
}

// 歌曲去重（根据歌名+歌手）
function deduplicateSongs(songs: SearchResult[]): SearchResult[] {
  const seen = new Set<string>()
  return songs.filter(song => {
    const key = `${song.name.toLowerCase()}-${song.artist.toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// 加载推荐数据
async function loadRecommendData() {
  // 尝试从缓存加载
  const cached = loadCache()
  if (cached) {
    hotSongs.value = cached.hotSongs || []
    newSongs.value = cached.newSongs || []
    toplists.value = cached.toplists || []
    loading.value = false
    return
  }

  loading.value = true
  loadError.value = ''
  try {
    // 并行获取数据：热歌榜 + 新歌榜（每个请求独立处理错误）
    const [
      neteaseHot,      // 网易云飙升榜
      qqHot,           // QQ音乐热歌榜
      neteaseNew,      // 网易云新歌榜
      qqNew,           // QQ音乐新歌榜
      kuwoNew,         // 酷我新歌榜
      toplistData
    ] = await Promise.all([
      getToplistSongs('netease', '19723756').catch(() => []),  // 网易云飙升榜
      getToplistSongs('qq', '62').catch(() => []),             // QQ音乐热歌榜
      getToplistSongs('netease', '3779629').catch(() => []),   // 网易云新歌榜
      getToplistSongs('qq', '27').catch(() => []),             // QQ音乐新歌榜
      getToplistSongs('kuwo', '93').catch(() => []),           // 酷我新歌榜
      getToplists('netease').catch(() => [])
    ])

    // 热门歌曲：混合网易云和QQ的热歌，去重后随机打乱
    const hotMixed = deduplicateSongs([...neteaseHot.slice(0, 15), ...qqHot.slice(0, 15)])
    hotSongs.value = hotMixed.sort(() => Math.random() - 0.5).slice(0, 20)
    
    // 新歌推荐：从三个平台的新歌榜获取
    // 每个平台保留独立数据，不去重（方便按平台筛选）
    const neteaseNewSongs = neteaseNew.slice(0, 10)
    const qqNewSongs = qqNew.slice(0, 10)
    const kuwoNewSongs = kuwoNew.slice(0, 10)
    
    // 合并并随机打乱
    newSongs.value = [...neteaseNewSongs, ...qqNewSongs, ...kuwoNewSongs]
      .sort(() => Math.random() - 0.5)

    toplists.value = toplistData.slice(0, 6)

    // 保存缓存
    saveCache({
      hotSongs: hotSongs.value,
      newSongs: newSongs.value,
      toplists: toplists.value
    })
  } catch (e: any) {
    console.error('加载推荐数据失败:', e)
    loadError.value = e?.message || '网络连接失败，请检查网络'
  } finally {
    loading.value = false
  }
}

// 播放歌曲
async function playSong(result: SearchResult) {
  const track = searchResultToTrack(result)
  getLyrics(result.platform, result.id).then(lrc => {
    const t = store.playlist.find(t => t.id === track.id)
    if (t) t.lrc = lrc
  })
  store.addTrack(track)
  store.playTrack(store.playlist.length - 1)
}

// 添加到播放列表
function addToPlaylist(result: SearchResult) {
  const track = searchResultToTrack(result)
  store.addTrack(track)
}

// 播放全部热门
function playAllHot() {
  hotSongs.value.forEach(song => {
    const track = searchResultToTrack(song)
    store.addTrack(track)
  })
  if (store.playlist.length > 0) {
    store.playTrack(store.playlist.length - hotSongs.value.length)
  }
}

// Banner 自动轮播
let bannerTimer: number | null = null
function startBannerTimer() {
  bannerTimer = window.setInterval(() => {
    if (bannerSongs.value.length > 0) {
      currentBannerIndex.value = (currentBannerIndex.value + 1) % bannerSongs.value.length
    }
  }, 4000)
}

function stopBannerTimer() {
  if (bannerTimer) {
    clearInterval(bannerTimer)
    bannerTimer = null
  }
}

// 跳转到排行榜
function goToToplist() {
  emit('navigate', 'toplist')
}

onMounted(() => {
  loadRecommendData()
  startBannerTimer()
})
</script>

<template>
  <div class="flex-1 overflow-y-auto">
    <!-- 加载状态 -->
    <div v-if="loading" class="flex items-center justify-center h-64">
      <div class="text-center">
        <div class="w-12 h-12 border-3 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
        <p class="text-white/60">正在加载推荐内容...</p>
      </div>
    </div>

    <!-- 加载失败 -->
    <div v-else-if="loadError" class="flex items-center justify-center h-64">
      <div class="text-center">
        <p class="text-4xl mb-4">😵</p>
        <p class="text-white/60 mb-2">{{ loadError }}</p>
        <button 
          @click="loadRecommendData"
          class="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm"
        >
          重试
        </button>
      </div>
    </div>

    <div v-else class="pb-6">
      <!-- Banner 轮播区 -->
      <div 
        class="relative mx-4 md:mx-6 mt-4 md:mt-6 rounded-2xl overflow-hidden"
        @mouseenter="stopBannerTimer"
        @mouseleave="startBannerTimer"
      >
        <div class="relative h-40 md:h-56 lg:h-64">
          <TransitionGroup name="banner">
            <div
              v-for="(song, idx) in bannerSongs"
              :key="song.id"
              v-show="idx === currentBannerIndex"
              class="absolute inset-0 cursor-pointer"
              @click="playSong(song)"
            >
              <!-- 背景封面图（清晰） -->
              <div class="absolute inset-0">
                <img 
                  :src="getSongCover(song)" 
                  class="w-full h-full object-cover"
                  @error="($event.target as HTMLImageElement).style.display='none'"
                />
                <!-- 渐变色兜底背景 -->
                <div class="absolute inset-0 -z-10 bg-gradient-to-br from-purple-900 via-purple-800 to-pink-900"></div>
              </div>
              <!-- 渐变遮罩（让文字更清晰） -->
              <div class="absolute inset-0 bg-gradient-to-r from-black/70 via-black/40 to-transparent"></div>
              <div class="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent"></div>
              
              <!-- 内容 -->
              <div class="relative h-full flex items-center px-6 md:px-10">
                <div class="flex-1 pr-4 z-10">
                  <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm text-white/80 text-xs mb-3">
                    <span class="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span>
                    热门推荐
                  </div>
                  <h2 class="text-white text-xl md:text-3xl font-bold mb-2 line-clamp-1 drop-shadow-lg">{{ song.name }}</h2>
                  <p class="text-white/80 text-sm md:text-base mb-4 drop-shadow">{{ song.artist }}</p>
                  <button 
                    @click.stop="playSong(song)"
                    class="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white text-purple-900 font-medium text-sm hover:bg-white/90 transition-colors shadow-lg shadow-white/20"
                  >
                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z"/>
                    </svg>
                    立即播放
                  </button>
                </div>
                <!-- 封面 -->
                <div class="hidden md:block w-36 lg:w-44 h-36 lg:h-44 rounded-xl overflow-hidden shadow-2xl shadow-black/50 flex-shrink-0 rotate-3 hover:rotate-0 transition-transform duration-300 z-10">
                  <img 
                    :src="getSongCover(song)" 
                    class="w-full h-full object-cover"
                    @error="($event.target as HTMLImageElement).parentElement!.innerHTML = '<div class=\'w-full h-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-6xl\'>🎵</div>'"
                  />
                </div>
              </div>
            </div>
          </TransitionGroup>
        </div>
        
        <!-- 指示器 -->
        <div class="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
          <button
            v-for="(_, idx) in bannerSongs"
            :key="idx"
            @click="currentBannerIndex = idx"
            :class="[
              'w-2 h-2 rounded-full transition-all duration-300',
              idx === currentBannerIndex ? 'w-6 bg-white' : 'bg-white/40 hover:bg-white/60'
            ]"
          ></button>
        </div>
      </div>

      <!-- 快捷入口 -->
      <div class="flex gap-3 overflow-x-auto pb-2 scrollbar-hide mx-4 md:mx-6 mt-6 md:grid md:grid-cols-5 md:overflow-visible">
        <!-- 播放列表 -->
        <button 
          @click="emit('navigate', 'playlist')"
          class="quick-entry group flex-shrink-0 w-[72px] md:w-auto"
        >
          <div class="relative p-3 md:p-4 rounded-2xl bg-white/[0.08] backdrop-blur-sm border border-white/[0.08] hover:bg-white/[0.12] hover:border-white/[0.15] transition-all duration-300">
            <!-- 渐变光效 -->
            <div class="absolute inset-0 rounded-2xl bg-gradient-to-br from-emerald-500/20 via-transparent to-green-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            <!-- 图标 -->
            <div class="relative flex flex-col items-center gap-2.5">
              <div class="w-11 h-11 md:w-12 md:h-12 rounded-xl bg-gradient-to-br from-emerald-400 to-green-500 flex items-center justify-center shadow-lg shadow-emerald-500/30 group-hover:shadow-emerald-500/50 group-hover:scale-110 group-active:scale-95 transition-all duration-300">
                <svg class="w-5 h-5 md:w-6 md:h-6 text-white drop-shadow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z"/>
                </svg>
              </div>
              <span class="text-white/70 text-[11px] md:text-xs font-medium group-hover:text-white transition-colors whitespace-nowrap">播放列表</span>
            </div>
          </div>
        </button>

        <!-- 排行榜 -->
        <button 
          @click="goToToplist"
          class="quick-entry group flex-shrink-0 w-[72px] md:w-auto"
        >
          <div class="relative p-3 md:p-4 rounded-2xl bg-white/[0.08] backdrop-blur-sm border border-white/[0.08] hover:bg-white/[0.12] hover:border-white/[0.15] transition-all duration-300">
            <div class="absolute inset-0 rounded-2xl bg-gradient-to-br from-orange-500/20 via-transparent to-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            <div class="relative flex flex-col items-center gap-2.5">
              <div class="w-11 h-11 md:w-12 md:h-12 rounded-xl bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center shadow-lg shadow-orange-500/30 group-hover:shadow-orange-500/50 group-hover:scale-110 group-active:scale-95 transition-all duration-300">
                <svg class="w-5 h-5 md:w-6 md:h-6 text-white drop-shadow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M7.73 9.728a6.726 6.726 0 002.748 1.35m8.272-6.842V4.5c0 2.108-.966 3.99-2.48 5.228m2.48-5.492a46.32 46.32 0 012.916.52 6.003 6.003 0 01-5.395 4.972m0 0a6.726 6.726 0 01-2.749 1.35m0 0a6.772 6.772 0 01-3.044 0"/>
                </svg>
              </div>
              <span class="text-white/70 text-[11px] md:text-xs font-medium group-hover:text-white transition-colors whitespace-nowrap">排行榜</span>
            </div>
          </div>
        </button>

        <!-- 热歌速递 -->
        <button 
          @click="playAllHot"
          class="quick-entry group flex-shrink-0 w-[72px] md:w-auto"
        >
          <div class="relative p-3 md:p-4 rounded-2xl bg-white/[0.08] backdrop-blur-sm border border-white/[0.08] hover:bg-white/[0.12] hover:border-white/[0.15] transition-all duration-300">
            <div class="absolute inset-0 rounded-2xl bg-gradient-to-br from-purple-500/20 via-transparent to-pink-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            <div class="relative flex flex-col items-center gap-2.5">
              <div class="w-11 h-11 md:w-12 md:h-12 rounded-xl bg-gradient-to-br from-purple-400 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/30 group-hover:shadow-purple-500/50 group-hover:scale-110 group-active:scale-95 transition-all duration-300">
                <svg class="w-5 h-5 md:w-6 md:h-6 text-white drop-shadow" viewBox="0 0 24 24" fill="currentColor">
                  <path fill-rule="evenodd" d="M12.963 2.286a.75.75 0 00-1.071-.136 9.742 9.742 0 00-3.539 6.177A7.547 7.547 0 016.648 6.61a.75.75 0 00-1.152.082A9 9 0 1015.68 4.534a7.46 7.46 0 01-2.717-2.248zM15.75 14.25a3.75 3.75 0 11-7.313-1.172c.628.465 1.35.81 2.133 1a5.99 5.99 0 011.925-3.545 3.75 3.75 0 013.255 3.717z" clip-rule="evenodd"/>
                </svg>
              </div>
              <span class="text-white/70 text-[11px] md:text-xs font-medium group-hover:text-white transition-colors whitespace-nowrap">热歌速递</span>
            </div>
          </div>
        </button>

        <!-- AI选歌 -->
        <button 
          @click="emit('navigate', 'aipicker')"
          class="quick-entry group flex-shrink-0 w-[72px] md:w-auto"
        >
          <div class="relative p-3 md:p-4 rounded-2xl bg-white/[0.08] backdrop-blur-sm border border-white/[0.08] hover:bg-white/[0.12] hover:border-white/[0.15] transition-all duration-300 overflow-hidden">
            <div class="absolute inset-0 rounded-2xl bg-gradient-to-br from-cyan-500/20 via-transparent to-blue-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            <!-- AI 特效：闪烁星星 -->
            <div class="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping opacity-75"></div>
            <div class="relative flex flex-col items-center gap-2.5">
              <div class="w-11 h-11 md:w-12 md:h-12 rounded-xl bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center shadow-lg shadow-cyan-500/30 group-hover:shadow-cyan-500/50 group-hover:scale-110 group-active:scale-95 transition-all duration-300">
                <svg class="w-5 h-5 md:w-6 md:h-6 text-white drop-shadow" viewBox="0 0 24 24" fill="currentColor">
                  <path fill-rule="evenodd" d="M9 4.5a.75.75 0 01.721.544l.813 2.846a3.75 3.75 0 002.576 2.576l2.846.813a.75.75 0 010 1.442l-2.846.813a3.75 3.75 0 00-2.576 2.576l-.813 2.846a.75.75 0 01-1.442 0l-.813-2.846a3.75 3.75 0 00-2.576-2.576l-2.846-.813a.75.75 0 010-1.442l2.846-.813A3.75 3.75 0 007.466 7.89l.813-2.846A.75.75 0 019 4.5zM18 1.5a.75.75 0 01.728.568l.258 1.036c.236.94.97 1.674 1.91 1.91l1.036.258a.75.75 0 010 1.456l-1.036.258c-.94.236-1.674.97-1.91 1.91l-.258 1.036a.75.75 0 01-1.456 0l-.258-1.036a2.625 2.625 0 00-1.91-1.91l-1.036-.258a.75.75 0 010-1.456l1.036-.258a2.625 2.625 0 001.91-1.91l.258-1.036A.75.75 0 0118 1.5zM16.5 15a.75.75 0 01.712.513l.394 1.183c.15.447.5.799.948.948l1.183.395a.75.75 0 010 1.422l-1.183.395c-.447.15-.799.5-.948.948l-.395 1.183a.75.75 0 01-1.422 0l-.395-1.183a1.5 1.5 0 00-.948-.948l-1.183-.395a.75.75 0 010-1.422l1.183-.395c.447-.15.799-.5.948-.948l.395-1.183A.75.75 0 0116.5 15z" clip-rule="evenodd"/>
                </svg>
              </div>
              <span class="text-white/70 text-[11px] md:text-xs font-medium group-hover:text-white transition-colors whitespace-nowrap">AI选歌</span>
            </div>
          </div>
        </button>

        <!-- 我的喜爱 -->
        <button 
          @click="emit('navigate', 'favorite')"
          class="quick-entry group flex-shrink-0 w-[72px] md:w-auto"
        >
          <div class="relative p-3 md:p-4 rounded-2xl bg-white/[0.08] backdrop-blur-sm border border-white/[0.08] hover:bg-white/[0.12] hover:border-white/[0.15] transition-all duration-300">
            <div class="absolute inset-0 rounded-2xl bg-gradient-to-br from-pink-500/20 via-transparent to-rose-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            <div class="relative flex flex-col items-center gap-2.5">
              <div class="w-11 h-11 md:w-12 md:h-12 rounded-xl bg-gradient-to-br from-pink-400 to-rose-500 flex items-center justify-center shadow-lg shadow-pink-500/30 group-hover:shadow-pink-500/50 group-hover:scale-110 group-active:scale-95 transition-all duration-300">
                <svg class="w-5 h-5 md:w-6 md:h-6 text-white drop-shadow" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z"/>
                </svg>
              </div>
              <span class="text-white/70 text-[11px] md:text-xs font-medium group-hover:text-white transition-colors whitespace-nowrap">我的喜爱</span>
            </div>
          </div>
        </button>
      </div>

      <!-- 正在播放卡片 -->
      <section v-if="store.playlist.length > 0" class="mt-6 px-4 md:px-6">
        <button 
          @click="emit('navigate', 'playlist')"
          class="w-full p-4 rounded-2xl bg-gradient-to-r from-purple-900/50 to-pink-900/50 border border-white/10 hover:border-purple-500/50 transition-all group"
        >
          <div class="flex items-center gap-4">
            <!-- 封面 -->
            <div class="relative w-14 h-14 rounded-xl overflow-hidden bg-white/10 flex-shrink-0">
              <div v-if="store.currentTrack?.cover" class="w-full h-full">
                <img :src="store.currentTrack.cover" class="w-full h-full object-cover" />
              </div>
              <div v-else class="w-full h-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-2xl">
                🎵
              </div>
              <div v-if="store.isPlaying" class="absolute inset-0 bg-black/30 flex items-center justify-center">
                <div class="flex gap-0.5">
                  <span class="w-1 h-4 bg-white rounded animate-pulse"></span>
                  <span class="w-1 h-4 bg-white rounded animate-pulse" style="animation-delay: 0.15s"></span>
                  <span class="w-1 h-4 bg-white rounded animate-pulse" style="animation-delay: 0.3s"></span>
                </div>
              </div>
            </div>
            
            <!-- 信息 -->
            <div class="flex-1 min-w-0 text-left">
              <p class="text-white/60 text-xs mb-1">正在播放</p>
              <p class="text-white font-medium truncate">
                {{ store.currentTrack?.title || '暂无播放' }}
              </p>
              <p class="text-white/50 text-sm truncate">
                {{ store.currentTrack?.artist || '点击查看播放列表' }}
              </p>
            </div>
            
            <!-- 播放列表数量 -->
            <div class="flex items-center gap-2 text-white/60">
              <span class="text-sm">{{ store.playlist.length }} 首</span>
              <svg class="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
              </svg>
            </div>
          </div>
        </button>
      </section>

      <!-- 热门推荐 -->
      <section class="mt-8 px-4 md:px-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-white text-lg md:text-xl font-bold flex items-center gap-2">
            <span class="w-1 h-5 rounded-full bg-gradient-to-b from-purple-500 to-pink-500"></span>
            热门推荐
          </h3>
          <button 
            @click="playAllHot"
            class="text-white/60 text-sm hover:text-white transition-colors flex items-center gap-1"
          >
            播放全部
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
            </svg>
          </button>
        </div>
        
        <!-- 歌曲网格 -->
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
          <div
            v-for="(song, idx) in hotSongs.slice(0, 10)"
            :key="song.id"
            @click="playSong(song)"
            class="group cursor-pointer"
          >
            <div class="relative aspect-square rounded-xl overflow-hidden bg-white/5 mb-2">
              <!-- 封面图片 -->
              <img 
                :src="getSongCover(song)" 
                class="absolute inset-0 w-full h-full object-cover"
                @error="($event.target as HTMLImageElement).style.display='none'"
              />
              <!-- 渐变背景（封面加载失败时显示） -->
              <div :class="[
                'absolute inset-0 -z-10',
                idx % 4 === 0 ? 'bg-gradient-to-br from-purple-600 to-pink-600' :
                idx % 4 === 1 ? 'bg-gradient-to-br from-blue-600 to-cyan-600' :
                idx % 4 === 2 ? 'bg-gradient-to-br from-orange-600 to-red-600' :
                'bg-gradient-to-br from-green-600 to-teal-600'
              ]">
                <div class="absolute inset-0 flex items-center justify-center text-5xl opacity-50">🎵</div>
              </div>
              
              <!-- 排名标签 -->
              <div v-if="idx < 3" :class="[
                'absolute top-2 left-2 w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold shadow-lg',
                idx === 0 ? 'bg-gradient-to-br from-yellow-400 to-orange-500 text-black' :
                idx === 1 ? 'bg-gradient-to-br from-gray-300 to-gray-400 text-black' :
                'bg-gradient-to-br from-amber-600 to-amber-700 text-white'
              ]">
                {{ idx + 1 }}
              </div>
              
              <!-- 悬浮播放按钮 -->
              <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <div class="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center group-hover:scale-110 transition-transform">
                  <svg class="w-6 h-6 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                </div>
              </div>
              
              <!-- 添加按钮 -->
              <button
                @click.stop="addToPlaylist(song)"
                class="absolute bottom-2 right-2 w-8 h-8 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/60"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                </svg>
              </button>
            </div>
            <p class="text-white text-sm font-medium truncate">{{ song.name }}</p>
            <p class="text-white/50 text-xs truncate">{{ song.artist }}</p>
          </div>
        </div>
      </section>

      <!-- 排行榜快捷入口 -->
      <section class="mt-8 px-4 md:px-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-white text-lg md:text-xl font-bold flex items-center gap-2">
            <span class="w-1 h-5 rounded-full bg-gradient-to-b from-orange-500 to-red-500"></span>
            排行榜
          </h3>
          <button 
            @click="goToToplist"
            class="text-white/60 text-sm hover:text-white transition-colors flex items-center gap-1"
          >
            查看更多
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
            </svg>
          </button>
        </div>
        
        <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
          <button
            v-for="(item, idx) in toplists"
            :key="item.id"
            @click="goToToplist"
            class="relative flex items-center gap-3 p-4 rounded-2xl bg-white/[0.06] backdrop-blur-sm border border-white/[0.06] hover:bg-white/[0.1] hover:border-white/[0.12] transition-all text-left group overflow-hidden"
          >
            <!-- 背景光效 -->
            <div :class="[
              'absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300',
              idx === 0 ? 'bg-gradient-to-br from-yellow-500/10 to-orange-500/5' :
              idx === 1 ? 'bg-gradient-to-br from-purple-500/10 to-pink-500/5' :
              idx === 2 ? 'bg-gradient-to-br from-blue-500/10 to-cyan-500/5' :
              idx === 3 ? 'bg-gradient-to-br from-green-500/10 to-teal-500/5' :
              idx === 4 ? 'bg-gradient-to-br from-red-500/10 to-rose-500/5' :
              'bg-gradient-to-br from-indigo-500/10 to-purple-500/5'
            ]"></div>
            <!-- 图标 -->
            <div :class="[
              'relative w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 shadow-lg group-hover:scale-105 transition-transform duration-300',
              idx === 0 ? 'bg-gradient-to-br from-yellow-400 to-orange-500 shadow-orange-500/25' :
              idx === 1 ? 'bg-gradient-to-br from-purple-400 to-pink-500 shadow-purple-500/25' :
              idx === 2 ? 'bg-gradient-to-br from-blue-400 to-cyan-500 shadow-blue-500/25' :
              idx === 3 ? 'bg-gradient-to-br from-green-400 to-teal-500 shadow-green-500/25' :
              idx === 4 ? 'bg-gradient-to-br from-red-400 to-rose-500 shadow-red-500/25' :
              'bg-gradient-to-br from-indigo-400 to-purple-500 shadow-indigo-500/25'
            ]">
              <!-- 热歌榜 - 火焰 -->
              <svg v-if="idx === 0" class="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path fill-rule="evenodd" d="M12.963 2.286a.75.75 0 00-1.071-.136 9.742 9.742 0 00-3.539 6.177A7.547 7.547 0 016.648 6.61a.75.75 0 00-1.152.082A9 9 0 1015.68 4.534a7.46 7.46 0 01-2.717-2.248zM15.75 14.25a3.75 3.75 0 11-7.313-1.172c.628.465 1.35.81 2.133 1a5.99 5.99 0 011.925-3.545 3.75 3.75 0 013.255 3.717z" clip-rule="evenodd"/>
              </svg>
              <!-- 飙升榜 - 上升箭头 -->
              <svg v-else-if="idx === 1" class="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path fill-rule="evenodd" d="M12 2.25a.75.75 0 01.75.75v16.19l6.22-6.22a.75.75 0 111.06 1.06l-7.5 7.5a.75.75 0 01-1.06 0l-7.5-7.5a.75.75 0 111.06-1.06l6.22 6.22V3a.75.75 0 01.75-.75z" clip-rule="evenodd" transform="rotate(180 12 12)"/>
              </svg>
              <!-- 新歌榜 - 星星 -->
              <svg v-else-if="idx === 2" class="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path fill-rule="evenodd" d="M9 4.5a.75.75 0 01.721.544l.813 2.846a3.75 3.75 0 002.576 2.576l2.846.813a.75.75 0 010 1.442l-2.846.813a3.75 3.75 0 00-2.576 2.576l-.813 2.846a.75.75 0 01-1.442 0l-.813-2.846a3.75 3.75 0 00-2.576-2.576l-2.846-.813a.75.75 0 010-1.442l2.846-.813A3.75 3.75 0 007.466 7.89l.813-2.846A.75.75 0 019 4.5zM18 1.5a.75.75 0 01.728.568l.258 1.036c.236.94.97 1.674 1.91 1.91l1.036.258a.75.75 0 010 1.456l-1.036.258c-.94.236-1.674.97-1.91 1.91l-.258 1.036a.75.75 0 01-1.456 0l-.258-1.036a2.625 2.625 0 00-1.91-1.91l-1.036-.258a.75.75 0 010-1.456l1.036-.258a2.625 2.625 0 001.91-1.91l.258-1.036A.75.75 0 0118 1.5z" clip-rule="evenodd"/>
              </svg>
              <!-- 原创榜 - 音符 -->
              <svg v-else-if="idx === 3" class="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path fill-rule="evenodd" d="M19.952 1.651a.75.75 0 01.298.599V16.303a3 3 0 01-2.176 2.884l-1.32.377a2.553 2.553 0 11-1.403-4.909l2.311-.66a1.5 1.5 0 001.088-1.442V6.994l-9 2.572v9.737a3 3 0 01-2.176 2.884l-1.32.377a2.553 2.553 0 11-1.402-4.909l2.31-.66a1.5 1.5 0 001.088-1.442V5.25a.75.75 0 01.544-.721l10.5-3a.75.75 0 01.658.122z" clip-rule="evenodd"/>
              </svg>
              <!-- 专辑榜 - 唱片 -->
              <svg v-else-if="idx === 4" class="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <circle cx="12" cy="12" r="9"/>
                <circle cx="12" cy="12" r="3"/>
                <path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>
              </svg>
              <!-- 歌手榜 - 麦克风 -->
              <svg v-else class="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8.25 4.5a3.75 3.75 0 117.5 0v8.25a3.75 3.75 0 11-7.5 0V4.5z"/>
                <path d="M6 10.5a.75.75 0 01.75.75v1.5a5.25 5.25 0 1010.5 0v-1.5a.75.75 0 011.5 0v1.5a6.751 6.751 0 01-6 6.709v2.291h3a.75.75 0 010 1.5h-7.5a.75.75 0 010-1.5h3v-2.291a6.751 6.751 0 01-6-6.709v-1.5A.75.75 0 016 10.5z"/>
              </svg>
            </div>
            <!-- 文字 -->
            <div class="relative flex-1 min-w-0">
              <p class="text-white text-sm font-medium truncate group-hover:text-white transition-colors">{{ item.name }}</p>
              <p class="text-white/40 text-xs mt-0.5">点击查看</p>
            </div>
            <!-- 箭头 -->
            <svg class="relative w-4 h-4 text-white/20 group-hover:text-white/50 group-hover:translate-x-0.5 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
            </svg>
          </button>
        </div>
      </section>

      <!-- 新歌速递 -->
      <section class="mt-8">
        <div class="flex items-center justify-between mb-3 px-4 md:px-6">
          <h3 class="text-white text-lg md:text-xl font-bold flex items-center gap-2">
            <span class="w-1 h-5 rounded-full bg-gradient-to-b from-green-500 to-teal-500"></span>
            新歌速递
          </h3>
        </div>
        
        <!-- 筛选标签 -->
        <div class="flex gap-2 mb-4 px-4 md:px-6 overflow-x-auto scrollbar-hide">
          <button
            @click="newSongFilter = 'all'"
            :class="[
              'px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap',
              newSongFilter === 'all' 
                ? 'bg-gradient-to-r from-green-500 to-teal-500 text-white shadow-lg shadow-green-500/25' 
                : 'bg-white/[0.08] text-white/60 hover:bg-white/[0.12] hover:text-white/80'
            ]"
          >
            全部
          </button>
          <button
            @click="newSongFilter = 'netease'"
            :class="[
              'px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap flex items-center gap-1.5',
              newSongFilter === 'netease' 
                ? 'bg-gradient-to-r from-red-500 to-red-600 text-white shadow-lg shadow-red-500/25' 
                : 'bg-white/[0.08] text-white/60 hover:bg-white/[0.12] hover:text-white/80'
            ]"
          >
            <span class="w-1.5 h-1.5 rounded-full bg-red-500" :class="{ 'bg-white': newSongFilter === 'netease' }"></span>
            网易云
          </button>
          <button
            @click="newSongFilter = 'qq'"
            :class="[
              'px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap flex items-center gap-1.5',
              newSongFilter === 'qq' 
                ? 'bg-gradient-to-r from-green-500 to-green-600 text-white shadow-lg shadow-green-500/25' 
                : 'bg-white/[0.08] text-white/60 hover:bg-white/[0.12] hover:text-white/80'
            ]"
          >
            <span class="w-1.5 h-1.5 rounded-full bg-green-500" :class="{ 'bg-white': newSongFilter === 'qq' }"></span>
            QQ音乐
          </button>
          <button
            @click="newSongFilter = 'kuwo'"
            :class="[
              'px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap flex items-center gap-1.5',
              newSongFilter === 'kuwo' 
                ? 'bg-gradient-to-r from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/25' 
                : 'bg-white/[0.08] text-white/60 hover:bg-white/[0.12] hover:text-white/80'
            ]"
          >
            <span class="w-1.5 h-1.5 rounded-full bg-orange-500" :class="{ 'bg-white': newSongFilter === 'kuwo' }"></span>
            酷我
          </button>
        </div>
        
        <!-- 横向滚动列表 -->
        <div class="flex gap-3 overflow-x-auto pb-4 scrollbar-hide pl-4 md:pl-6 pr-4">
          <div
            v-for="(song, idx) in filteredNewSongs"
            :key="`${song.platform}-${song.id}`"
            @click="playSong(song)"
            class="flex-shrink-0 w-36 md:w-44 cursor-pointer group"
          >
            <div class="relative aspect-square rounded-2xl overflow-hidden bg-white/5 mb-2.5 shadow-lg shadow-black/20">
              <!-- 封面图片 -->
              <img 
                :src="getSongCover(song)" 
                class="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                @error="($event.target as HTMLImageElement).style.display='none'"
              />
              <!-- 渐变背景（封面加载失败时显示） -->
              <div :class="[
                'absolute inset-0 -z-10',
                idx % 4 === 0 ? 'bg-gradient-to-br from-green-600 to-teal-600' :
                idx % 4 === 1 ? 'bg-gradient-to-br from-blue-600 to-indigo-600' :
                idx % 4 === 2 ? 'bg-gradient-to-br from-purple-600 to-pink-600' :
                'bg-gradient-to-br from-orange-600 to-red-600'
              ]">
                <div class="absolute inset-0 flex items-center justify-center text-4xl opacity-50">🎵</div>
              </div>
              
              <!-- NEW 标签 + 平台 -->
              <div class="absolute top-2 left-2 right-2 flex items-center justify-between">
                <div class="px-2 py-0.5 rounded-full bg-gradient-to-r from-green-500 to-emerald-500 text-white text-[10px] font-bold shadow-lg">
                  NEW
                </div>
                <div class="px-1.5 py-0.5 rounded-md bg-black/50 backdrop-blur-sm text-white/80 text-[9px]">
                  {{ song.platform === 'netease' ? '网易云' : song.platform === 'qq' ? 'QQ' : '酷我' }}
                </div>
              </div>
              
              <!-- 悬浮播放 -->
              <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center justify-center">
                <div class="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center transform scale-75 group-hover:scale-100 transition-transform duration-300">
                  <svg class="w-6 h-6 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                </div>
              </div>
              
              <!-- 添加按钮 -->
              <button
                @click.stop="addToPlaylist(song)"
                class="absolute bottom-2 right-2 w-8 h-8 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/60"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                </svg>
              </button>
            </div>
            <p class="text-white text-sm font-medium truncate px-0.5">{{ song.name }}</p>
            <p class="text-white/50 text-xs truncate px-0.5">{{ song.artist }}</p>
          </div>
        </div>
      </section>
    </div>
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

.banner-enter-active,
.banner-leave-active {
  transition: opacity 0.5s ease, transform 0.5s ease;
}
.banner-enter-from {
  opacity: 0;
  transform: translateX(20px);
}
.banner-leave-to {
  opacity: 0;
  transform: translateX(-20px);
}

.line-clamp-1 {
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
