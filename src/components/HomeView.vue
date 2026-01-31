<script setup lang="ts">
import { ref, onMounted, computed, onUnmounted } from 'vue'
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
import { toplistJumpState } from '@/store/ui'

function getSongCover(song: SearchResult): string {
  return song.cover || getCoverUrl(song.platform, song.id, song.pic_id)
}

const store = usePlayerStore()
const emit = defineEmits<{
  (e: 'navigate', view: string): void
}>()

// 数据状态
const loading = ref(true)
const loadError = ref('')
const bannerSongs = ref<SearchResult[]>([]) // 轮播图 - 飙升榜
const hotSongs = ref<SearchResult[]>([]) // 热门推荐 - 热歌榜
const newSongs = ref<SearchResult[]>([]) // 新歌速递 - 新歌榜
const toplists = ref<(ToplistItem & { cover?: string; topSongs?: SearchResult[] })[]>([])
const currentBannerIndex = ref(0)

// 播放状态 - 用于显示加载反馈
const playingId = ref<string | null>(null)

// Toast 提示
const toast = ref({ show: false, message: '', type: 'success' as 'success' | 'error' })
function showToast(message: string, type: 'success' | 'error' = 'success') {
  toast.value = { show: true, message, type }
  setTimeout(() => { toast.value.show = false }, 2000)
}

// 缓存配置 - 更新版本号强制刷新
const CACHE_KEY = 'home_recommend_cache_v4'
const CACHE_TIME_KEY = 'home_recommend_cache_time_v4'
const CACHE_DURATION = 2 * 60 * 60 * 1000

// Banner 拖动相关
const bannerRef = ref<HTMLElement>()
void bannerRef // 在模板中使用
const bannerSwipeStartX = ref(0)
const bannerSwipeCurrentX = ref(0)
const isBannerSwiping = ref(false)
const bannerSwipeThreshold = 50

function handleBannerTouchStart(e: TouchEvent) {
  stopBannerTimer()
  isBannerSwiping.value = true
  bannerSwipeStartX.value = e.touches[0].clientX
  bannerSwipeCurrentX.value = e.touches[0].clientX
}

function handleBannerTouchMove(e: TouchEvent) {
  if (!isBannerSwiping.value) return
  bannerSwipeCurrentX.value = e.touches[0].clientX
}

function handleBannerTouchEnd() {
  if (!isBannerSwiping.value) return
  const diff = bannerSwipeCurrentX.value - bannerSwipeStartX.value

  if (Math.abs(diff) > bannerSwipeThreshold) {
    if (diff > 0 && currentBannerIndex.value > 0) {
      currentBannerIndex.value--
    } else if (diff < 0 && currentBannerIndex.value < bannerSongs.value.length - 1) {
      currentBannerIndex.value++
    }
  }

  isBannerSwiping.value = false
  startBannerTimer()
}

const bannerOffset = computed(() => {
  if (!isBannerSwiping.value) return 0
  return bannerSwipeCurrentX.value - bannerSwipeStartX.value
})

function isCacheValid(): boolean {
  const cacheTime = localStorage.getItem(CACHE_TIME_KEY)
  if (!cacheTime) return false
  return Date.now() - parseInt(cacheTime) < CACHE_DURATION
}

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

function saveCache(data: {
  bannerSongs: SearchResult[]
  hotSongs: SearchResult[]
  newSongs: SearchResult[]
  toplists: ToplistItem[]
}) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data))
    localStorage.setItem(CACHE_TIME_KEY, Date.now().toString())
  } catch {
    /* ignore */
  }
}

async function loadRecommendData(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = loadCache()
    if (cached && cached.bannerSongs?.length > 0) {
      bannerSongs.value = cached.bannerSongs || []
      hotSongs.value = cached.hotSongs || []
      newSongs.value = cached.newSongs || []
      toplists.value = cached.toplists || []
      loading.value = false
      return
    }
  }

  loading.value = true
  loadError.value = ''
  try {
    // 并行获取网易云和QQ音乐数据
    const [
      neteaseSurge,   // 网易云飙升榜
      qqSurge,        // QQ音乐飙升榜
      neteaseHot,     // 网易云热歌榜
      qqHot,          // QQ音乐热歌榜
      neteaseNew,     // 网易云新歌榜
      qqNew,          // QQ音乐新歌榜
      toplistData
    ] = await Promise.all([
      getToplistSongs('netease', '19723756').catch(e => { console.warn('网易云飙升榜失败:', e); return [] }),
      getToplistSongs('qq', '62').catch(e => { console.warn('QQ热歌榜失败:', e); return [] }),
      getToplistSongs('netease', '3778678').catch(e => { console.warn('网易云热歌榜失败:', e); return [] }),
      getToplistSongs('qq', '26').catch(e => { console.warn('QQ热歌榜26失败:', e); return [] }),
      getToplistSongs('netease', '3779629').catch(e => { console.warn('网易云新歌榜失败:', e); return [] }),
      getToplistSongs('qq', '27').catch(e => { console.warn('QQ新歌榜失败:', e); return [] }),
      getToplists('netease').catch(e => { console.warn('排行榜列表失败:', e); return [] })
    ])

    // 去重函数
    const dedup = (songs: SearchResult[]) => {
      const seen = new Set<string>()
      return songs.filter(s => {
        const key = `${s.name.toLowerCase()}-${s.artist.toLowerCase()}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    }

    // 轮播图 - 混合飙升榜，交替展示
    const allSurge = [...neteaseSurge.slice(0, 5), ...qqSurge.slice(0, 5)]
    const mixedSurge = dedup(allSurge.length > 0 ? allSurge : neteaseSurge.slice(0, 5))
    bannerSongs.value = mixedSurge.sort(() => Math.random() - 0.5).slice(0, 5)

    // 热歌榜 - 混合两个平台热歌
    const allHot = [...neteaseHot.slice(0, 8), ...qqHot.slice(0, 8)]
    const mixedHot = dedup(allHot.length > 0 ? allHot : neteaseHot.slice(0, 10))
    hotSongs.value = mixedHot.sort(() => Math.random() - 0.5).slice(0, 10)

    // 新歌榜 - 混合两个平台新歌
    const allNew = [...neteaseNew.slice(0, 8), ...qqNew.slice(0, 8)]
    const mixedNew = dedup(allNew.length > 0 ? allNew : neteaseNew.slice(0, 10))
    newSongs.value = mixedNew.sort(() => Math.random() - 0.5).slice(0, 10)

    // 为排行榜设置基础数据（仅用于可能的快速导航）
    toplists.value = toplistData.slice(0, 6).map(item => ({ ...item, cover: item.pic || '' }))
 
    // 只有有数据时才缓存 (现在包含完整的图集和歌曲预览)
    if (bannerSongs.value.length > 0 || hotSongs.value.length > 0) {
      saveCache({
        bannerSongs: bannerSongs.value,
        hotSongs: hotSongs.value,
        newSongs: newSongs.value,
        toplists: toplists.value
      })
    }
  } catch (e: any) {
    console.error('加载推荐数据失败:', e)
    loadError.value = e?.message || '网络连接失败，请检查网络'
  } finally {
    loading.value = false
  }
}

async function playSong(result: SearchResult) {
  // 设置加载状态
  playingId.value = result.id
  
  try {
    const track = searchResultToTrack(result)
    const existingIndex = store.playlist.findIndex(t => t.id === track.id)

    if (existingIndex >= 0) {
      store.playTrack(existingIndex)
    } else {
      store.addTrack(track)
      store.playTrack(store.playlist.length - 1)
    }

    // 显示播放提示
    showToast(`正在播放「${result.name}」`, 'success')

    getLyrics(result.platform, result.id).then(lrc => {
      const t = store.playlist.find(t => t.id === track.id)
      if (t) t.lrc = lrc
    })
  } catch (e) {
    showToast('播放失败，请重试', 'error')
  } finally {
    // 延迟清除加载状态，让动画更流畅
    setTimeout(() => { playingId.value = null }, 300)
  }
}

function addToPlaylist(result: SearchResult) {
  const track = searchResultToTrack(result)
  store.addTrack(track)
  showToast(`已添加「${result.name}」`, 'success')
}

function playAllHot() {
  hotSongs.value.forEach(song => {
    const track = searchResultToTrack(song)
    store.addTrack(track)
  })
  if (store.playlist.length > 0) {
    store.playTrack(store.playlist.length - hotSongs.value.length)
  }
  showToast(`已添加 ${hotSongs.value.length} 首热歌`, 'success')
}

let bannerTimer: number | null = null
function startBannerTimer() {
  stopBannerTimer()
  // 只在页面可见时运行定时器，省电
  if (document.hidden) return
  bannerTimer = window.setInterval(() => {
    if (bannerSongs.value.length > 0 && !document.hidden) {
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

// 页面可见性变化时控制定时器
function handleVisibilityChange() {
  if (document.hidden) {
    stopBannerTimer()
  } else {
    startBannerTimer()
  }
}

function goToToplist(item?: ToplistItem) {
  if (item) {
    // 首页目前只有网易云的榜单（根据 loadRecommendData 的实现）
    toplistJumpState.value = { source: 'netease', id: item.id }
  }
  emit('navigate', 'toplist')
}

// 刷新数据
const isRefreshing = ref(false)
async function refreshData() {
  if (isRefreshing.value) return
  isRefreshing.value = true
  // 清除缓存
  localStorage.removeItem(CACHE_KEY)
  localStorage.removeItem(CACHE_TIME_KEY)
  await loadRecommendData(true)
  isRefreshing.value = false
}

// 下拉刷新相关
const scrollContainer = ref<HTMLElement>()
const pullStartY = ref(0)
const pullCurrentY = ref(0)
const isPulling = ref(false)
const pullThreshold = 80

const pullDistance = computed(() => {
  if (!isPulling.value) return 0
  const dist = pullCurrentY.value - pullStartY.value
  // 添加阻尼效果
  return dist > 0 ? Math.min(dist * 0.5, 120) : 0
})

function handlePullStart(e: TouchEvent) {
  if (scrollContainer.value && scrollContainer.value.scrollTop <= 0) {
    isPulling.value = true
    pullStartY.value = e.touches[0].clientY
    pullCurrentY.value = e.touches[0].clientY
  }
}

function handlePullMove(e: TouchEvent) {
  if (!isPulling.value) return
  pullCurrentY.value = e.touches[0].clientY
  // 如果下拉距离大于0，阻止默认滚动
  if (pullCurrentY.value - pullStartY.value > 0 && scrollContainer.value?.scrollTop === 0) {
    e.preventDefault()
  }
}

async function handlePullEnd() {
  if (!isPulling.value) return
  const dist = pullCurrentY.value - pullStartY.value
  if (dist > pullThreshold && !isRefreshing.value) {
    await refreshData()
  }
  isPulling.value = false
  pullStartY.value = 0
  pullCurrentY.value = 0
}

onMounted(() => {
  loadRecommendData()
  startBannerTimer()
  // 监听页面可见性变化
  document.addEventListener('visibilitychange', handleVisibilityChange)
})

onUnmounted(() => {
  stopBannerTimer()
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})
</script>

<template>
  <div 
    ref="scrollContainer"
    class="flex-1 h-full overflow-y-auto relative bg-[#050505] text-white font-sans selection:bg-purple-500/30"
    @touchstart="handlePullStart"
    @touchmove.passive="handlePullMove"
    @touchend="handlePullEnd"
  >
    <!-- 背景氛围光效 (Cinematic Modern Edition) -->
    <div class="absolute inset-0 pointer-events-none overflow-hidden">
      <!-- Mesh Gradients -->
      <div class="absolute -top-[10%] -left-[10%] w-[80vh] h-[80vh] bg-cyan-500/10 blur-[120px] rounded-full mix-blend-screen animate-pulse-slow"></div>
      <div class="absolute top-[20%] -right-[10%] w-[70vh] h-[70vh] bg-purple-600/10 blur-[100px] rounded-full mix-blend-screen animate-float"></div>
      <div class="absolute -bottom-[10%] left-[20%] w-[60vh] h-[60vh] bg-indigo-600/10 blur-[100px] rounded-full mix-blend-screen animate-pulse-slow"></div>
      
      <!-- Overlays -->
      <div class="absolute inset-0 bg-gradient-to-b from-[#08080a]/40 via-transparent to-[#050505] opacity-90"></div>
      <!-- 噪点纹理 -->
      <div class="absolute inset-0 bg-noise opacity-[0.04] mix-blend-overlay"></div>
    </div>

    <!-- Toast 提示 -->
    <Transition name="toast">
      <div v-if="toast.show" class="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 w-full max-w-sm">
        <div :class="['px-4 py-2.5 rounded-2xl shadow-2xl backdrop-blur-xl flex items-center gap-2.5 border', toast.type === 'success' ? 'bg-neutral-900/95 border-white/10 text-white' : 'bg-red-500/95 border-red-400/20 text-white']">
          <!-- 成功图标 -->
          <div v-if="toast.type === 'success'" class="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
            <svg class="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/>
            </svg>
          </div>
          <!-- 错误图标 -->
          <div v-else class="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
            <svg class="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </div>
          <span class="text-sm font-medium truncate">{{ toast.message }}</span>
        </div>
      </div>
    </Transition>

    <!-- 主滚动内容 -->
    <div class="relative z-10">
      <!-- 下拉刷新指示器 -->
      <div 
        v-if="pullDistance > 0 || isRefreshing"
        class="flex items-center justify-center transition-all duration-200"
        :style="{ height: `${isRefreshing ? 50 : pullDistance}px` }"
      >
        <div class="flex items-center gap-2 text-white/60 text-sm">
          <svg
            :class="['w-5 h-5 transition-transform', isRefreshing ? 'animate-spin' : pullDistance > pullThreshold ? 'rotate-180' : '']"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path v-if="isRefreshing" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            <path v-else stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
          <span>{{ isRefreshing ? '刷新中...' : pullDistance > pullThreshold ? '松开刷新' : '下拉刷新' }}</span>
        </div>
      </div>

      <!-- 头部标题 (Editorial Mode) -->
      <header class="pt-12 pb-6 px-6 md:px-10">
         <div class="inline-block px-3 py-1 rounded-full bg-white/5 border border-white/10 backdrop-blur-md mb-4">
            <span class="text-[9px] uppercase tracking-[0.4em] text-white/40 font-black">Sonic Discovery Engine</span>
         </div>
         <div class="flex items-end justify-between">
            <div>
               <h1 class="text-6xl md:text-7xl font-black text-white tracking-tighter filter drop-shadow-2xl mb-1">
                  探·索
               </h1>
               <div class="flex items-center gap-3">
                  <span class="text-[10px] uppercase tracking-[0.5em] text-cyan-400/60 font-bold">Recommended Curations</span>
                  <div class="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></div>
               </div>
            </div>
            <div class="hidden md:flex items-center gap-4 pb-2">
               <div class="text-right">
                  <p class="text-white/30 text-[9px] uppercase tracking-[0.2em] font-black">Current Version</p>
                  <p class="text-white/60 text-xs font-mono italic">iTing.v4.0_Cinematic</p>
               </div>
            </div>
         </div>
      </header>

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
          <button @click="() => loadRecommendData()" class="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm">重试</button>
        </div>
      </div>

      <div v-else class="pb-12">
      <!-- Banner 轮播区 - 飙升榜 (Cinematic Slider) -->
      <section
        ref="bannerRef"
        class="relative mx-4 md:mx-6 mt-4 rounded-[2.5rem] overflow-hidden touch-pan-y group/banner"
        @mouseenter="stopBannerTimer"
        @mouseleave="startBannerTimer"
        @touchstart="handleBannerTouchStart"
        @touchmove="handleBannerTouchMove"
        @touchend="handleBannerTouchEnd"
      >
        <div class="relative h-56 md:h-72 lg:h-80 overflow-hidden">
          <div
            class="flex h-full transition-transform duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]"
            :style="{
              transform: `translateX(calc(-${currentBannerIndex * 100}% + ${bannerOffset}px))`,
              transition: isBannerSwiping ? 'none' : 'transform 0.7s cubic-bezier(0.23,1,0.32,1)'
            }"
          >
            <div
              v-for="song in bannerSongs"
              :key="song.id"
              class="w-full h-full flex-shrink-0 cursor-pointer relative"
              @click="!isBannerSwiping && playSong(song)"
            >
              <div class="absolute inset-0">
                <img :src="getSongCover(song)" class="w-full h-full object-cover transition-transform duration-[4s] group-hover/banner:scale-110" @error="($event.target as HTMLImageElement).style.display='none'" />
                <div class="absolute inset-0 bg-gradient-to-br from-black/80 via-black/20 to-transparent"></div>
              </div>
              
              <!-- Content Overlay -->
              <div class="relative h-full flex items-center px-8 md:px-12">
                <div class="max-w-xl z-10 transition-all duration-700">
                  <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/20 border border-orange-500/20 backdrop-blur-md text-orange-400 text-[10px] font-black uppercase tracking-[0.3em] mb-4">
                    <span class="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse shadow-[0_0_8px_#f97316]"></span>
                    Surge Chart
                  </div>
                  <h2 class="text-white text-4xl md:text-6xl font-black mb-3 line-clamp-1 drop-shadow-2xl tracking-tighter">{{ song.name }}</h2>
                  <p class="text-white/60 text-sm md:text-xl mb-8 font-medium tracking-tight">{{ song.artist }}</p>
                  
                  <div class="flex items-center gap-4">
                    <button @click.stop="playSong(song)" :disabled="playingId === song.id" class="inline-flex items-center gap-3 px-8 py-4 rounded-full bg-white text-black font-black text-[10px] uppercase tracking-[0.2em] hover:bg-cyan-400 hover:text-black transition-all shadow-2xl disabled:opacity-80 active:scale-95">
                      <svg v-if="playingId === song.id" class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                      <svg v-else class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                      {{ playingId === song.id ? 'Connecting' : '立即播放' }}
                    </button>
                    <button @click.stop="addToPlaylist(song)" class="w-14 h-14 rounded-full border border-white/10 bg-black/20 backdrop-blur-md flex items-center justify-center text-white hover:bg-cyan-400/20 hover:border-cyan-400/40 hover:text-cyan-400 transition-all">
                      <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 4v16m8-8H4"/></svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Pagination Indicators -->
        <div class="absolute bottom-6 right-8 flex gap-3">
          <button
            v-for="(_, idx) in bannerSongs"
            :key="idx"
            @click="currentBannerIndex = idx"
            :class="['h-1 rounded-full transition-all duration-700', idx === currentBannerIndex ? 'w-10 bg-cyan-400 shadow-[0_0_10px_#22d3ee]' : 'w-4 bg-white/20 hover:bg-white/40']"
          ></button>
        </div>
      </section>

      <!-- 快捷入口 (Instrument Panel Modular Design) -->
      <section class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mx-4 md:mx-6 mt-12 mb-8">
        <button v-for="entry in [
          { id: 'playlist', label: '播放列表', sub: 'QUEUE', color: 'emerald', icon: 'M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z' },
          { id: 'toplist', label: '排行榜', sub: 'CHARTS', color: 'orange', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
          { id: 'aipicker', label: '音乐搜索', sub: 'EXPLORER', color: 'cyan', icon: 'M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z' },
          { id: 'favorite', label: '我的喜爱', sub: 'LOVED', color: 'rose', icon: 'M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z' }
        ]" :key="entry.id" @click="entry.id === 'toplist' ? goToToplist() : emit('navigate', entry.id)" class="group relative flex items-center p-4 rounded-3xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.08] hover:border-white/20 transition-all duration-500 overflow-hidden backdrop-blur-md shadow-2xl">
          <!-- Interior glow -->
          <div :class="[`absolute top-0 right-0 w-24 h-24 bg-${entry.color}-500 blur-3xl opacity-0 group-hover:opacity-10 transition-opacity duration-700`]"></div>
          
          <div :class="[`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 transition-all duration-500 group-hover:scale-110`, 
            entry.color === 'emerald' ? 'bg-emerald-500/10 text-emerald-400' : 
            entry.color === 'orange' ? 'bg-orange-500/10 text-orange-400' :
            entry.color === 'cyan' ? 'bg-cyan-500/10 text-cyan-400' :
            entry.color === 'rose' ? 'bg-rose-500/10 text-rose-400' : 'bg-indigo-500/10 text-indigo-400'
          ]">
            <svg class="w-6 h-6 z-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" :d="entry.icon"/></svg>
            <div class="absolute inset-0 rounded-2xl bg-current opacity-5 blur-xl group-hover:opacity-20 transition-opacity"></div>
          </div>
          
          <div class="ml-4 text-left min-w-0 flex-1">
            <p class="text-xs font-black text-white/90 tracking-tight whitespace-nowrap">{{ entry.label }}</p>
            <p class="text-[8px] uppercase tracking-[0.3em] text-white/20 font-black mt-0.5 group-hover:text-white/40 transition-colors whitespace-nowrap">{{ entry.sub }}</p>
          </div>
          
          <div class="ml-auto opacity-0 group-hover:opacity-100 transition-opacity duration-500 translate-x-2 group-hover:translate-x-0">
             <svg class="w-4 h-4 text-white/20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M9 5l7 7-7 7"/></svg>
          </div>
        </button>
      </section>

      <!-- 正在播放卡片 -->
      <section v-if="store.playlist.length > 0" class="mt-6 px-4 md:px-6">
        <div class="now-playing-card w-full rounded-2xl border border-white/10 hover:border-white/20 transition-all group relative overflow-hidden">
          <!-- 动态渐变背景 -->
          <div class="absolute inset-0 now-playing-bg"></div>
          
          <!-- 主内容区 -->
          <button @click="emit('navigate', 'playlist')" class="relative w-full p-4 flex items-center gap-4">
            <div class="relative w-14 h-14 rounded-xl overflow-hidden bg-white/10 flex-shrink-0">
              <div v-if="store.currentTrack?.cover" class="w-full h-full">
                <img :src="store.currentTrack.cover" class="w-full h-full object-cover" />
              </div>
              <div v-else class="w-full h-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-2xl">🎵</div>
              <div v-if="store.isPlaying" class="absolute inset-0 bg-black/30 flex items-center justify-center">
                <div class="flex gap-0.5">
                  <span class="w-1 h-4 bg-white rounded animate-pulse"></span>
                  <span class="w-1 h-4 bg-white rounded animate-pulse" style="animation-delay: 0.15s"></span>
                  <span class="w-1 h-4 bg-white rounded animate-pulse" style="animation-delay: 0.3s"></span>
                </div>
              </div>
            </div>
            <div class="flex-1 min-w-0 text-left">
              <p class="text-white/60 text-xs mb-1">正在播放</p>
              <p class="text-white font-medium truncate">{{ store.currentTrack?.title || '暂无播放' }}</p>
              <p class="text-white/50 text-sm truncate">{{ store.currentTrack?.artist || '点击查看播放列表' }}</p>
            </div>
            <div class="flex items-center gap-2 text-white/60">
              <span class="text-sm">{{ store.playlist.length }} 首</span>
              <svg class="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
              </svg>
            </div>
          </button>
        </div>
      </section>
      
      <!-- 随便听听入口卡片 -->
      <section class="mt-4 px-4 md:px-6">
        <button 
          @click="emit('navigate', 'random-listen')" 
          class="w-full relative p-6 rounded-3xl bg-gradient-to-br from-indigo-600/20 to-cyan-600/20 border border-white/10 hover:border-cyan-500/30 transition-all group overflow-hidden"
        >
           <div class="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(34,211,238,0.1),transparent_70%)]"></div>
           <div class="absolute top-0 right-0 w-32 h-32 bg-cyan-500/10 blur-3xl rounded-full -translate-y-1/2 translate-x-1/2 group-hover:bg-cyan-500/20 transition-colors"></div>
           
           <div class="relative flex items-center justify-between">
              <div class="flex items-center gap-4 text-left">
                 <div class="w-12 h-12 rounded-2xl bg-cyan-400/10 flex items-center justify-center text-cyan-400 group-hover:scale-110 group-hover:rotate-12 transition-transform shadow-[0_0_20px_rgba(34,211,238,0.2)]">
                    <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                 </div>
                 <div>
                    <h3 class="text-white font-black text-lg tracking-tight">随便听听</h3>
                    <p class="text-white/40 text-[10px] uppercase tracking-widest mt-0.5">Random Resonance Discovery</p>
                 </div>
              </div>
              
              <div class="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/5 group-hover:bg-cyan-400 group-hover:text-black transition-all">
                 <span class="text-white font-bold whitespace-nowrap">开启心动</span>
                 <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M13 5l7 7-7 7"/></svg>
              </div>
           </div>
        </button>
      </section>

      <!-- 热门推荐 - 热歌榜 (Editorial Selection) -->
      <section class="mt-12 px-6 md:px-10">
        <div class="flex items-center justify-between mb-8">
          <div class="flex items-center gap-3">
             <div class="w-1.5 h-6 rounded-full bg-gradient-to-b from-red-500 to-rose-600 shadow-[0_0_15px_rgba(244,63,94,0.4)]"></div>
             <h3 class="text-white text-2xl md:text-3xl font-black tracking-tighter">热歌巅峰</h3>
             <span class="text-[10px] text-white/20 font-mono tracking-[0.4em] ml-2 hidden sm:inline">TRENDING SELECTIONS</span>
          </div>
          <button @click="playAllHot" class="group flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-all">
            <span class="text-white/60 text-[10px] font-black uppercase tracking-widest group-hover:text-white transition-colors">Play All</span>
             <svg class="w-4 h-4 text-white/40 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7"/>
             </svg>
          </button>
        </div>
        
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
          <div v-for="(song, idx) in hotSongs" :key="song.id" @click="playSong(song)" :class="['group cursor-pointer transition-all duration-500', playingId === song.id ? 'scale-95 opacity-80' : 'hover:-translate-y-2 active:scale-95']">
            <div class="relative aspect-square rounded-[2rem] overflow-hidden bg-white/[0.03] border border-white/5 group-hover:border-white/20 mb-4 shadow-xl transition-all duration-500">
              <img :src="getSongCover(song)" class="absolute inset-0 w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110" @error="($event.target as HTMLImageElement).style.display='none'" />
              
              <!-- Indicator overlay -->
              <div v-if="idx < 3" :class="['absolute top-3 left-3 px-2 py-0.5 rounded-lg text-[9px] font-black shadow-2xl backdrop-blur-md border border-white/20 z-20', idx === 0 ? 'bg-orange-500/80 text-white' : idx === 1 ? 'bg-cyan-500/80 text-white' : 'bg-purple-500/80 text-white']">
                TOP {{ idx + 1 }}
              </div>

              <!-- Cinematic Hover State -->
              <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 flex flex-col justify-end p-4">
                 <div class="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center shadow-2xl translate-y-4 group-hover:translate-y-0 transition-transform duration-500">
                    <svg class="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                 </div>
              </div>
              
              <!-- Loading Overlay -->
              <div v-if="playingId === song.id" class="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-30">
                <div class="w-10 h-10 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin"></div>
              </div>
            </div>
            
            <div class="px-1">
               <h4 class="text-white text-sm font-black truncate tracking-tight group-hover:text-cyan-400 transition-colors">{{ song.name }}</h4>
               <p class="text-[10px] uppercase tracking-widest text-white/30 font-bold mt-1">{{ song.artist }}</p>
            </div>
          </div>
        </div>
      </section>

      <!-- 新歌速递 - 新歌榜 (Fresh Arrivals) -->
      <section class="mt-12 px-6 md:px-10">
        <div class="flex items-center justify-between mb-8">
          <div class="flex items-center gap-3">
             <div class="w-1.5 h-6 rounded-full bg-gradient-to-b from-cyan-400 to-blue-600 shadow-[0_0_15px_rgba(34,211,238,0.4)]"></div>
             <h3 class="text-white text-2xl md:text-3xl font-black tracking-tighter">新曲速递</h3>
             <span class="text-[10px] text-white/20 font-mono tracking-[0.4em] ml-2 hidden sm:inline">FRESH SONIC ARRIVALS</span>
          </div>
        </div>
        
        <div class="flex gap-6 overflow-x-auto pb-6 scrollbar-hide -mx-6 px-6 md:mx-0 md:px-0">
          <div v-for="song in newSongs" :key="'new-'+song.id" @click="playSong(song)" :class="['flex-shrink-0 w-40 md:w-48 cursor-pointer group transition-all duration-500', playingId === song.id ? 'scale-95 opacity-80' : 'hover:-translate-y-2 active:scale-95']">
            <div class="relative aspect-square rounded-[2rem] overflow-hidden bg-white/[0.03] border border-white/5 group-hover:border-white/20 mb-4 shadow-xl">
              <img :src="getSongCover(song)" class="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110" />
              <!-- NEW Label (Cinematic Style) -->
              <div class="absolute top-3 right-3">
                <span class="px-2 py-0.5 rounded-lg bg-cyan-400 text-black text-[9px] font-black uppercase tracking-tighter shadow-lg">New</span>
              </div>
              <div v-if="playingId === song.id" class="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center">
                <div class="w-10 h-10 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin"></div>
              </div>
            </div>
            <div class="px-1 text-center">
               <h4 class="text-white text-sm font-black truncate tracking-tight group-hover:text-cyan-400 transition-colors">{{ song.name }}</h4>
               <p class="text-[9px] uppercase tracking-[0.15em] text-white/30 font-bold mt-1">{{ song.artist }}</p>
            </div>
          </div>
        </div>
      </section>
 

    </div> <!-- v-else closing -->
   </div> <!-- relative z-10 closing -->
  </div> <!-- scrollContainer closing -->
 </template>

<style scoped>
.scrollbar-hide::-webkit-scrollbar {
  display: none;
}
.scrollbar-hide {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

/* Toast 动画 */
.toast-enter-active,
.toast-leave-active {
  transition: all 0.3s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, -20px);
}

/* 正在播放卡片动态渐变背景 */
.now-playing-bg {
  background: linear-gradient(
    135deg,
    rgba(139, 92, 246, 0.4),
    rgba(236, 72, 153, 0.4),
    rgba(59, 130, 246, 0.4),
    rgba(16, 185, 129, 0.4),
    rgba(245, 158, 11, 0.4),
    rgba(239, 68, 68, 0.4),
    rgba(139, 92, 246, 0.4)
  );
  background-size: 400% 400%;
  animation: gradientShift 12s ease infinite;
}

@keyframes gradientShift {
  0% {
    background-position: 0% 50%;
  }
  25% {
    background-position: 50% 100%;
  }
  50% {
    background-position: 100% 50%;
  }
  75% {
    background-position: 50% 0%;
  }
  100% {
    background-position: 0% 50%;
  }
}

.now-playing-card:hover .now-playing-bg {
  animation-duration: 6s;
}

/* 歌词滑动动画 */
.lyrics-slide-enter-active,
.lyrics-slide-leave-active {
  transition: all 0.3s ease;
}
.lyrics-slide-enter-from,
.lyrics-slide-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
}
.lyrics-slide-enter-to,
.lyrics-slide-leave-from {
  opacity: 1;
  max-height: 60px;
}
</style>
