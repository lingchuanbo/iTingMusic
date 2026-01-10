<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import { logger, type LogEntry } from '@/services/LoggerService'

const emit = defineEmits<{
  close: []
}>()

const logs = ref<LogEntry[]>([])
const logContainer = ref<HTMLElement | null>(null)
const copyStatus = ref<'idle' | 'success' | 'error'>('idle')

function refresh() {
  logs.value = logger.getLogs()
  nextTick(() => {
    if (logContainer.value) {
      logContainer.value.scrollTop = logContainer.value.scrollHeight
    }
  })
}

async function copyLogs() {
  try {
    const text = logger.export()
    if (!text) {
      copyStatus.value = 'error'
      return
    }
    await navigator.clipboard.writeText(text)
    copyStatus.value = 'success'
    setTimeout(() => copyStatus.value = 'idle', 2000)
  } catch (e) {
    copyStatus.value = 'error'
    setTimeout(() => copyStatus.value = 'idle', 2000)
  }
}

function clearLogs() {
  if (confirm('确定清空所有日志？')) {
    logger.clear()
    refresh()
  }
}

const typeColor = (type: string) => {
  switch (type) {
    case 'ERROR': return 'text-red-400'
    case 'WARN': return 'text-yellow-400'
    default: return 'text-green-400'
  }
}

onMounted(refresh)
</script>

<template>
  <div class="h-full flex flex-col bg-gradient-to-b from-gray-900 to-black text-white">
    <!-- 顶部栏 -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-white/10">
      <button 
        @click="emit('close')"
        class="p-2 -ml-2 rounded-full hover:bg-white/10 transition-colors"
      >
        <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m15 18-6-6 6-6"/>
        </svg>
      </button>
      <h1 class="text-lg font-semibold">运行日志</h1>
      <div class="flex items-center gap-2">
        <button 
          @click="refresh"
          class="p-2 rounded-full hover:bg-white/10 transition-colors"
          title="刷新"
        >
          <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
            <path d="M21 3v5h-5"/>
          </svg>
        </button>
        <button 
          @click="copyLogs"
          class="p-2 rounded-full hover:bg-white/10 transition-colors"
          :class="copyStatus === 'success' ? 'text-green-400' : copyStatus === 'error' ? 'text-red-400' : ''"
          title="复制全部"
        >
          <svg v-if="copyStatus === 'success'" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <svg v-else class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        </button>
        <button 
          @click="clearLogs"
          class="p-2 rounded-full hover:bg-white/10 transition-colors text-red-400"
          title="清空"
        >
          <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- 日志状态 -->
    <div class="px-4 py-2 flex items-center justify-between text-sm border-b border-white/5">
      <span class="text-white/50">共 {{ logs.length }} 条日志</span>
      <span 
        class="px-2 py-0.5 rounded text-xs"
        :class="logger.enabled ? 'bg-green-500/20 text-green-400' : 'bg-white/10 text-white/40'"
      >
        {{ logger.enabled ? '记录中' : '已关闭' }}
      </span>
    </div>

    <!-- 日志列表 -->
    <div 
      ref="logContainer"
      class="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-1"
    >
      <template v-if="logs.length > 0">
        <div 
          v-for="(log, index) in logs" 
          :key="index"
          class="flex gap-2 py-1 border-b border-white/5"
        >
          <span class="text-white/40 flex-shrink-0">{{ log.time }}</span>
          <span 
            class="flex-shrink-0 w-12 text-center"
            :class="typeColor(log.type)"
          >
            [{{ log.type }}]
          </span>
          <span class="text-white/80 break-all">{{ log.message }}</span>
        </div>
      </template>
      <div v-else class="h-full flex items-center justify-center text-white/30">
        <div class="text-center">
          <svg class="w-12 h-12 mx-auto mb-2 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
          <p>暂无日志</p>
          <p class="text-xs mt-1">请先开启日志记录</p>
        </div>
      </div>
    </div>
  </div>
</template>
