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
const bannerSongs = ref<SearchResult[]>([]) // 轮播图 - 飙升榜
const hotSongs = ref<SearchResult[]>([]) // 热门推荐 - 热歌榜
const newSongs = ref<SearchResult[]>([]) // 新歌速递 - 新歌榜
const toplists = ref<ToplistItem[]>([])
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
const CACHE_KEY = 'home_recommend_cache_v3'
const CACHE_TIME_KEY = 'home_recommend_cache_time_v3'
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

    console.log('API 返回数据:', {
      neteaseSurge: neteaseSurge.length,
      qqSurge: qqSurge.length,
      neteaseHot: neteaseHot.length,
      qqHot: qqHot.length,
      neteaseNew: neteaseNew.length,
      qqNew: qqNew.length,
      toplistData: toplistData.length
    })

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

    toplists.value = toplistData.slice(0, 6)

    // 只有有数据时才缓存
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

function goToToplist() {
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
    class="flex-1 overflow-y-auto"
    @touchstart="handlePullStart"
    @touchmove.passive="handlePullMove"
    @touchend="handlePullEnd"
  >
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

    <div v-else class="pb-6">
      <!-- Banner 轮播区 - 飙升榜 -->
      <div
        ref="bannerRef"
        class="relative mx-4 md:mx-6 mt-4 md:mt-6 rounded-2xl overflow-hidden touch-pan-y"
        @mouseenter="stopBannerTimer"
        @mouseleave="startBannerTimer"
        @touchstart="handleBannerTouchStart"
        @touchmove="handleBannerTouchMove"
        @touchend="handleBannerTouchEnd"
      >
        <div class="relative h-40 md:h-56 lg:h-64 overflow-hidden">
          <div
            class="flex h-full transition-transform duration-300 ease-out"
            :style="{
              transform: `translateX(calc(-${currentBannerIndex * 100}% + ${bannerOffset}px))`,
              transition: isBannerSwiping ? 'none' : 'transform 0.3s ease-out'
            }"
          >
            <div
              v-for="song in bannerSongs"
              :key="song.id"
              class="w-full h-full flex-shrink-0 cursor-pointer relative"
              @click="!isBannerSwiping && playSong(song)"
            >
              <div class="absolute inset-0">
                <img :src="getSongCover(song)" class="w-full h-full object-cover" @error="($event.target as HTMLImageElement).style.display='none'" />
                <div class="absolute inset-0 -z-10 bg-gradient-to-br from-purple-900 via-purple-800 to-pink-900"></div>
              </div>
              <div class="absolute inset-0 bg-gradient-to-r from-black/70 via-black/40 to-transparent"></div>
              <div class="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent"></div>

              <div class="relative h-full flex items-center px-6 md:px-10">
                <div class="flex-1 pr-4 z-10">
                  <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm text-white/80 text-xs mb-3">
                    <span class="w-2 h-2 rounded-full bg-orange-400 animate-pulse"></span>
                    飙升榜
                  </div>
                  <h2 class="text-white text-xl md:text-3xl font-bold mb-2 line-clamp-1 drop-shadow-lg">{{ song.name }}</h2>
                  <p class="text-white/80 text-sm md:text-base mb-4 drop-shadow">{{ song.artist }}</p>
                  <button @click.stop="playSong(song)" :disabled="playingId === song.id" class="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white text-purple-900 font-medium text-sm hover:bg-white/90 transition-colors shadow-lg shadow-white/20 disabled:opacity-80 active:scale-95">
                    <svg v-if="playingId === song.id" class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                    <svg v-else class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    {{ playingId === song.id ? '加载中' : '立即播放' }}
                  </button>
                </div>
                <div class="hidden md:block w-36 lg:w-44 h-36 lg:h-44 rounded-xl overflow-hidden shadow-2xl shadow-black/50 flex-shrink-0 rotate-3 hover:rotate-0 transition-transform duration-300 z-10">
                  <img :src="getSongCover(song)" class="w-full h-full object-cover" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 指示器 -->
        <div class="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
          <button
            v-for="(_, idx) in bannerSongs"
            :key="idx"
            @click="currentBannerIndex = idx"
            :class="['w-2 h-2 rounded-full transition-all duration-300', idx === currentBannerIndex ? 'w-6 bg-white' : 'bg-white/40 hover:bg-white/60']"
          ></button>
        </div>
      </div>

      <!-- 快捷入口 -->
      <div class="flex gap-3 overflow-x-auto pb-2 scrollbar-hide mx-4 md:mx-6 mt-6 md:grid md:grid-cols-5 md:overflow-visible">
        <button @click="emit('navigate', 'playlist')" class="quick-entry group flex-shrink-0 w-[72px] md:w-auto">
          <div class="relative p-3 md:p-4 rounded-2xl bg-white/[0.08] backdrop-blur-sm border border-white/[0.08] hover:bg-white/[0.12] hover:border-white/[0.15] transition-all duration-300">
            <div class="absolute inset-0 rounded-2xl bg-gradient-to-br from-emerald-500/20 via-transparent to-green-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
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

        <button @click="goToToplist" class="quick-entry group flex-shrink-0 w-[72px] md:w-auto">
          <div class="relative p-3 md:p-4 rounded-2xl bg-white/[0.08] backdrop-blur-sm border border-white/[0.08] hover:bg-white/[0.12] hover:border-white/[0.15] transition-all duration-300">
            <div class="absolute inset-0 rounded-2xl bg-gradient-to-br from-orange-500/20 via-transparent to-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            <div class="relative flex flex-col items-center gap-2.5">
              <div class="w-11 h-11 md:w-12 md:h-12 rounded-xl bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center shadow-lg shadow-orange-500/30 group-hover:shadow-orange-500/50 group-hover:scale-110 group-active:scale-95 transition-all duration-300">
                <svg class="w-5 h-5 md:w-6 md:h-6 text-white drop-shadow" viewBox="0 0 24 24" fill="currentColor">
                  <path fill-rule="evenodd" d="M5.166 2.621v.858c-1.035.148-2.059.33-3.071.543a.75.75 0 00-.584.859 6.753 6.753 0 006.138 5.6 6.73 6.73 0 002.743 1.346A6.707 6.707 0 019.279 15H8.54c-1.036 0-1.875.84-1.875 1.875V19.5h-.75a2.25 2.25 0 00-2.25 2.25c0 .414.336.75.75.75h15a.75.75 0 00.75-.75 2.25 2.25 0 00-2.25-2.25h-.75v-2.625c0-1.036-.84-1.875-1.875-1.875h-.739a6.706 6.706 0 01-1.112-3.173 6.73 6.73 0 002.743-1.347 6.753 6.753 0 006.139-5.6.75.75 0 00-.585-.858 47.077 47.077 0 00-3.07-.543V2.62a.75.75 0 00-.658-.744 49.22 49.22 0 00-6.093-.377c-2.063 0-4.096.128-6.093.377a.75.75 0 00-.657.744z" clip-rule="evenodd"/>
                </svg>
              </div>
              <span class="text-white/70 text-[11px] md:text-xs font-medium group-hover:text-white transition-colors whitespace-nowrap">排行榜</span>
            </div>
          </div>
        </button>

        <button @click="emit('navigate', 'aipicker')" class="quick-entry group flex-shrink-0 w-[72px] md:w-auto">
          <div class="relative p-3 md:p-4 rounded-2xl bg-white/[0.08] backdrop-blur-sm border border-white/[0.08] hover:bg-white/[0.12] hover:border-white/[0.15] transition-all duration-300 overflow-hidden">
            <div class="absolute inset-0 rounded-2xl bg-gradient-to-br from-cyan-500/20 via-transparent to-blue-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            <div class="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping opacity-75"></div>
            <div class="relative flex flex-col items-center gap-2.5">
              <div class="w-11 h-11 md:w-12 md:h-12 rounded-xl bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center shadow-lg shadow-cyan-500/30 group-hover:shadow-cyan-500/50 group-hover:scale-110 group-active:scale-95 transition-all duration-300">
                <svg class="w-5 h-5 md:w-6 md:h-6 text-white drop-shadow" viewBox="0 0 24 24" fill="currentColor">
                  <path fill-rule="evenodd" d="M9 4.5a.75.75 0 01.721.544l.813 2.846a3.75 3.75 0 002.576 2.576l2.846.813a.75.75 0 010 1.442l-2.846.813a3.75 3.75 0 00-2.576 2.576l-.813 2.846a.75.75 0 01-1.442 0l-.813-2.846a3.75 3.75 0 00-2.576-2.576l-2.846-.813a.75.75 0 010-1.442l2.846-.813A3.75 3.75 0 007.466 7.89l.813-2.846A.75.75 0 019 4.5z" clip-rule="evenodd"/>
                </svg>
              </div>
              <span class="text-white/70 text-[11px] md:text-xs font-medium group-hover:text-white transition-colors whitespace-nowrap">AI选歌</span>
            </div>
          </div>
        </button>

        <button @click="emit('navigate', 'favorite')" class="quick-entry group flex-shrink-0 w-[72px] md:w-auto">
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

        <button @click="emit('navigate', 'offline')" class="quick-entry group flex-shrink-0 w-[72px] md:w-auto">
          <div class="relative p-3 md:p-4 rounded-2xl bg-white/[0.08] backdrop-blur-sm border border-white/[0.08] hover:bg-white/[0.12] hover:border-white/[0.15] transition-all duration-300">
            <div class="absolute inset-0 rounded-2xl bg-gradient-to-br from-indigo-500/20 via-transparent to-purple-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
            <div class="relative flex flex-col items-center gap-2.5">
              <div class="w-11 h-11 md:w-12 md:h-12 rounded-xl bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center shadow-lg shadow-indigo-500/30 group-hover:shadow-indigo-500/50 group-hover:scale-110 group-active:scale-95 transition-all duration-300">
                <svg class="w-5 h-5 md:w-6 md:h-6 text-white drop-shadow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4m4-5l5 5 5-5m-5 5V3"/>
                </svg>
              </div>
              <span class="text-white/70 text-[11px] md:text-xs font-medium group-hover:text-white transition-colors whitespace-nowrap">离线歌曲</span>
            </div>
          </div>
        </button>
      </div>

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

      <!-- 热门推荐 - 热歌榜 -->
      <section class="mt-8 px-4 md:px-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-white text-lg md:text-xl font-bold flex items-center gap-2">
            <span class="w-1 h-5 rounded-full bg-gradient-to-b from-red-500 to-orange-500"></span>
            热歌榜
          </h3>
          <button @click="playAllHot" class="text-white/60 text-sm hover:text-white transition-colors flex items-center gap-1">
            播放全部 <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
          </button>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
          <div v-for="(song, idx) in hotSongs" :key="song.id" @click="playSong(song)" :class="['group cursor-pointer transition-all duration-200', playingId === song.id ? 'scale-95 opacity-80' : 'active:scale-95']">
            <div class="relative aspect-square rounded-xl overflow-hidden bg-white/5 mb-2">
              <img :src="getSongCover(song)" class="absolute inset-0 w-full h-full object-cover" @error="($event.target as HTMLImageElement).style.display='none'" />
              <div :class="['absolute inset-0 -z-10', idx % 4 === 0 ? 'bg-gradient-to-br from-red-600 to-orange-600' : idx % 4 === 1 ? 'bg-gradient-to-br from-purple-600 to-pink-600' : idx % 4 === 2 ? 'bg-gradient-to-br from-blue-600 to-cyan-600' : 'bg-gradient-to-br from-green-600 to-teal-600']">
                <div class="absolute inset-0 flex items-center justify-center text-5xl opacity-50">🔥</div>
              </div>
              <div v-if="idx < 3" :class="['absolute top-2 left-2 w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold shadow-lg', idx === 0 ? 'bg-gradient-to-br from-yellow-400 to-orange-500 text-black' : idx === 1 ? 'bg-gradient-to-br from-gray-300 to-gray-400 text-black' : 'bg-gradient-to-br from-amber-600 to-amber-700 text-white']">{{ idx + 1 }}</div>
              <!-- 加载中状态 -->
              <div v-if="playingId === song.id" class="absolute inset-0 bg-black/60 flex items-center justify-center">
                <div class="w-10 h-10 border-3 border-white border-t-transparent rounded-full animate-spin"></div>
              </div>
              <!-- hover 状态 -->
              <div v-else class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <div class="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center group-hover:scale-110 transition-transform">
                  <svg class="w-6 h-6 text-white ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                </div>
              </div>
              <button @click.stop="addToPlaylist(song)" class="absolute bottom-2 right-2 w-8 h-8 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/60 active:scale-90">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
              </button>
            </div>
            <p class="text-white text-sm font-medium truncate">{{ song.name }}</p>
            <p class="text-white/50 text-xs truncate">{{ song.artist }}</p>
          </div>
        </div>
      </section>

      <!-- 新歌速递 - 新歌榜 -->
      <section class="mt-8 px-4 md:px-6">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-white text-lg md:text-xl font-bold flex items-center gap-2">
            <span class="w-1 h-5 rounded-full bg-gradient-to-b from-cyan-500 to-blue-500"></span>
            新歌榜
          </h3>
        </div>
        <div class="flex gap-3 overflow-x-auto pb-2 scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0 md:grid md:grid-cols-5 md:overflow-visible">
          <div v-for="song in newSongs" :key="'new-'+song.id" @click="playSong(song)" :class="['flex-shrink-0 w-32 md:w-auto cursor-pointer group transition-all duration-200', playingId === song.id ? 'scale-95 opacity-80' : 'active:scale-95']">
            <div class="relative aspect-square rounded-2xl overflow-hidden bg-white/5 mb-2">
              <img :src="getSongCover(song)" class="w-full h-full object-cover" />
              <!-- NEW标识 -->
              <div class="absolute top-2 right-2">
                <span class="px-1.5 py-0.5 rounded bg-cyan-500/80 text-white text-[10px] font-medium">NEW</span>
              </div>
              <!-- 加载中状态 -->
              <div v-if="playingId === song.id" class="absolute inset-0 bg-black/60 flex items-center justify-center">
                <div class="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              </div>
              <!-- hover 状态 -->
              <div v-else class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <div class="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                  <svg class="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                </div>
              </div>
            </div>
            <p class="text-white text-sm font-medium truncate">{{ song.name }}</p>
            <p class="text-white/50 text-xs truncate">{{ song.artist }}</p>
          </div>
        </div>
      </section>

      <!-- 排行榜入口 -->
      <section class="mt-8 px-4 md:px-6 pb-4">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-white text-lg md:text-xl font-bold flex items-center gap-2">
            <span class="w-1 h-5 rounded-full bg-gradient-to-b from-orange-500 to-red-500"></span>
            排行榜
          </h3>
          <button @click="goToToplist" class="text-white/60 text-sm hover:text-white transition-colors flex items-center gap-1">
            查看更多 <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
          </button>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
          <button v-for="(item, idx) in toplists" :key="item.id" @click="goToToplist" class="relative flex items-center gap-3 p-4 rounded-2xl bg-white/[0.06] backdrop-blur-sm border border-white/[0.06] hover:bg-white/[0.1] hover:border-white/[0.12] transition-all text-left group overflow-hidden">
            <div :class="['absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300', idx === 0 ? 'bg-gradient-to-br from-yellow-500/10 to-orange-500/5' : idx === 1 ? 'bg-gradient-to-br from-purple-500/10 to-pink-500/5' : idx === 2 ? 'bg-gradient-to-br from-blue-500/10 to-cyan-500/5' : 'bg-gradient-to-br from-green-500/10 to-teal-500/5']"></div>
            <div :class="['relative w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 shadow-lg group-hover:scale-105 transition-transform duration-300', idx === 0 ? 'bg-gradient-to-br from-yellow-400 to-orange-500 shadow-orange-500/25' : idx === 1 ? 'bg-gradient-to-br from-purple-400 to-pink-500 shadow-purple-500/25' : idx === 2 ? 'bg-gradient-to-br from-blue-400 to-cyan-500 shadow-blue-500/25' : 'bg-gradient-to-br from-green-400 to-teal-500 shadow-green-500/25']">
              <svg class="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path fill-rule="evenodd" d="M5.166 2.621v.858c-1.035.148-2.059.33-3.071.543a.75.75 0 00-.584.859 6.753 6.753 0 006.138 5.6 6.73 6.73 0 002.743 1.346A6.707 6.707 0 019.279 15H8.54c-1.036 0-1.875.84-1.875 1.875V19.5h-.75a2.25 2.25 0 00-2.25 2.25c0 .414.336.75.75.75h15a.75.75 0 00.75-.75 2.25 2.25 0 00-2.25-2.25h-.75v-2.625c0-1.036-.84-1.875-1.875-1.875h-.739a6.706 6.706 0 01-1.112-3.173 6.73 6.73 0 002.743-1.347 6.753 6.753 0 006.139-5.6.75.75 0 00-.585-.858 47.077 47.077 0 00-3.07-.543V2.62a.75.75 0 00-.658-.744 49.22 49.22 0 00-6.093-.377c-2.063 0-4.096.128-6.093.377a.75.75 0 00-.657.744z" clip-rule="evenodd"/>
              </svg>
            </div>
            <div class="flex-1 min-w-0 relative">
              <p class="text-white font-medium text-sm truncate">{{ item.name }}</p>
              <p class="text-white/40 text-xs">{{ item.updateFrequency || '实时更新' }}</p>
            </div>
          </button>
        </div>
      </section>
    </div>
  </div>
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
