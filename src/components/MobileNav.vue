<script setup lang="ts">
import { computed } from 'vue'
import { isSelectMode, isModalOpen } from '@/store/ui'
import { useOfflineStore } from '@/store/offline'

defineProps<{
  activeView: string
}>()

const emit = defineEmits<{
  navigate: [id: string]
}>()

const offlineStore = useOfflineStore()

// 根据网络状态动态生成导航项
const navItems = computed(() => [
  { 
    id: 'home', 
    label: '首页',
    path: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' 
  },
  { 
    id: 'aipicker', 
    label: '搜索',
    path: 'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z' 
  },
  { 
    id: 'recommend', 
    label: '推荐',
    path: 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z' 
  },
  { 
    id: 'playlist', 
    label: '播放',
    path: 'M4 6h16M4 10h16M4 14h16M4 18h16' 
  },
  // 有网络显示歌单，无网络显示离线
  offlineStore.isOnline 
    ? { 
        id: 'myplaylist', 
        label: '歌单',
        path: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3' 
      }
    : { 
        id: 'offline', 
        label: '离线',
        path: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4m4-5l5 5 5-5m-5 5V3' 
      },
  { 
    id: 'favorite', 
    label: '喜欢',
    path: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z' 
  },
  { 
    id: 'settings', 
    label: '设置',
    path: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' 
  }
])
</script>

<template>
  <Transition name="mobile-nav">
    <nav v-if="!isSelectMode && !isModalOpen" class="fixed bottom-0 left-0 right-0 z-[60] bg-black/95 backdrop-blur-xl border-t border-white/10 safe-area-pb">
      <div class="flex justify-around items-center h-14">
        <button
          v-for="item in navItems"
          :key="item.id"
          @click="emit('navigate', item.id)"
          :class="[
            'flex flex-col items-center justify-center gap-0.5 px-3 py-1 transition-colors',
            activeView === item.id ? 'text-purple-400' : 'text-white/50'
          ]"
        >
          <svg 
            xmlns="http://www.w3.org/2000/svg" 
            class="w-5 h-5" 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" :d="item.path" />
          </svg>
          <span class="text-[10px]">{{ item.label }}</span>
        </button>
      </div>
    </nav>
  </Transition>
</template>

<style scoped>
.safe-area-pb {
  padding-bottom: env(safe-area-inset-bottom, 0);
}

/* 底部导航隐藏/显示动画 */
.mobile-nav-enter-active,
.mobile-nav-leave-active {
  transition: all 0.3s ease;
}
.mobile-nav-enter-from,
.mobile-nav-leave-to {
  opacity: 0;
  transform: translateY(100%);
}
</style>
