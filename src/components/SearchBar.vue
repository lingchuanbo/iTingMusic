<script setup lang="ts">
import { ref } from 'vue'
import { usePlayerStore } from '@/store/player'
import { 
  aggregateSearch, 
  searchResultToTrack, 
  getLyrics,
  type SearchResult, 
  type AudioQuality 
} from '@/services/source/OnlineApiSource'
import { scanLocalFiles } from '@/services/source/LocalSource'

const store = usePlayerStore()
const keyword = ref('')
const loading = ref(false)
const showResults = ref(false)
const searchResults = ref<SearchResult[]>([])
const quality = ref<AudioQuality>('320k')
const fileInput = ref<HTMLInputElement>()
const showMobileSearch = ref(false)

const qualities: { value: AudioQuality; label: string }[] = [
  { value: '128k', label: '标准' },
  { value: '320k', label: '高品' },
  { value: 'flac', label: '无损' },
  { value: 'flac24bit', label: 'Hi-Res' }
]

async function handleSearch() {
  if (!keyword.value.trim() || loading.value) return
  loading.value = true
  showResults.value = true
  try {
    searchResults.value = await aggregateSearch(keyword.value)
  } finally {
    loading.value = false
  }
}

async function addToPlaylist(result: SearchResult) {
  const track = searchResultToTrack(result, quality.value)
  // 异步获取歌词
  getLyrics(result.platform, result.id).then(lrc => {
    const t = store.playlist.find(t => t.id === track.id)
    if (t) t.lrc = lrc
  })
  store.addTrack(track)
  showResults.value = false
}

async function playNow(result: SearchResult) {
  const track = searchResultToTrack(result, quality.value)
  const lrc = await getLyrics(result.platform, result.id)
  track.lrc = lrc
  store.addTrack(track)
  store.playTrack(store.playlist.length - 1)
  showResults.value = false
}

function openFilePicker() {
  fileInput.value?.click()
}

async function handleFileSelect(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.files?.length) return
  loading.value = true
  try {
    const tracks = await scanLocalFiles(input.files)
    tracks.forEach(t => store.addTrack(t))
  } finally {
    loading.value = false
    input.value = ''
  }
}

function getPlatformIcon(platform: string) {
  const icons: Record<string, string> = {
    netease: '🎵',
    kuwo: '🎶',
    kugou: '🎤',
    qq: '🎧',
    migu: '📻'
  }
  return icons[platform] || '🎵'
}
</script>

<template>
  <div class="relative p-4">
    <!-- 桌面端：完整搜索栏 -->
    <div class="hidden md:flex items-center gap-3">
      <!-- 搜索框 -->
      <div class="flex-1 relative">
        <input
          v-model="keyword"
          @keyup.enter="handleSearch"
          @focus="searchResults.length && (showResults = true)"
          type="text"
          placeholder="搜索歌曲、歌手..."
          class="w-full h-10 pl-10 pr-4 rounded-xl bg-white/10 text-white placeholder-white/40 outline-none focus:bg-white/15 transition-colors"
        />
        <span class="absolute left-3 top-1/2 -translate-y-1/2 text-white/40">🔍</span>
      </div>
      
      <!-- 音质选择 -->
      <select
        v-model="quality"
        class="h-10 px-3 rounded-xl bg-white/10 text-white outline-none cursor-pointer"
      >
        <option v-for="q in qualities" :key="q.value" :value="q.value" class="bg-neutral-800">
          {{ q.label }}
        </option>
      </select>
      
      <!-- 搜索按钮 -->
      <button
        @click="handleSearch"
        :disabled="loading"
        class="h-10 px-4 rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors disabled:opacity-50"
      >
        {{ loading ? '...' : '搜索' }}
      </button>
      
      <!-- 本地文件 -->
      <button
        @click="openFilePicker"
        class="h-10 px-4 rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors"
      >
        📁
      </button>
    </div>

    <!-- 移动端：搜索按钮 -->
    <div class="flex md:hidden">
      <button
        @click="showMobileSearch = true"
        class="flex-1 h-10 px-4 rounded-xl bg-white/10 text-white/50 flex items-center gap-2"
      >
        <span>🔍</span>
        <span>搜索歌曲、歌手...</span>
      </button>
    </div>
      
    <input
      ref="fileInput"
      type="file"
      accept="audio/*"
      multiple
      class="hidden"
      @change="handleFileSelect"
    />
    
    <!-- 桌面端搜索结果下拉 -->
    <Transition name="fade">
      <div 
        v-if="showResults && searchResults.length"
        class="hidden md:block absolute left-4 right-4 top-full mt-2 max-h-80 overflow-y-auto rounded-xl bg-black/80 backdrop-blur-xl border border-white/10 z-50"
      >
        <div class="p-2">
          <div
            v-for="result in searchResults"
            :key="`${result.platform}-${result.id}`"
            class="flex items-center gap-3 p-2 rounded-lg hover:bg-white/10 cursor-pointer group"
          >
            <span class="text-lg">{{ getPlatformIcon(result.platform) }}</span>
            <div class="flex-1 min-w-0" @click="playNow(result)">
              <p class="text-white text-sm truncate">{{ result.name }}</p>
              <p class="text-white/50 text-xs truncate">{{ result.artist }}</p>
            </div>
            <button
              @click.stop="addToPlaylist(result)"
              class="opacity-0 group-hover:opacity-100 px-2 py-1 text-xs rounded bg-white/10 hover:bg-white/20 transition-all"
            >
              添加
            </button>
          </div>
        </div>
        
        <!-- 关闭按钮 -->
        <button
          @click="showResults = false"
          class="w-full p-2 text-white/40 text-sm hover:bg-white/5 border-t border-white/10"
        >
          关闭
        </button>
      </div>
    </Transition>
    
    <!-- 点击外部关闭（桌面端） -->
    <div 
      v-if="showResults"
      class="hidden md:block fixed inset-0 z-40"
      @click="showResults = false"
    ></div>

    <!-- 移动端搜索浮窗 -->
    <Transition name="modal">
      <div 
        v-if="showMobileSearch"
        class="md:hidden fixed inset-0 z-50 bg-black/90 backdrop-blur-xl flex flex-col"
      >
        <!-- 顶部搜索栏 -->
        <div class="p-4 border-b border-white/10">
          <div class="flex items-center gap-2">
            <button
              @click="showMobileSearch = false"
              class="w-10 h-10 rounded-xl flex items-center justify-center text-white/60"
            >
              ←
            </button>
            <div class="flex-1 relative">
              <input
                ref="mobileSearchInput"
                v-model="keyword"
                @keyup.enter="handleSearch"
                type="text"
                placeholder="搜索歌曲、歌手..."
                class="w-full h-10 pl-10 pr-4 rounded-xl bg-white/10 text-white placeholder-white/40 outline-none focus:bg-white/15"
                autofocus
              />
              <span class="absolute left-3 top-1/2 -translate-y-1/2 text-white/40">🔍</span>
            </div>
            <button
              @click="handleSearch"
              :disabled="loading"
              class="h-10 px-4 rounded-xl bg-purple-600 text-white disabled:opacity-50"
            >
              {{ loading ? '...' : '搜索' }}
            </button>
          </div>
          <!-- 音质选择 -->
          <div class="flex items-center gap-2 mt-3">
            <span class="text-white/40 text-xs">音质:</span>
            <div class="flex gap-1">
              <button
                v-for="q in qualities"
                :key="q.value"
                @click="quality = q.value"
                :class="[
                  'px-3 py-1 rounded-full text-xs transition-colors',
                  quality === q.value ? 'bg-purple-600 text-white' : 'bg-white/10 text-white/60'
                ]"
              >
                {{ q.label }}
              </button>
            </div>
          </div>
        </div>

        <!-- 搜索结果 -->
        <div class="flex-1 overflow-y-auto p-4">
          <div v-if="loading" class="text-center py-10 text-white/40">
            搜索中...
          </div>
          <div v-else-if="searchResults.length === 0" class="text-center py-10 text-white/40">
            输入关键词搜索歌曲
          </div>
          <div v-else class="space-y-1">
            <div
              v-for="result in searchResults"
              :key="`${result.platform}-${result.id}`"
              class="flex items-center gap-3 p-3 rounded-xl active:bg-white/10"
              @click="playNow(result); showMobileSearch = false"
            >
              <span class="text-lg">{{ getPlatformIcon(result.platform) }}</span>
              <div class="flex-1 min-w-0">
                <p class="text-white text-sm truncate">{{ result.name }}</p>
                <p class="text-white/50 text-xs truncate">{{ result.artist }}</p>
              </div>
              <button
                @click.stop="addToPlaylist(result)"
                class="px-3 py-1.5 text-xs rounded-lg bg-white/10 text-white/70"
              >
                +
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

.modal-enter-active, .modal-leave-active {
  transition: opacity 0.25s, transform 0.25s;
}
.modal-enter-from {
  opacity: 0;
  transform: translateY(100%);
}
.modal-leave-to {
  opacity: 0;
  transform: translateY(100%);
}
</style>
