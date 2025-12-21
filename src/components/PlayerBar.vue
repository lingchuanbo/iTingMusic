<script setup lang="ts">
import { ref } from 'vue'
import { usePlayerStore } from '@/store/player'
import { audioPlayer } from '@/services/player/AudioPlayer'
import { formatTime } from '@/utils/formatTime'

const store = usePlayerStore()
const showPlaylist = ref(false)

// 播放控制
function handleToggle() {
  // 如果有当前歌曲但没有在播放（比如刚打开应用），需要重新加载播放
  if (store.currentTrack && !store.isPlaying) {
    // 尝试 toggle，如果 audio 不存在会触发重新播放
    const toggled = audioPlayer.toggle()
    if (!toggled) {
      // audio 不存在，重新播放当前歌曲
      store.playTrack(store.currentIndex)
      return
    }
  } else {
    audioPlayer.toggle()
  }
  store.togglePlay()
}

// 切换播放列表浮窗
function togglePlaylist() {
  showPlaylist.value = !showPlaylist.value
}

// 播放指定歌曲
function playSong(index: number) {
  store.playTrack(index)
}

// 从列表移除
function removeTrack(index: number) {
  store.playlist.splice(index, 1)
  if (store.currentIndex === index) {
    store.currentIndex = -1
  } else if (store.currentIndex > index) {
    store.currentIndex--
  }
}

// 清空播放列表
function clearPlaylist() {
  store.playlist.splice(0, store.playlist.length)
  store.currentIndex = -1
  showPlaylist.value = false
}
</script>

<template>
  <!-- 简洁播放条 - 移动端在底部导航上方 -->
  <div
    v-if="store.currentTrack"
    class="fixed left-0 right-0 z-50 bg-zinc-900/98 backdrop-blur-xl border-t border-white/10 mobile-player-bar md:bottom-0"
  >
    <!-- 进度条（顶部极细线） -->
    <div class="h-0.5 bg-black/5 dark:bg-white/10 relative">
      <!-- 缓冲进度（深灰色） -->
      <div
        class="absolute h-full bg-zinc-600 transition-all duration-300"
        :style="{ width: `${store.buffered}%` }"
      ></div>
      <!-- 播放进度（紫色） -->
      <div
        class="absolute h-full bg-purple-500 transition-all duration-100"
        :style="{ width: `${store.progress}%` }"
      ></div>
      <!-- 缓存完成指示（绿色小点） -->
      <div
        v-if="store.isCached"
        class="absolute right-1 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-green-500"
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
        <p class="text-white text-sm font-medium truncate">
          {{ store.currentTrack.title }}
        </p>
        <p class="text-white/60 text-xs truncate">{{ store.currentTrack.artist }}</p>
      </div>

      <!-- 播放/暂停按钮 -->
      <button
        @click="handleToggle"
        class="w-10 h-10 rounded-full flex items-center justify-center bg-purple-600 text-white shadow-lg shadow-purple-600/30 hover:bg-purple-500 active:scale-95 transition-all"
      >
        <svg v-if="store.isPlaying" class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
        </svg>
        <svg v-else class="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M8 5v14l11-7z"/>
        </svg>
      </button>

      <!-- 播放列表按钮 -->
      <button
        @click="togglePlaylist"
        :class="[
          'w-9 h-9 rounded-full flex items-center justify-center transition-all',
          showPlaylist ? 'bg-purple-600 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'
        ]"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16"/>
        </svg>
      </button>
    </div>

    <!-- 播放列表浮窗 -->
    <Transition name="playlist-popup">
      <div 
        v-if="showPlaylist"
        class="absolute bottom-full left-0 right-0 mb-0 max-h-[60vh] bg-neutral-900 border-t border-white/10 rounded-t-2xl overflow-hidden shadow-2xl"
      >
        <!-- 标题栏 -->
        <div class="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div class="flex items-center gap-2">
            <h3 class="text-white font-medium">播放列表</h3>
            <span class="text-white/40 text-sm">({{ store.playlist.length }}首)</span>
          </div>
          <div class="flex items-center gap-2">
            <button 
              @click="clearPlaylist"
              class="px-3 py-1 rounded-lg text-white/50 text-sm hover:bg-white/10 hover:text-white/80 transition-colors"
            >
              清空
            </button>
            <button 
              @click="showPlaylist = false"
              class="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-white/60 hover:bg-white/20 transition-colors"
            >
              ✕
            </button>
          </div>
        </div>
        
        <!-- 歌曲列表 -->
        <div class="overflow-y-auto max-h-[calc(60vh-52px)]">
          <div v-if="store.playlist.length === 0" class="py-12 text-center text-white/40">
            <p class="text-3xl mb-2">🎵</p>
            <p>播放列表为空</p>
          </div>
          <div 
            v-for="(track, index) in store.playlist"
            :key="track.id"
            :class="[
              'flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors group',
              store.currentIndex === index ? 'bg-purple-600/20' : 'hover:bg-white/5'
            ]"
            @click="playSong(index)"
          >
            <!-- 序号/播放指示 -->
            <div class="w-6 text-center flex-shrink-0">
              <span v-if="store.currentIndex === index && store.isPlaying" class="text-purple-400">
                <svg class="w-4 h-4 animate-pulse" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
                </svg>
              </span>
              <span v-else :class="store.currentIndex === index ? 'text-purple-400' : 'text-white/30'">
                {{ index + 1 }}
              </span>
            </div>
            
            <!-- 歌曲信息 -->
            <div class="flex-1 min-w-0">
              <p :class="['text-sm truncate', store.currentIndex === index ? 'text-purple-400' : 'text-white']">
                {{ track.title }}
              </p>
              <p class="text-white/50 text-xs truncate">{{ track.artist }}</p>
            </div>
            
            <!-- 时长 -->
            <span class="text-white/30 text-xs">{{ track.duration ? formatTime(track.duration) : '--:--' }}</span>
            
            <!-- 删除按钮 -->
            <button
              @click.stop="removeTrack(index)"
              class="w-7 h-7 rounded-full flex items-center justify-center text-white/30 opacity-0 group-hover:opacity-100 hover:bg-white/10 hover:text-red-400 transition-all"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>

  <!-- 点击外部关闭播放列表 -->
  <div 
    v-if="showPlaylist"
    class="fixed inset-0 z-40"
    @click="showPlaylist = false"
  ></div>

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

/* 播放列表浮窗动画 */
.playlist-popup-enter-active {
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.playlist-popup-leave-active {
  transition: all 0.2s ease-in;
}
.playlist-popup-enter-from,
.playlist-popup-leave-to {
  opacity: 0;
  transform: translateY(20px);
}
</style>
