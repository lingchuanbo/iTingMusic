<script setup lang="ts">
import { computed } from 'vue'
import { usePlaylistStore } from '@/store/playlist'

defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'select', playlistId: string): void
  (e: 'create'): void
}>()

const playlistStore = usePlaylistStore()

const playlists = computed(() => playlistStore.playlists)

function handleSelect(playlistId: string) {
  emit('select', playlistId)
}

function handleCreate() {
  emit('create')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog-fade">
      <div 
        v-if="visible"
        class="fixed inset-0 z-[100] flex items-center justify-center p-4"
        @click.self="emit('close')"
      >
        <!-- 遮罩层 -->
        <div class="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>
        
        <!-- 弹窗内容 -->
        <div class="relative w-full max-w-sm bg-neutral-900 rounded-3xl overflow-hidden shadow-2xl border border-white/10 animate-dialog-scale">
          <!-- 标题栏 -->
          <div class="flex items-center justify-between px-5 py-4 border-b border-white/10">
            <h3 class="text-white font-bold text-lg">添加到歌单</h3>
            <button 
              @click="emit('close')"
              class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/60 hover:bg-white/20 hover:text-white transition-colors"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>
          
          <!-- 歌单列表 -->
          <div class="max-h-[50vh] overflow-y-auto p-3">
            <!-- 新建歌单按钮 -->
            <button 
              @click="handleCreate"
              class="w-full flex items-center gap-4 p-4 rounded-2xl bg-white/5 hover:bg-white/10 transition-all text-left group mb-2"
            >
              <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center shadow-lg shadow-purple-600/20 group-hover:scale-105 transition-transform">
                <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
                </svg>
              </div>
              <div>
                <p class="text-white font-medium">新建歌单</p>
                <p class="text-white/40 text-xs mt-0.5">创建一个全新的播放列表</p>
              </div>
            </button>
            
            <!-- 空状态 -->
            <div v-if="playlists.length === 0" class="py-10 text-center">
              <div class="w-14 h-14 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg class="w-7 h-7 text-white/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                </svg>
              </div>
              <p class="text-white/40 text-sm">暂无歌单</p>
            </div>
            
            <!-- 歌单列表 -->
            <div v-else class="space-y-1">
              <button
                v-for="pl in playlists"
                :key="pl.id"
                @click="handleSelect(pl.id)"
                class="w-full flex items-center gap-4 p-3 rounded-2xl hover:bg-white/5 transition-all text-left group"
              >
                <div class="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center group-hover:bg-white/10 transition-colors">
                  <svg class="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                  </svg>
                </div>
                <div class="flex-1 min-w-0">
                  <p class="text-white font-medium truncate">{{ pl.name }}</p>
                  <p class="text-white/40 text-xs mt-0.5">{{ pl.trackIds.length }} 首歌曲</p>
                </div>
                <svg class="w-5 h-5 text-white/10 group-hover:text-white/30 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 弹窗淡入动画 */
.dialog-fade-enter-active,
.dialog-fade-leave-active {
  transition: opacity 0.25s ease;
}
.dialog-fade-enter-from,
.dialog-fade-leave-to {
  opacity: 0;
}

/* 弹窗缩放动画 */
@keyframes dialog-scale {
  0% {
    opacity: 0;
    transform: scale(0.9);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}
.animate-dialog-scale {
  animation: dialog-scale 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.dialog-fade-leave-active .animate-dialog-scale {
  animation: dialog-scale 0.2s ease reverse;
}
</style>
