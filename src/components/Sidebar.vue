<script setup lang="ts">
defineProps<{
  activeView: string
}>()

const emit = defineEmits<{
  navigate: [id: string]
}>()

const navItems = [
  { 
    id: 'home', 
    label: '首页',
    path: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' 
  },
  { 
    id: 'playlist', 
    label: '播放列表',
    path: 'M4 6h16M4 10h16M4 14h16M4 18h16' 
  },
  { 
    id: 'aipicker', 
    label: 'AI 选歌',
    path: 'M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z' 
  },
  { 
    id: 'toplist', 
    label: '排行榜',
    path: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' 
  },
  { 
    id: 'myplaylist', 
    label: '我的歌单',
    path: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3' 
  },
  { 
    id: 'favorite', 
    label: '我的喜爱',
    path: 'M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z' 
  },
  { 
    id: 'webdav', 
    label: '云盘',
    path: 'M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z' 
  },
  { 
    id: 'local', 
    label: '本地',
    path: 'M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z' 
  }
]

function handleNav(id: string) {
  emit('navigate', id)
}
</script>

<template>
  <aside class="w-20 h-full flex flex-col items-center py-6 gap-4 bg-black/20 backdrop-blur-xl border-r border-white/5">
    <!-- Logo -->
    <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-purple-500/20 mb-4">
      Z
    </div>

    <nav class="flex flex-col gap-2 w-full px-3">
      <button
        v-for="item in navItems"
        :key="item.id"
        @click="handleNav(item.id)"
        :class="[
          'w-full aspect-square rounded-xl flex flex-col items-center justify-center gap-1 transition-all duration-300 group relative',
          activeView === item.id
            ? 'bg-white/10 text-white shadow-inner'
            : 'text-white/40 hover:text-white hover:bg-white/5'
        ]"
        :title="item.label"
      >
        <svg 
          xmlns="http://www.w3.org/2000/svg" 
          class="w-6 h-6 transition-transform duration-300 group-hover:scale-110" 
          :class="{ 'scale-110': activeView === item.id }"
          fill="none" 
          viewBox="0 0 24 24" 
          stroke="currentColor"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" :d="item.path" />
        </svg>
        
        <!-- 激活指示器 -->
        <div 
          v-if="activeView === item.id"
          class="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-purple-500 rounded-r-full"
        ></div>
      </button>
    </nav>

    <div class="mt-auto px-3 w-full">
      <button
        @click="handleNav('settings')"
        :class="[
          'w-full aspect-square rounded-xl flex items-center justify-center transition-all duration-300 group',
          activeView === 'settings' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white hover:bg-white/5'
        ]"
        title="设置"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 group-hover:rotate-90 transition-transform duration-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>
    </div>
  </aside>
</template>
