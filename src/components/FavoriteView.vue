<script setup lang="ts">
import { computed } from 'vue'
import { usePlayerStore } from '@/store/player'
import { formatTime } from '@/utils/formatTime'

const store = usePlayerStore()

// 从 localStorage 读取收藏
const favorites = computed(() => {
  const ids = JSON.parse(localStorage.getItem('favorites') || '[]')
  return store.playlist.filter(t => ids.includes(t.id))
})

function isFavorite(id: string) {
  const ids = JSON.parse(localStorage.getItem('favorites') || '[]')
  return ids.includes(id)
}

function toggleFavorite(id: string) {
  const ids = JSON.parse(localStorage.getItem('favorites') || '[]')
  const idx = ids.indexOf(id)
  if (idx >= 0) {
    ids.splice(idx, 1)
  } else {
    ids.push(id)
  }
  localStorage.setItem('favorites', JSON.stringify(ids))
}

function playSong(track: typeof store.playlist[0]) {
  const idx = store.playlist.findIndex(t => t.id === track.id)
  if (idx >= 0) store.playTrack(idx)
}
</script>

<template>
  <div class="flex-1 overflow-y-auto p-6">
    <h2 class="text-2xl font-bold text-white mb-6">❤️ 我的喜爱</h2>

    <div v-if="favorites.length === 0" class="text-center py-20">
      <p class="text-4xl mb-4">💔</p>
      <p class="text-white/50">还没有收藏的歌曲</p>
      <p class="text-white/30 text-sm mt-2">在播放列表中点击 ❤️ 收藏歌曲</p>
    </div>

    <div v-else class="space-y-2">
      <div
        v-for="track in favorites"
        :key="track.id"
        class="flex items-center gap-4 p-3 rounded-xl hover:bg-white/10 group cursor-pointer"
        @click="playSong(track)"
      >
        <!-- 封面 -->
        <div class="w-12 h-12 rounded-lg overflow-hidden bg-white/10 flex-shrink-0">
          <img
            v-if="track.cover"
            :src="track.cover"
            :alt="track.title"
            class="w-full h-full object-cover"
          />
          <div v-else class="w-full h-full flex items-center justify-center text-2xl">🎵</div>
        </div>

        <!-- 信息 -->
        <div class="flex-1 min-w-0">
          <p class="text-white font-medium truncate">{{ track.title }}</p>
          <p class="text-white/50 text-sm truncate">{{ track.artist }}</p>
        </div>

        <!-- 取消收藏 -->
        <button
          @click.stop="toggleFavorite(track.id)"
          class="text-red-400 hover:scale-110 transition-transform"
        >
          ❤️
        </button>

        <!-- 时长 -->
        <span class="text-white/40 text-sm">
          {{ track.duration ? formatTime(track.duration) : '--:--' }}
        </span>
      </div>
    </div>
  </div>
</template>
