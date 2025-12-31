<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { downloadService, type DownloadTask } from '@/services/DownloadService'
import { audioCache } from '@/services/cache/AudioCache'
import type { Track } from '@/types'

const props = defineProps<{
  track: Track
  size?: 'sm' | 'md'
}>()

const isDownloaded = ref(false)
const task = ref<DownloadTask | null>(null)

const buttonSize = computed(() => props.size === 'sm' ? 'w-7 h-7' : 'w-8 h-8')
const iconSize = computed(() => props.size === 'sm' ? 'w-4 h-4' : 'w-5 h-5')

// 检查是否已下载
async function checkDownloaded() {
  isDownloaded.value = await audioCache.has(props.track.id)
  task.value = downloadService.getTask(props.track.id) || null
}

// 监听下载进度
let unsubscribe: (() => void) | null = null

onMounted(() => {
  checkDownloaded()
  unsubscribe = downloadService.addListener((updatedTask) => {
    if (updatedTask.id === props.track.id) {
      task.value = { ...updatedTask }
      if (updatedTask.status === 'completed') {
        isDownloaded.value = true
      }
    }
  })
})

onUnmounted(() => {
  unsubscribe?.()
})

// 开始下载
async function handleDownload() {
  if (isDownloaded.value || task.value?.status === 'downloading') return
  await downloadService.download(props.track)
}

// 状态计算
const isDownloading = computed(() => task.value?.status === 'downloading')
const progress = computed(() => task.value?.progress || 0)
const isFailed = computed(() => task.value?.status === 'failed')
</script>

<template>
  <button
    @click.stop="handleDownload"
    :disabled="isDownloading"
    :class="[
      'rounded-full flex items-center justify-center transition-all relative active:scale-90',
      buttonSize,
      isDownloaded 
        ? 'text-green-400 cursor-default' 
        : isFailed
          ? 'text-red-400 hover:bg-white/10 active:bg-white/20'
          : 'text-white/50 hover:bg-white/10 hover:text-white active:bg-white/20'
    ]"
    :title="isDownloaded ? '已下载' : isFailed ? '下载失败，点击重试' : '下载'"
  >
    <!-- 已下载 -->
    <svg v-if="isDownloaded" :class="iconSize" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
    </svg>
    
    <!-- 下载中 -->
    <template v-else-if="isDownloading">
      <!-- 进度环 -->
      <svg :class="iconSize" viewBox="0 0 24 24" class="transform -rotate-90">
        <circle 
          cx="12" cy="12" r="10" 
          fill="none" 
          stroke="currentColor" 
          stroke-width="2" 
          class="opacity-20"
        />
        <circle 
          cx="12" cy="12" r="10" 
          fill="none" 
          stroke="currentColor" 
          stroke-width="2"
          stroke-linecap="round"
          :stroke-dasharray="62.83"
          :stroke-dashoffset="62.83 * (1 - progress / 100)"
          class="text-purple-400 transition-all duration-300"
        />
      </svg>
      <!-- 进度数字 -->
      <span class="absolute text-[8px] font-bold text-purple-400">{{ progress }}</span>
    </template>
    
    <!-- 下载失败 -->
    <svg v-else-if="isFailed" :class="iconSize" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12" y2="12"/>
      <line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
    
    <!-- 未下载 -->
    <svg v-else :class="iconSize" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4m4-5l5 5 5-5m-5 5V3"/>
    </svg>
  </button>
</template>
