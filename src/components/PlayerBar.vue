<script setup lang="ts">

import { usePlayerStore } from '@/store/player'
import { audioPlayer } from '@/services/player/AudioPlayer'

const store = usePlayerStore()

// 播放控制
function handleToggle() {
  audioPlayer.toggle()
  store.togglePlay()
}
</script>

<template>
  <!-- 简洁播放条 - 移动端在底部导航上方 -->
  <div
    v-if="store.currentTrack"
    class="fixed left-0 right-0 z-50 bg-zinc-900/98 backdrop-blur-xl border-t border-white/10 mobile-player-bar md:bottom-0"
  >
    <!-- 进度条（顶部极细线） -->
    <div class="h-0.5 bg-black/5 dark:bg-white/10">
      <div
        class="h-full bg-purple-500 transition-all duration-100"
        :style="{ width: `${store.progress}%` }"
      ></div>
    </div>

    <div class="flex items-center gap-3 px-4 py-2">
      <!-- 封面（圆形） -->
      <div
        @click="store.toggleLyrics()"
        :class="[
          'w-10 h-10 rounded-full overflow-hidden flex-shrink-0 cursor-pointer border-2 border-purple-500/30',
          store.isPlaying ? 'animate-spin-slow' : ''
        ]"
      >
        <img
          v-if="store.currentTrack.cover"
          :src="store.currentTrack.cover"
          :alt="store.currentTrack.title"
          class="w-full h-full object-cover"
        />
        <div v-else class="w-full h-full bg-purple-100 dark:bg-purple-900/50 flex items-center justify-center">
          <span class="text-purple-500 text-sm">🎵</span>
        </div>
      </div>

      <!-- 歌曲信息 -->
      <div class="flex-1 min-w-0" @click="store.toggleLyrics()">
        <p class="text-zinc-800 dark:text-white text-sm font-medium truncate">
          {{ store.currentTrack.title }}
          <span class="text-zinc-400 dark:text-white/40 font-normal"> - {{ store.currentTrack.artist }}</span>
        </p>
      </div>

      <!-- 播放/暂停按钮 -->
      <button
        @click="handleToggle"
        class="w-9 h-9 rounded-full flex items-center justify-center text-zinc-600 dark:text-white/80 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
      >
        <svg v-if="store.isPlaying" class="w-7 h-7" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" stroke-width="1.5"/>
          <path d="M10 8v8M14 8v8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <svg v-else class="w-7 h-7" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="11" fill="none" stroke="currentColor" stroke-width="1.5"/>
          <path d="M10 8l6 4-6 4V8z" fill="currentColor"/>
        </svg>
      </button>

      <!-- 播放列表按钮 -->
      <button
        @click="store.toggleLyrics()"
        class="w-9 h-9 rounded-full flex items-center justify-center text-zinc-400 dark:text-white/50 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 6h16M4 10h16M4 14h16M4 18h16"/>
        </svg>
      </button>
    </div>
  </div>

  <!-- 无歌曲时不显示 -->
</template>

<style scoped>
/* 唱片旋转动画 */
@keyframes spin-slow {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.animate-spin-slow {
  animation: spin-slow 8s linear infinite;
}

/* 移动端播放栏定位 - 在底部导航栏上方 */
.mobile-player-bar {
  bottom: calc(3.5rem + env(safe-area-inset-bottom, 0px));
}

@media (min-width: 768px) {
  .mobile-player-bar {
    bottom: 0;
    padding-bottom: env(safe-area-inset-bottom, 0);
  }
}
</style>
