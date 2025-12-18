<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { usePlayerStore } from '@/store/player'
import { formatTime } from '@/utils/formatTime'
import { audioPlayer } from '@/services/player/AudioPlayer'

const store = usePlayerStore()

// 进度条拖拽
const progressBar = ref<HTMLElement>()
const isDraggingProgress = ref(false)
const dragProgress = ref(0)

// 音量控制
const showVolume = ref(false)
const volumeBar = ref<HTMLElement>()
const isDraggingVolume = ref(false)

// 收藏状态
const isFavorite = computed(() => {
  if (!store.currentTrack) return false
  const ids = JSON.parse(localStorage.getItem('favorites') || '[]')
  return ids.includes(store.currentTrack.id)
})

const playModeIcon = computed(() => {
  const icons: Record<string, string> = {
    sequence: '🔁',
    loop: '🔂',
    shuffle: '🔀',
    single: '1️⃣'
  }
  return icons[store.playMode]
})

const playModeText = computed(() => {
  const texts: Record<string, string> = {
    sequence: '顺序播放',
    loop: '列表循环',
    shuffle: '随机播放',
    single: '单曲循环'
  }
  return texts[store.playMode]
})

const volumeIcon = computed(() => {
  if (store.volume === 0) return '🔇'
  if (store.volume < 0.3) return '🔈'
  if (store.volume < 0.7) return '🔉'
  return '🔊'
})

// 显示的进度（拖拽时显示拖拽进度）
const displayProgress = computed(() => 
  isDraggingProgress.value ? dragProgress.value : store.progress
)

const displayTime = computed(() => 
  isDraggingProgress.value 
    ? formatTime((dragProgress.value / 100) * store.duration)
    : formatTime(store.currentTime)
)

// 进度条交互
function startProgressDrag(e: MouseEvent) {
  isDraggingProgress.value = true
  updateProgressFromEvent(e)
  document.addEventListener('mousemove', onProgressDrag)
  document.addEventListener('mouseup', endProgressDrag)
}

function onProgressDrag(e: MouseEvent) {
  if (!isDraggingProgress.value) return
  updateProgressFromEvent(e)
}

function endProgressDrag() {
  if (isDraggingProgress.value) {
    const time = (dragProgress.value / 100) * store.duration
    audioPlayer.seek(time)
    store.setCurrentTime(time)
  }
  isDraggingProgress.value = false
  document.removeEventListener('mousemove', onProgressDrag)
  document.removeEventListener('mouseup', endProgressDrag)
}

function updateProgressFromEvent(e: MouseEvent) {
  if (!progressBar.value) return
  const rect = progressBar.value.getBoundingClientRect()
  const percent = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100))
  dragProgress.value = percent
}

// 音量控制
function startVolumeDrag(e: MouseEvent) {
  isDraggingVolume.value = true
  updateVolumeFromEvent(e)
  document.addEventListener('mousemove', onVolumeDrag)
  document.addEventListener('mouseup', endVolumeDrag)
}

function onVolumeDrag(e: MouseEvent) {
  if (!isDraggingVolume.value) return
  updateVolumeFromEvent(e)
}

function endVolumeDrag() {
  isDraggingVolume.value = false
  document.removeEventListener('mousemove', onVolumeDrag)
  document.removeEventListener('mouseup', endVolumeDrag)
}

function updateVolumeFromEvent(e: MouseEvent) {
  if (!volumeBar.value) return
  const rect = volumeBar.value.getBoundingClientRect()
  // 垂直音量条：从下往上增加，所以是 1 - (点击位置 - 顶部位置) / 高度
  const percent = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height))
  store.setVolume(percent)
  audioPlayer.setVolume(percent)
}

function toggleMute() {
  if (store.volume > 0) {
    localStorage.setItem('lastVolume', String(store.volume))
    store.setVolume(0)
    audioPlayer.setVolume(0)
  } else {
    const last = parseFloat(localStorage.getItem('lastVolume') || '0.8')
    store.setVolume(last)
    audioPlayer.setVolume(last)
  }
}

// 播放控制
function handleToggle() {
  audioPlayer.toggle()
  store.togglePlay()
}

// 收藏
function toggleFavorite() {
  if (!store.currentTrack) return
  const ids = JSON.parse(localStorage.getItem('favorites') || '[]')
  const idx = ids.indexOf(store.currentTrack.id)
  if (idx >= 0) {
    ids.splice(idx, 1)
  } else {
    ids.push(store.currentTrack.id)
  }
  localStorage.setItem('favorites', JSON.stringify(ids))
}

// 点击进度条
function handleProgressClick(e: MouseEvent) {
  updateProgressFromEvent(e)
  const time = (dragProgress.value / 100) * store.duration
  audioPlayer.seek(time)
  store.setCurrentTime(time)
}
</script>

<template>
  <!-- 悬浮胶囊播放栏 -->
  <div
    v-if="store.currentTrack"
    class="fixed bottom-6 left-1/2 -translate-x-1/2 w-[92%] max-w-3xl z-40"
  >
    <div class="bg-black/80 backdrop-blur-2xl rounded-2xl shadow-2xl border border-white/10 overflow-hidden ring-1 ring-white/5">
      <!-- 进度条（顶部细条） -->
      <div
        ref="progressBar"
        class="h-1 bg-white/5 cursor-pointer group relative"
        @click="handleProgressClick"
        @mousedown="startProgressDrag"
      >
        <div
          class="h-full bg-gradient-to-r from-purple-500 to-pink-500 relative transition-all duration-100 ease-linear"
          :style="{ width: `${displayProgress}%` }"
        >
          <!-- 拖拽手柄 -->
          <div
            class="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
            :class="{ 'opacity-100 scale-125': isDraggingProgress }"
          ></div>
        </div>
      </div>

      <div class="p-3 flex items-center gap-4">
        <!-- 封面 -->
        <div
          @click="store.toggleLyrics()"
          class="relative w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 cursor-pointer group shadow-lg"
        >
          <img
            v-if="store.currentTrack.cover"
            :src="store.currentTrack.cover"
            :alt="store.currentTrack.title"
            class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
          />
          <div v-else class="w-full h-full bg-white/10 flex items-center justify-center text-2xl">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
          </div>
          <!-- 展开歌词提示 -->
          <div class="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-[2px]">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 15l7-7 7 7" />
            </svg>
          </div>
        </div>

        <!-- 信息 -->
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <p class="text-white font-medium truncate text-base">{{ store.currentTrack.title }}</p>
            <!-- 收藏按钮 -->
            <button
              @click="toggleFavorite"
              class="flex-shrink-0 hover:scale-110 transition-transform active:scale-95"
              :title="isFavorite ? '取消收藏' : '收藏'"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" :class="isFavorite ? 'text-red-500 fill-current' : 'text-white/30 hover:text-white'" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" fill="none">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
            </button>
          </div>
          <p class="text-white/40 text-sm truncate font-light">{{ store.currentTrack.artist }}</p>
        </div>

        <!-- 时间显示 -->
        <div class="text-white/30 text-xs tabular-nums hidden sm:block font-mono tracking-wider">
          {{ displayTime }} / {{ formatTime(store.duration) }}
        </div>

        <!-- 控制按钮 -->
        <div class="flex items-center gap-2">
          <!-- 播放模式 -->
          <button
            @click="store.togglePlayMode()"
            class="w-8 h-8 rounded-full flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors"
            :title="playModeText"
          >
            <svg v-if="store.playMode === 'sequence'" xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            <svg v-else-if="store.playMode === 'loop'" xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <svg v-else-if="store.playMode === 'single'" xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              <text x="10" y="14" font-size="8" fill="currentColor" font-weight="bold">1</text>
            </svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l-3.5-3.5M16 17l5 3" /> <!-- Simplified shuffle icon -->
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 4l5 5" />
            </svg>
          </button>

          <!-- 上一首 -->
          <button
            @click="store.prevTrack()"
            class="w-9 h-9 rounded-full flex items-center justify-center text-white hover:bg-white/10 transition-colors"
            title="上一首"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <!-- 播放/暂停 -->
          <button
            @click="handleToggle"
            class="w-12 h-12 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-transform shadow-lg shadow-white/20"
            :title="store.isPlaying ? '暂停' : '播放'"
          >
            <svg v-if="store.isPlaying" xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 fill-current" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6" />
            </svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 fill-current ml-1" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            </svg>
          </button>

          <!-- 下一首 -->
          <button
            @click="store.nextTrack()"
            class="w-9 h-9 rounded-full flex items-center justify-center text-white hover:bg-white/10 transition-colors"
            title="下一首"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5l7 7-7 7" />
            </svg>
          </button>

          <!-- 音量控制 -->
          <div class="relative group/volume">
            <button
              @click="showVolume = !showVolume"
              @dblclick="toggleMute"
              class="w-8 h-8 rounded-full flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors"
              title="音量 (双击静音)"
            >
              <svg v-if="store.volume === 0" xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
              </svg>
              <svg v-else-if="store.volume < 0.5" xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15.536 8.464a5 5 0 010 7.072" />
              </svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              </svg>
            </button>

            <!-- 音量滑块弹出 -->
            <Transition name="fade">
              <div
                v-if="showVolume"
                class="absolute bottom-full left-1/2 -translate-x-1/2 mb-4 p-3 bg-black/80 backdrop-blur-xl rounded-xl border border-white/10 shadow-xl"
                @mouseleave="showVolume = false"
              >
                <div class="flex flex-col items-center gap-2 h-32">
                  <div
                    ref="volumeBar"
                    class="w-1.5 flex-1 bg-white/20 rounded-full cursor-pointer relative group/bar"
                    @click="updateVolumeFromEvent"
                    @mousedown="startVolumeDrag"
                  >
                    <div
                      class="absolute bottom-0 left-0 w-full bg-white rounded-full transition-all duration-75"
                      :style="{ height: `${store.volume * 100}%` }"
                    >
                      <div class="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow opacity-0 group-hover/bar:opacity-100 transition-opacity"></div>
                    </div>
                  </div>
                  <span class="text-white/60 text-xs font-mono">{{ Math.round(store.volume * 100) }}%</span>
                </div>
              </div>
            </Transition>
          </div>

          <!-- 播放列表 -->
          <button
            @click="store.toggleLyrics()"
            class="w-8 h-8 rounded-full flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors"
            title="歌词"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- 无歌曲时的占位提示 -->
  <div
    v-else
    class="fixed bottom-6 left-1/2 -translate-x-1/2 px-6 py-3 bg-black/40 backdrop-blur-xl rounded-full text-white/50 text-sm border border-white/5 flex items-center gap-2 shadow-lg"
  >
    <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
    </svg>
    搜索或添加歌曲开始播放
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(4px) translateX(-50%);
}
</style>
