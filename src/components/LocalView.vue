<script setup lang="ts">
import { ref } from 'vue'
import { usePlayerStore } from '@/store/player'
import { scanLocalFiles } from '@/services/source/LocalSource'

const store = usePlayerStore()
const loading = ref(false)
const fileInput = ref<HTMLInputElement>()
const folderInput = ref<HTMLInputElement>()
const recentCount = ref(0)

async function handleFiles(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.files?.length) return

  loading.value = true
  try {
    const tracks = await scanLocalFiles(input.files)
    tracks.forEach(t => store.addTrack(t))
    recentCount.value = tracks.length
  } finally {
    loading.value = false
    input.value = ''
  }
}

function openFilePicker() {
  fileInput.value?.click()
}

function openFolderPicker() {
  folderInput.value?.click()
}
</script>

<template>
  <div class="flex-1 overflow-y-auto p-6">
    <h2 class="text-2xl font-bold text-white mb-6">📁 本地音乐</h2>

    <div class="max-w-lg">
      <!-- 添加方式 -->
      <div class="grid grid-cols-2 gap-4 mb-8">
        <button
          @click="openFilePicker"
          :disabled="loading"
          class="h-32 rounded-xl bg-white/5 border-2 border-dashed border-white/20 hover:border-white/40 hover:bg-white/10 transition-all flex flex-col items-center justify-center gap-2"
        >
          <span class="text-3xl">🎵</span>
          <span class="text-white/70">选择文件</span>
        </button>

        <button
          @click="openFolderPicker"
          :disabled="loading"
          class="h-32 rounded-xl bg-white/5 border-2 border-dashed border-white/20 hover:border-white/40 hover:bg-white/10 transition-all flex flex-col items-center justify-center gap-2"
        >
          <span class="text-3xl">📂</span>
          <span class="text-white/70">选择文件夹</span>
        </button>
      </div>

      <!-- 隐藏的 input -->
      <input
        ref="fileInput"
        type="file"
        accept="audio/*"
        multiple
        class="hidden"
        @change="handleFiles"
      />
      <input
        ref="folderInput"
        type="file"
        accept="audio/*"
        multiple
        webkitdirectory
        class="hidden"
        @change="handleFiles"
      />

      <!-- 加载状态 -->
      <div v-if="loading" class="text-white/60 mb-4">
        正在扫描文件...
      </div>

      <!-- 最近添加 -->
      <div v-if="recentCount > 0" class="text-green-400 mb-4">
        ✓ 已添加 {{ recentCount }} 首歌曲到播放列表
      </div>

      <!-- 支持格式 -->
      <div class="text-white/40 text-sm">
        <p class="mb-2">支持的格式：</p>
        <div class="flex flex-wrap gap-2">
          <span class="px-2 py-1 rounded bg-white/10">.mp3</span>
          <span class="px-2 py-1 rounded bg-white/10">.flac</span>
          <span class="px-2 py-1 rounded bg-white/10">.wav</span>
          <span class="px-2 py-1 rounded bg-white/10">.m4a</span>
          <span class="px-2 py-1 rounded bg-white/10">.ogg</span>
        </div>
      </div>

      <!-- 提示 -->
      <div class="mt-8 p-4 rounded-lg bg-white/5 text-white/50 text-sm">
        <p class="font-medium text-white/70 mb-2">💡 提示</p>
        <ul class="space-y-1">
          <li>• 本地文件会自动读取 ID3 标签信息</li>
          <li>• 支持读取内嵌专辑封面</li>
          <li>• 如果是 Tauri 应用，可以直接扫描系统文件夹</li>
        </ul>
      </div>
    </div>
  </div>
</template>
