<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { usePlayerStore } from '@/store/player'
import {
  getToplists,
  getToplistSongs,
  searchResultToTrack,
  getLyrics,
  getEnabledSources,
  type MusicSource,
  type ToplistItem,
  type SearchResult
} from '@/services/source/OnlineApiSource'

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

// 默认选中第一个启用的源
const currentSource = ref<MusicSource>(getEnabledSources()[0] || 'netease')
const toplists = ref<ToplistItem[]>([])
const selectedList = ref<ToplistItem | null>(null)
const songs = ref<SearchResult[]>([])
const loading = ref(false)
const loadingSongs = ref(false)

// 缓存配置
const CACHE_KEY_TOPLISTS = 'toplist_cache_lists'
const CACHE_KEY_SONGS = 'toplist_cache_songs'
const CACHE_KEY_TIME = 'toplist_cache_time'
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
    toplists.value = data
    toplistsCache.value[currentSource.value] = data
    saveToplistsCache(currentSource.value, data)
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
    return
  }

  // 无缓存时显示加载
  selectedList.value = item
  songs.value = []
  loadingSongs.value = true
  try {
    const data = await getToplistSongs(currentSource.value, item.id)
    songs.value = data
    songsCache.value[cacheKey] = data
    saveSongsCache(cacheKey, data)
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

// 获取排名样式
function getRankStyle(idx: number) {
  if (idx === 0) return 'bg-gradient-to-r from-yellow-500 to-amber-500 text-black font-bold'
  if (idx === 1) return 'bg-gradient-to-r from-gray-300 to-gray-400 text-black font-bold'
  if (idx === 2) return 'bg-gradient-to-r from-amber-600 to-amber-700 text-white font-bold'
  return 'bg-white/10 text-white/50'
}

onMounted(loadToplists)
</script>

<template>
  <div class="flex-1 overflow-y-auto p-6">
    <!-- 标题 -->
    <h2 class="text-2xl font-bold text-white mb-6">🏆 排行榜</h2>

    <!-- 平台选择（横向滚动） -->
    <div class="mb-4 -mx-4 px-4 md:mx-0 md:px-0">
      <div class="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
        <button
          v-for="s in sources"
          :key="s.value"
          @click="currentSource = s.value; loadToplists()"
          :class="[
            'px-3 md:px-4 py-2 rounded-xl text-xs md:text-sm transition-all flex items-center gap-1.5 whitespace-nowrap flex-shrink-0',
            currentSource === s.value 
              ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/30' 
              : 'bg-white/5 text-white/60 hover:bg-white/10'
          ]"
        >
          <span>{{ s.icon }}</span>
          <span>{{ s.label }}</span>
        </button>
      </div>
    </div>

    <!-- 移动端：榜单选择或歌曲列表 -->
    <div class="md:hidden">
      <!-- 榜单网格 -->
      <div v-if="!selectedList">
        <div v-if="loading" class="text-white/50 text-center py-10">
          <div class="animate-spin w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full mx-auto mb-2"></div>
          加载中...
        </div>
        <div v-else class="grid grid-cols-2 gap-2">
          <button
            v-for="(item, idx) in toplists"
            :key="item.id"
            @click="selectToplist(item)"
            class="p-3 rounded-xl bg-white/5 hover:bg-white/10 text-left transition-all active:scale-95"
          >
            <div class="flex items-start gap-2">
              <span class="text-lg">{{ idx < 3 ? ['🥇', '🥈', '🥉'][idx] : '📋' }}</span>
              <div class="flex-1 min-w-0">
                <p class="text-white text-sm font-medium truncate">{{ item.name }}</p>
                <p class="text-white/40 text-xs mt-0.5">点击查看</p>
              </div>
            </div>
          </button>
        </div>
      </div>

      <!-- 歌曲列表 -->
      <div v-else>
        <!-- 返回按钮和榜单信息 -->
        <div class="flex items-center gap-3 mb-4 p-3 rounded-xl bg-white/5">
          <button
            @click="backToList"
            class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/60 hover:bg-white/20 flex-shrink-0"
          >
            ←
          </button>
          <div class="flex-1 min-w-0">
            <p class="text-white font-medium truncate">{{ selectedList.name }}</p>
            <p class="text-white/40 text-xs">{{ songs.length }} 首歌曲</p>
          </div>
          <button
            v-if="songs.length > 0"
            @click="addAllToPlaylist"
            class="px-3 py-1.5 rounded-lg bg-purple-600 text-white text-xs flex-shrink-0"
          >
            全部添加
          </button>
        </div>

        <div v-if="loadingSongs" class="text-white/50 text-center py-10">
          <div class="animate-spin w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full mx-auto mb-2"></div>
          加载歌曲中...
        </div>
        <div v-else class="space-y-1">
          <div
            v-for="(song, idx) in songs"
            :key="song.id"
            class="flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/10 active:bg-white/15 transition-colors"
            @click="playSong(song)"
          >
            <div :class="['w-6 h-6 rounded-md flex items-center justify-center text-xs', getRankStyle(idx)]">
              {{ idx + 1 }}
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-white text-sm truncate">{{ song.name }}</p>
              <p class="text-white/50 text-xs truncate">{{ song.artist }}</p>
            </div>
            <button
              @click.stop="addToPlaylist(song)"
              class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/60 hover:bg-white/20"
            >
              +
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 桌面端：左右分栏 -->
    <div class="hidden md:flex gap-6">
      <!-- 榜单列表 -->
      <div class="w-56 flex-shrink-0">
        <div v-if="loading" class="text-white/50 text-center py-10">
          <div class="animate-spin w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full mx-auto mb-2"></div>
          加载中...
        </div>
        <div v-else class="space-y-1">
          <button
            v-for="(item, idx) in toplists"
            :key="item.id"
            @click="selectToplist(item)"
            :class="[
              'w-full text-left px-3 py-2.5 rounded-xl text-sm transition-all flex items-center gap-2',
              selectedList?.id === item.id 
                ? 'bg-purple-600/30 text-white border border-purple-500/50' 
                : 'text-white/70 hover:bg-white/10'
            ]"
          >
            <span class="text-base">{{ idx < 3 ? ['🥇', '🥈', '🥉'][idx] : '📋' }}</span>
            <span class="truncate">{{ item.name }}</span>
          </button>
        </div>
      </div>

      <!-- 歌曲列表 -->
      <div class="flex-1">
        <div v-if="!selectedList" class="text-white/40 text-center py-20">
          <p class="text-4xl mb-3">👈</p>
          <p>选择一个榜单查看歌曲</p>
        </div>
        <div v-else>
          <!-- 榜单信息 -->
          <div class="flex items-center justify-between mb-4 p-4 rounded-xl bg-white/5">
            <div>
              <h3 class="text-white font-bold text-lg">{{ selectedList.name }}</h3>
              <p class="text-white/50 text-sm">{{ songs.length }} 首歌曲</p>
            </div>
            <button
              v-if="songs.length > 0"
              @click="addAllToPlaylist"
              class="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm transition-colors"
            >
              全部添加
            </button>
          </div>

          <div v-if="loadingSongs" class="text-white/50 text-center py-10">
            <div class="animate-spin w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full mx-auto mb-2"></div>
            加载歌曲中...
          </div>
          <div v-else class="space-y-1">
            <div
              v-for="(song, idx) in songs"
              :key="song.id"
              class="flex items-center gap-4 p-3 rounded-xl hover:bg-white/10 group transition-colors cursor-pointer"
              @click="playSong(song)"
            >
              <div :class="['w-8 h-8 rounded-lg flex items-center justify-center text-sm', getRankStyle(idx)]">
                {{ idx + 1 }}
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-white text-sm truncate">{{ song.name }}</p>
                <p class="text-white/50 text-xs truncate">{{ song.artist }}</p>
              </div>
              <button
                @click.stop="addToPlaylist(song)"
                class="opacity-0 group-hover:opacity-100 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs transition-all"
              >
                添加
              </button>
            </div>
          </div>
        </div>
      </div>
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
</style>
