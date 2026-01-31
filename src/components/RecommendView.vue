<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { usePlayerStore } from '@/store/player'
import { recommendationService, type AIExpertRecommendation } from '@/services/RecommendationService'
import { trackStorage } from '@/services/TrackStorage'
import { aggregateSearch, searchResultToTrack } from '@/services/source/OnlineApiSource'
import type { RecommendItem, Track } from '@/types'

const store = usePlayerStore()

// 状态数据
const loading = ref(true)
const loadError = ref('')
const hotRecommendations = ref<RecommendItem[]>([])
const similarRecommendations = ref<RecommendItem[]>([])
const aiExpertRec = ref<AIExpertRecommendation | null>(null)
const aiLoading = ref(false)
const isRefreshing = ref(false)
const currentTab = ref<'journal' | 'similar' | 'hot'>('journal')

const tabs = [
  { id: 'journal', name: 'AI 期刊', icon: '✍️' },
  { id: 'similar', name: '相似发现', icon: '🔍' },
  { id: 'hot', name: '热门精选', icon: '🔥' }
] as const

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
  // 如果下拉距离大于0，针对首元素阻止默认滚动（实现橡皮筋效果）
  if (pullCurrentY.value - pullStartY.value > 0 && scrollContainer.value?.scrollTop === 0) {
    if (e.cancelable) e.preventDefault()
  }
}

async function handlePullEnd() {
  if (!isPulling.value) return
  const dist = pullCurrentY.value - pullStartY.value
  if (dist > pullThreshold && !isRefreshing.value) {
    await refresh()
  }
  isPulling.value = false
  pullStartY.value = 0
  pullCurrentY.value = 0
}

// Toast 提示
const toast = ref({ show: false, message: '', type: 'success' as 'success' | 'error' })

function showToast(message: string, type: 'success' | 'error' = 'success') {
  toast.value = { show: true, message, type }
  setTimeout(() => { toast.value.show = false }, 2000)
}

// 加载推荐核心逻辑
async function loadRecommendations(forceRefresh = false) {
  loading.value = true
  loadError.value = ''
  
  try {
    // 如果强制刷新，清除缓存
    if (forceRefresh) {
      recommendationService.clearCache()
    }
    
    // 获取热门推荐
    const hot = await recommendationService.getHotRecommendations(12)
    // 为热门推荐生成 AI 理由（前3个）
    hotRecommendations.value = await recommendationService.generateRecommendReasons(hot, 3)
    
    // 获取相似推荐（基于当前播放）
    if (store.currentTrack) {
      const similar = await recommendationService.getSimilarRecommendations(store.currentTrack, 8)
      similarRecommendations.value = await recommendationService.generateRecommendReasons(similar, 2)
      
      // 异步加载 AI 专家建议
      loadExpertRecommendation(store.currentTrack)
    }
  } catch (e: any) {
    loadError.value = e.message || '加载推荐失败'
    console.error('加载推荐失败:', e)
  } finally {
    loading.value = false
  }
}

// 刷新处理
async function refresh() {
  if (isRefreshing.value) return
  isRefreshing.value = true
  await loadRecommendations(true)
  isRefreshing.value = false
  showToast('已刷新推荐')
}

// 播放歌曲
async function playSong(rec: RecommendItem | any, isExpert = false) {
  try {
    let track: Track
    if (isExpert) {
      // AI 专家推荐的是标题和艺人，需要搜索一次获取详细信息
      showToast(`正在为您寻找: ${rec.title}...`)
      const results = await aggregateSearch(`${rec.title} ${rec.artist}`)
      if (results && results.length > 0) {
        track = searchResultToTrack(results[0])
      } else {
        throw new Error('未找到该歌曲')
      }
    } else {
      track = rec.track
    }

    trackStorage.saveTrack(track)
    store.addTrack(track)
    const idx = store.playlist.findIndex(t => t.id === track.id)
    if (idx >= 0) {
      store.playTrack(idx)
    }
    showToast(`正在播放: ${track.title}`)
  } catch (e: any) {
    showToast(e.message || '播放失败', 'error')
  }
}

async function loadExpertRecommendation(track: Track) {
  aiLoading.value = true
  aiExpertRec.value = null
  try {
    const result = await recommendationService.getAIExpertRecommendations(track)
    if (result) {
      aiExpertRec.value = result
    }
  } catch (e) {
    console.error('AI 专家推荐加载失败:', e)
  } finally {
    aiLoading.value = false
  }
}

// 播放全部热门
function playAllHot() {
  if (hotRecommendations.value.length === 0) return
  
  const tracks = hotRecommendations.value.map(r => r.track)
  tracks.forEach(t => trackStorage.saveTrack(t))
  store.setPlaylist(tracks)
  store.playTrack(0)
  showToast('开始播放热门推荐')
}



// 监听播放轨道变化，异步更新相似推荐
watch(() => store.currentTrack, async (newTrack) => {
  if (newTrack && !loading.value) {
    const similar = await recommendationService.getSimilarRecommendations(newTrack, 8)
    similarRecommendations.value = await recommendationService.generateRecommendReasons(similar, 2)
  }
})

// 扁平化 AI 专家推荐歌曲列表
const flattenedExpertSongs = computed(() => {
  if (!aiExpertRec.value) return []
  const songs: any[] = []
  aiExpertRec.value.categories.forEach(cat => {
    cat.songs.forEach(song => {
      songs.push({
        ...song,
        categoryName: cat.name
      })
    })
  })
  return songs
})

onMounted(async () => {
  // 预热本地相似度矩阵
  recommendationService.warmupSimilarityMatrix().catch(e => {
    console.warn('预热相似度矩阵失败:', e)
  })
  // 初次加载
  loadRecommendations()
})
</script>

<template>
  <div 
    ref="scrollContainer"
    class="flex-1 overflow-y-auto pb-24 pt-4 relative bg-[#050505] text-white selection:bg-purple-500/30"
    @touchstart="handlePullStart"
    @touchmove.passive="handlePullMove"
    @touchend="handlePullEnd"
  >
    <!-- 背景氛围光效 (Vibrant Modern Edition) -->
    <div class="absolute inset-0 pointer-events-none overflow-hidden h-full">
      <!-- Mesh Gradients -->
      <div class="absolute -top-[5%] -left-[10%] w-[70vh] h-[70vh] bg-cyan-500/10 blur-[100px] rounded-full mix-blend-screen animate-pulse-slow"></div>
      <div class="absolute top-[15%] -right-[5%] w-[60vh] h-[60vh] bg-fuchsia-600/15 blur-[90px] rounded-full mix-blend-screen animate-float"></div>
      <div class="absolute bottom-[10%] left-[10%] w-[50vh] h-[50vh] bg-indigo-600/10 blur-[90px] rounded-full mix-blend-screen animate-pulse-slow"></div>
      
      <!-- Overlays -->
      <div class="absolute inset-0 bg-gradient-to-b from-[#08080a]/40 via-transparent to-[#050505] opacity-90"></div>
      <!-- 噪点纹理 -->
      <div class="absolute inset-0 bg-noise opacity-[0.04] mix-blend-overlay"></div>
    </div>

    <!-- Toast 提示容器 -->
    <Transition name="toast">
      <div v-if="toast.show" class="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 w-full max-w-sm">
        <div :class="[
          'flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg backdrop-blur-xl',
          toast.type === 'success' ? 'bg-green-500/90 text-white' : 'bg-red-500/90 text-white'
        ]">
          <span class="text-sm font-medium truncate">{{ toast.message }}</span>
        </div>
      </div>
    </Transition>

    <!-- 下拉刷新视觉指示器 -->
    <div 
      v-if="pullDistance > 0 || isRefreshing"
      class="flex items-center justify-center transition-all duration-200 overflow-hidden"
      :style="{ height: `${isRefreshing ? 40 : pullDistance}px` }"
    >
      <div class="flex items-center gap-2 text-white/50 text-[10px] tracking-widest uppercase font-bold">
        <svg
          :class="['w-3.5 h-3.5 transition-transform', isRefreshing ? 'animate-spin' : pullDistance > pullThreshold ? 'rotate-180' : '']"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path v-if="isRefreshing" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          <path v-else stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
        </svg>
        <span>{{ isRefreshing ? 'Syncing...' : pullDistance > pullThreshold ? 'Release' : 'Pull' }}</span>
      </div>
    </div>

    <!-- 选项卡导航栏 (Modern Pill Dock Style) -->
    <div class="sticky top-0 z-40 px-6 mb-10 pt-2">
      <div class="backdrop-blur-3xl bg-black/40 border border-white/10 rounded-[2rem] p-1.5 shadow-2xl flex items-center justify-around ring-1 ring-white/5">
        <button 
          v-for="tab in tabs" 
          :key="tab.id"
          @click="currentTab = tab.id"
          class="relative flex items-center justify-center py-2.5 flex-1 transition-all duration-500 group"
        >
          <span 
            class="text-[10px] font-black tracking-[0.3em] uppercase relative z-10 transition-colors duration-500"
            :class="currentTab === tab.id ? 'text-white' : 'text-white/30 group-hover:text-white/60'"
          >
            {{ tab.name }}
          </span>
          
          <!-- 激活状态光效 -->
          <div 
            v-if="currentTab === tab.id" 
            class="absolute inset-0 bg-gradient-to-r from-white/10 to-white/5 rounded-[1.5rem] shadow-[0_0_20px_rgba(255,255,255,0.05)_inset] animate-fade-in"
          ></div>
          <!-- 底部高亮点 -->
          <div 
            v-if="currentTab === tab.id"
            class="absolute -bottom-0.5 w-1 h-1 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.8)] animate-pulse"
          ></div>
        </button>
      </div>
    </div>

    <!-- 中间容器：区分加载、错误及内容 -->
    <div class="content-wrapper min-h-[450px]">
      <!-- 1. 加载中状态 -->
      <div v-if="loading" class="flex flex-col items-center justify-center py-32">
        <div class="relative w-12 h-12">
          <div class="absolute inset-0 border-[3px] border-purple-500/10 rounded-full"></div>
          <div class="absolute inset-0 border-[3px] border-transparent border-t-purple-500 rounded-full animate-spin"></div>
        </div>
        <p class="text-white/20 text-[9px] mt-8 tracking-[0.4em] uppercase font-black">Curating Your Vibe</p>
      </div>

      <!-- 2. 加载错误状态 -->
      <div v-else-if="loadError" class="flex flex-col items-center justify-center py-24 px-6 text-center">
        <div class="w-20 h-20 rounded-[2.5rem] bg-white/[0.03] flex items-center justify-center text-4xl mb-6 border border-white/5">🌪️</div>
        <p class="text-white/40 text-xs max-w-[240px] leading-relaxed font-medium uppercase tracking-tight">{{ loadError }}</p>
        <button @click="loadRecommendations(true)" class="mt-8 px-10 py-3 bg-white text-black font-black rounded-full text-[10px] hover:bg-indigo-50 transition-all uppercase tracking-[0.2em] shadow-xl active:scale-95">
          Try Again
        </button>
      </div>

      <!-- 3. 推荐内容展示 -->
      <div v-else class="px-4 pb-16">
        <Transition name="fade-up" mode="out-in">
          <!-- A. AI 期刊标签页 -->
          <div v-if="currentTab === 'journal'" key="journal" class="space-y-12">
            <section v-if="store.currentTrack" class="relative">
              <!-- 精致头部 (Modern Bold) -->
              <div class="flex items-center justify-between mb-10 px-2 relative z-10">
                <div class="flex flex-col">
                  <div class="flex items-center gap-2 mb-2">
                    <div class="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]"></div>
                    <p class="text-[10px] text-cyan-400 uppercase tracking-[0.4em] font-black">AI Curated Report</p>
                  </div>
                  <h2 class="text-4xl font-black tracking-tighter text-white">智.能期刊</h2>
                </div>
                
                <button 
                  @click="loadExpertRecommendation(store.currentTrack)"
                  :disabled="aiLoading"
                  class="group flex items-center justify-center w-12 h-12 rounded-[1.5rem] bg-white/5 border border-white/10 hover:bg-white/10 transition-all shadow-xl"
                >
                  <svg 
                    class="w-5 h-5 text-white/40 group-hover:text-cyan-400 group-hover:rotate-180 transition-all duration-700" 
                    :class="{'animate-spin': aiLoading}"
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </div>

              <!-- 内容展示 -->
              <div v-if="aiExpertRec" class="space-y-12 relative">
                <!-- 氛围背景光 -->
                <div class="absolute -top-20 -right-20 w-80 h-80 bg-purple-900/20 blur-[100px] rounded-full mix-blend-screen pointer-events-none animate-pulse-slow"></div>
                <div class="absolute top-40 -left-20 w-60 h-60 bg-blue-900/10 blur-[80px] rounded-full mix-blend-screen pointer-events-none"></div>

                <!-- AI 寄语 (Modern Blockquote Style) -->
                <div class="relative mx-2">
                   <div class="relative p-7 rounded-[2.5rem] bg-black/40 border border-white/10 backdrop-blur-3xl overflow-hidden shadow-2xl">
                      <div class="absolute -top-10 -right-10 w-40 h-40 bg-cyan-500/10 blur-3xl rounded-full"></div>
                      <div class="absolute -bottom-10 -left-10 w-32 h-32 bg-fuchsia-600/10 blur-3xl rounded-full"></div>
                      <p class="text-lg leading-[1.6] text-white/90 font-bold tracking-tight relative z-10 italic">
                        {{ aiExpertRec.reason }}
                      </p>
                   </div>
                </div>

                <!-- 极简分割线 -->
                <div class="flex items-center justify-center gap-4 opacity-20">
                   <div class="h-px bg-gradient-to-r from-transparent via-white to-transparent w-full"></div>
                   <span class="text-[9px] uppercase tracking-[0.3em] whitespace-nowrap">Featured Tracks</span>
                   <div class="h-px bg-gradient-to-r from-transparent via-white to-transparent w-full"></div>
                </div>

                <!-- 歌曲列表 (Floating Glass Cards) -->
                <div class="grid grid-cols-1 gap-3 px-2">
                  <div 
                    v-for="(song, index) in flattenedExpertSongs" 
                    :key="song.title + index"
                    @click="playSong(song, true)"
                    class="group relative p-4 rounded-[2rem] bg-white/[0.03] border border-white/10 hover:bg-white/5 transition-all duration-500 flex items-center gap-5 overflow-hidden shadow-lg hover:shadow-2xl hover:-translate-y-1"
                  >
                    <!-- Background Glow -->
                    <div class="absolute inset-0 bg-gradient-to-r from-cyan-400/5 to-fuchsia-500/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    
                    <!-- Index -->
                    <div class="relative w-10 h-10 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                       <span class="text-[10px] font-black text-cyan-400/60 uppercase tracking-widest">0{{ index + 1 }}</span>
                    </div>

                    <!-- Content -->
                    <div class="flex-1 min-w-0">
                      <div class="flex items-baseline justify-between gap-4 mb-0.5">
                        <h4 class="text-base font-black text-white group-hover:text-cyan-400 transition-colors truncate tracking-tighter">{{ song.title }}</h4>
                      </div>
                      <p class="text-[11px] text-white/40 group-hover:text-white/60 transition-colors line-clamp-1 font-bold tracking-tight">
                        {{ song.comment }}
                      </p>
                    </div>

                    <!-- Play Decor -->
                    <div class="w-8 h-8 rounded-full border border-white/10 flex items-center justify-center shrink-0 opacity-0 group-hover:opacity-100 transition-all scale-50 group-hover:scale-100 text-white/40 group-hover:text-white group-hover:bg-white/10">
                       <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 极简加载状态 -->
              <div v-else-if="aiLoading" class="space-y-8 px-4">
                <div class="space-y-3">
                   <div class="h-4 w-3/4 bg-white/[0.02] rounded animate-pulse"></div>
                   <div class="h-4 w-1/2 bg-white/[0.02] rounded animate-pulse"></div>
                   <div class="h-4 w-5/6 bg-white/[0.02] rounded animate-pulse"></div>
                </div>
                <div class="pt-8 space-y-6">
                   <div v-for="i in 3" :key="i" class="flex gap-4">
                      <div class="w-8 h-8 rounded-full bg-white/[0.02] animate-pulse"></div>
                      <div class="flex-1 space-y-2">
                         <div class="h-3 w-1/3 bg-white/[0.02] rounded animate-pulse"></div>
                         <div class="h-12 w-full bg-white/[0.02] rounded-xl animate-pulse"></div>
                      </div>
                   </div>
                </div>
              </div>
            </section>
          </div>

          <!-- B. 相似发现标签页 -->
          <div v-else-if="currentTab === 'similar'" key="similar" class="space-y-8">
            <section v-if="similarRecommendations.length > 0">
              <div class="grid grid-cols-1 gap-3 px-2">
                <div 
                  v-for="(rec, index) in similarRecommendations" 
                  :key="rec.track.id"
                  @click="playSong(rec)"
                  class="group relative p-4 rounded-[2.5rem] bg-white/[0.03] border border-white/10 hover:bg-white/5 transition-all duration-500 flex items-center gap-5 overflow-hidden shadow-lg hover:shadow-2xl hover:-translate-y-1"
                >
                  <!-- Background Glow -->
                  <div class="absolute inset-0 bg-gradient-to-r from-indigo-500/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                  
                  <!-- Index -->
                  <div class="relative w-12 h-12 rounded-[1.5rem] bg-white/5 border border-white/10 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform shadow-inner">
                     <span class="text-[11px] font-black text-indigo-400/60 uppercase tracking-widest">{{ String(index + 1).padStart(2, '0') }}</span>
                  </div>

                  <!-- Content -->
                  <div class="flex-1 min-w-0">
                    <div class="flex items-baseline justify-between gap-4 mb-0.5">
                      <h3 class="text-base font-black text-white group-hover:text-indigo-400 transition-colors truncate tracking-tighter">
                        {{ rec.track.title }}
                      </h3>
                      <span class="text-[9px] text-white/20 uppercase font-black tracking-widest shrink-0">{{ rec.track.artist }}</span>
                    </div>
                    <div v-if="rec.reason" class="flex items-center gap-1.5 mt-1">
                       <p class="text-[10px] text-white/40 group-hover:text-white/60 transition-colors line-clamp-1 font-bold tracking-tight">
                         {{ rec.reason }}
                       </p>
                    </div>
                  </div>

                  <!-- Play Decor -->
                  <div class="w-8 h-8 rounded-full border border-white/10 flex items-center justify-center shrink-0 opacity-0 group-hover:opacity-100 transition-all scale-50 group-hover:scale-100 text-white/40 group-hover:text-white group-hover:bg-white/10">
                     <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                  </div>
                </div>
              </div>
            </section>
            
            <div v-else class="py-32 text-center opacity-10">
              <span class="text-[10px] uppercase font-black tracking-[0.6em]">Void</span>
            </div>
          </div>

          <!-- C. 热门精选 -->
          <div v-else-if="currentTab === 'hot'" key="hot" class="space-y-6">
            <div class="flex items-end justify-between px-3 mt-4">
              <div class="flex flex-col">
                <div class="flex items-center gap-2 mb-1">
                  <div class="w-1.5 h-1.5 rounded-full bg-fuchsia-500 shadow-[0_0_8px_rgba(217,70,239,0.8)]"></div>
                  <p class="text-[10px] text-fuchsia-400 uppercase tracking-[0.4em] font-black">Trending Now</p>
                </div>
                <h2 class="text-3xl font-black tracking-tighter text-white">热门精选</h2>
              </div>
              <button @click="playAllHot" class="px-6 py-2 rounded-2xl bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest hover:bg-white hover:text-black transition-all shadow-xl active:scale-95">
                Play All
              </button>
            </div>

            <div class="grid grid-cols-2 gap-4 px-1">
              <div 
                v-for="rec in hotRecommendations" 
                :key="rec.track.id"
                @click="playSong(rec)"
                class="group relative aspect-[4/5] rounded-[2rem] overflow-hidden cursor-pointer shadow-lg hover:shadow-2xl transition-all duration-500 border border-white/10"
              >
                <!-- 全屏封面背景 -->
                <div class="absolute inset-0 bg-neutral-900">
                   <img 
                     v-if="rec.track.cover" 
                     :src="rec.track.cover" 
                     class="w-full h-full object-cover opacity-80 group-hover:opacity-100 group-hover:scale-110 transition-all duration-1000 ease-[cubic-bezier(0.25,0.8,0.25,1)]" 
                     loading="lazy" 
                   />
                   <div v-else class="w-full h-full flex items-center justify-center text-4xl bg-gradient-to-br from-indigo-900 to-purple-900">🎵</div>
                </div>
                
                <!-- 渐变遮罩 -->
                <div class="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black via-black/60 to-transparent"></div>

                <!-- 浮动内容 -->
                <div class="absolute inset-x-0 bottom-0 p-5 transform translate-y-2 group-hover:translate-y-0 transition-transform duration-500">
                  <div class="flex items-end justify-between">
                    <div class="min-w-0 pr-2">
                      <h3 class="text-[15px] font-black text-white leading-tight mb-1 truncate tracking-tight shadow-black drop-shadow-md">{{ rec.track.title }}</h3>
                      <p class="text-[10px] text-white/60 uppercase tracking-widest truncate font-bold">{{ rec.track.artist }}</p>
                    </div>
                    
                    <!-- 播放按钮 (Hover 显示) -->
                    <div class="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center opacity-0 scale-50 group-hover:opacity-100 group-hover:scale-100 transition-all duration-300 shadow-[0_0_20px_rgba(255,255,255,0.3)]">
                       <svg class="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z"/>
                       </svg>
                    </div>
                  </div>
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
/* 开启字距混排，提升阅读质感 */
.font-black {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
}

/* 噪点纹理背景 */
.bg-noise {
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
}

/* 呼吸动画 */
.animate-pulse-slow {
  animation: pulse 12s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.15; transform: scale(1); }
  50% { opacity: 0.35; transform: scale(1.15); }
}

.animate-float {
  animation: float 15s ease-in-out infinite;
}
@keyframes float {
  0%, 100% { transform: translate(0, 0) scale(1); }
  33% { transform: translate(2%, 4%) scale(1.05); }
  66% { transform: translate(-2%, 2%) scale(0.95); }
}

.animate-fade-in {
  animation: fadeIn 0.8s ease-out forwards;
}
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(5px); }
  to { opacity: 1; transform: translateY(0); }
}

/* 隐藏滚动条 */
.overflow-y-auto::-webkit-scrollbar {
  display: none;
}
.overflow-y-auto {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.4s cubic-bezier(0.18, 0.89, 0.32, 1.28);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, -40px);
}

.fade-up-enter-active,
.fade-up-leave-active {
  transition: all 0.7s cubic-bezier(0.05, 0.7, 0.1, 1);
}

.fade-up-enter-from {
  opacity: 0;
  transform: translateY(40px) scale(0.98);
}

.fade-up-leave-to {
  opacity: 0;
  transform: translateY(-40px) scale(1.02);
}

.whitespace-pre-line {
  word-break: break-word;
}
</style>
