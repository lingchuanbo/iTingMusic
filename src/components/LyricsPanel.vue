<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { usePlayerStore } from '@/store/player'
import { parseLyrics, getCurrentLyricIndex } from '@/utils/parseLyrics'
import { getLyrics, type MusicSource } from '@/services/source/OnlineApiSource'

const store = usePlayerStore()
const lyricsContainer = ref<HTMLElement>()
const loadingLyrics = ref(false)

const lyrics = computed(() => {
  return store.currentTrack?.lrc ? parseLyrics(store.currentTrack.lrc) : []
})

const currentLyricIndex = computed(() => {
  return getCurrentLyricIndex(lyrics.value, store.currentTime)
})

// 自动滚动到当前歌词
watch(currentLyricIndex, (index) => {
  if (index >= 0 && lyricsContainer.value) {
    const el = lyricsContainer.value.children[index] as HTMLElement
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
})

// 当打开歌词面板时，如果没有歌词则尝试加载
watch(() => store.showLyrics, async (show) => {
  const track = store.currentTrack
  if (show && track && !track.lrc && track._platform && track._songId) {
    loadingLyrics.value = true
    try {
      const lrc = await getLyrics(track._platform as MusicSource, track._songId)
      if (lrc) track.lrc = lrc
    } finally {
      loadingLyrics.value = false
    }
  }
})
</script>

<template>
  <Transition name="slide">
    <div 
      v-if="store.showLyrics && store.currentTrack"
      class="fixed inset-0 z-50 bg-black/90 backdrop-blur-3xl flex"
    >
      <!-- 关闭按钮 -->
      <button 
        @click="store.toggleLyrics()"
        class="absolute top-6 right-6 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors z-10"
      >
        ✕
      </button>
      
      <!-- 左侧：旋转碟片 -->
      <div class="flex-1 flex items-center justify-center">
        <div class="relative">
          <!-- 碟片外圈 -->
          <div class="w-80 h-80 rounded-full bg-gradient-to-br from-neutral-800 to-neutral-900 p-4 shadow-2xl">
            <!-- 碟片内圈 -->
            <div 
              :class="[
                'w-full h-full rounded-full overflow-hidden',
                'animate-spin-slow',
                !store.isPlaying && 'paused'
              ]"
            >
              <img 
                v-if="store.currentTrack.cover" 
                :src="store.currentTrack.cover" 
                :alt="store.currentTrack.title"
                class="w-full h-full object-cover"
              />
              <div v-else class="w-full h-full bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center text-6xl">
                🎵
              </div>
            </div>
          </div>
          <!-- 中心圆点 -->
          <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-neutral-900 border-4 border-neutral-700"></div>
        </div>
      </div>
      
      <!-- 右侧：歌词 -->
      <div class="flex-1 flex flex-col justify-center pr-20">
        <div class="mb-8">
          <h2 class="text-3xl font-bold text-white mb-2">{{ store.currentTrack.title }}</h2>
          <p class="text-white/60">{{ store.currentTrack.artist }}</p>
        </div>
        
        <div 
          ref="lyricsContainer"
          class="h-96 overflow-y-auto space-y-4 pr-4"
        >
          <p 
            v-if="loadingLyrics"
            class="text-white/40 text-lg"
          >
            加载歌词中...
          </p>
          <p 
            v-else-if="lyrics.length === 0"
            class="text-white/40 text-lg"
          >
            暂无歌词
          </p>
          <p
            v-for="(line, index) in lyrics"
            :key="index"
            :class="[
              'text-lg transition-all duration-300',
              currentLyricIndex === index 
                ? 'text-white text-2xl font-medium' 
                : 'text-white/40'
            ]"
          >
            {{ line.text }}
          </p>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.slide-enter-active,
.slide-leave-active {
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}
.slide-enter-from,
.slide-leave-to {
  opacity: 0;
  transform: translateY(100%);
}
</style>
