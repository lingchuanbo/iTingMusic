<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { usePlayerStore } from '@/store/player'
import {
  getToplists,
  getToplistSongs,
  searchResultToTrack,
  getLyrics,
  type MusicSource,
  type ToplistItem,
  type SearchResult
} from '@/services/source/OnlineApiSource'

const store = usePlayerStore()
const sources: { value: MusicSource; label: string }[] = [
  { value: 'netease', label: '网易云' },
  { value: 'kuwo', label: '酷我' },
  { value: 'kugou', label: '酷狗' },
  { value: 'qq', label: 'QQ音乐' },
  { value: 'migu', label: '咪咕' }
]

const currentSource = ref<MusicSource>('netease')
const toplists = ref<ToplistItem[]>([])
const selectedList = ref<ToplistItem | null>(null)
const songs = ref<SearchResult[]>([])
const loading = ref(false)
const loadingSongs = ref(false)

async function loadToplists() {
  loading.value = true
  try {
    toplists.value = await getToplists(currentSource.value)
    selectedList.value = null
    songs.value = []
  } finally {
    loading.value = false
  }
}

async function selectToplist(item: ToplistItem) {
  selectedList.value = item
  loadingSongs.value = true
  try {
    songs.value = await getToplistSongs(currentSource.value, item.id)
  } finally {
    loadingSongs.value = false
  }
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

onMounted(loadToplists)
</script>

<template>
  <div class="flex-1 overflow-y-auto p-6">
    <h2 class="text-2xl font-bold text-white mb-4">🏆 排行榜</h2>

    <!-- 平台选择 -->
    <div class="flex gap-2 mb-6">
      <button
        v-for="s in sources"
        :key="s.value"
        @click="currentSource = s.value; loadToplists()"
        :class="[
          'px-4 py-2 rounded-lg text-sm transition-colors',
          currentSource === s.value ? 'bg-white/20 text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'
        ]"
      >
        {{ s.label }}
      </button>
    </div>

    <div class="flex gap-6">
      <!-- 榜单列表 -->
      <div class="w-48 flex-shrink-0">
        <div v-if="loading" class="text-white/50">加载中...</div>
        <div v-else class="space-y-1">
          <button
            v-for="item in toplists"
            :key="item.id"
            @click="selectToplist(item)"
            :class="[
              'w-full text-left px-3 py-2 rounded-lg text-sm truncate transition-colors',
              selectedList?.id === item.id ? 'bg-white/20 text-white' : 'text-white/70 hover:bg-white/10'
            ]"
          >
            {{ item.name }}
          </button>
        </div>
      </div>

      <!-- 歌曲列表 -->
      <div class="flex-1">
        <div v-if="!selectedList" class="text-white/40 text-center py-10">
          ← 选择一个榜单
        </div>
        <div v-else-if="loadingSongs" class="text-white/50">加载歌曲中...</div>
        <div v-else class="space-y-1">
          <div
            v-for="(song, idx) in songs"
            :key="song.id"
            class="flex items-center gap-3 p-2 rounded-lg hover:bg-white/10 group"
          >
            <span class="w-6 text-white/40 text-sm text-right">{{ idx + 1 }}</span>
            <div class="flex-1 min-w-0 cursor-pointer" @click="playSong(song)">
              <p class="text-white text-sm truncate">{{ song.name }}</p>
              <p class="text-white/50 text-xs truncate">{{ song.artist }}</p>
            </div>
            <button
              @click="addToPlaylist(song)"
              class="opacity-0 group-hover:opacity-100 text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/20"
            >
              +
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
