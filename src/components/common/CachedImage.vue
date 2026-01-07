<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { imageCache } from '@/services/ImageCache'

const props = defineProps<{
  src?: string
  alt?: string
  class?: string
}>()

const displaySrc = ref('')
const isLoading = ref(true)
const hasError = ref(false)

async function loadImage() {
  if (!props.src) {
    displaySrc.value = ''
    isLoading.value = false
    return
  }

  isLoading.value = true
  hasError.value = false

  try {
    const cachedUrl = await imageCache.getCachedUrl(props.src)
    displaySrc.value = cachedUrl
  } catch (e) {
    console.error('Image load failed:', e)
    hasError.value = true
    displaySrc.value = props.src // 失败时尝试直接加载原图
  } finally {
    isLoading.value = false
  }
}

watch(() => props.src, loadImage)
onMounted(loadImage)
</script>

<template>
  <div :class="['relative overflow-hidden', props.class]">
    <!-- 图片 -->
    <img
      v-if="displaySrc && !hasError"
      :src="displaySrc"
      :alt="alt"
      class="w-full h-full object-cover transition-opacity duration-300"
      :class="{ 'opacity-0': isLoading, 'opacity-100': !isLoading }"
      @error="hasError = true"
      @load="isLoading = false"
    />
    
    <!-- 加载中占位 -->
    <div 
      v-if="isLoading" 
      class="absolute inset-0 bg-white/5 animate-pulse flex items-center justify-center"
    >
      <div class="w-1/3 h-1/3 rounded-full border-2 border-white/20 border-t-white/60 animate-spin"></div>
    </div>
    
    <!-- 错误/空状态占位 -->
    <div 
      v-if="!src || hasError" 
      class="absolute inset-0 bg-gradient-to-br from-purple-600/30 to-pink-600/30 flex items-center justify-center"
    >
      <span class="text-white/40 text-2xl">🎵</span>
    </div>
  </div>
</template>
