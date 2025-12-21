<script setup lang="ts">
import { ref, computed, watch, provide } from 'vue'
import { usePlayerStore } from '@/store/player'
import { audioPlayer } from '@/services/player/AudioPlayer'
import Sidebar from '@/components/Sidebar.vue'
import SearchBar from '@/components/SearchBar.vue'
import SongList from '@/components/SongList.vue'
import PlayerBar from '@/components/PlayerBar.vue'
import LyricsPanel from '@/components/LyricsPanel.vue'
import ToplistView from '@/components/ToplistView.vue'
import AIPickerView from '@/components/AIPickerView.vue'
import PlaylistView from '@/components/PlaylistView.vue'
import FavoriteView from '@/components/FavoriteView.vue'
import WebDAVView from '@/components/WebDAVView.vue'
import LocalView from '@/components/LocalView.vue'
import SettingsView from '@/components/SettingsView.vue'
import MobileNav from '@/components/MobileNav.vue'
import HomeView from '@/components/HomeView.vue'

const store = usePlayerStore()
const activeView = ref('home')
const searchBarRef = ref<InstanceType<typeof SearchBar> | null>(null)

// 是否显示全局搜索按钮（除设置页面外都显示）
const showGlobalSearch = computed(() => activeView.value !== 'settings')

// 动态背景
const bgStyle = computed(() => {
  const cover = store.currentTrack?.cover
  if (!cover) return {}
  return {
    backgroundImage: `url(${cover})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center'
  }
})

// 监听歌曲切换 - 使用 playVersion 确保每次点击都触发播放
watch(() => store.playVersion, () => {
  const track = store.currentTrack
  if (track) {
    audioPlayer.play(track.url, track)
  }
})

// 监听音量变化
watch(() => store.volume, (v) => {
  audioPlayer.setVolume(v)
})

function handleNavigate(id: string) {
  activeView.value = id
}

// 打开全局搜索
function openGlobalSearch() {
  searchBarRef.value?.openMobileSearch()
}

// 提供给子组件使用
provide('openGlobalSearch', openGlobalSearch)
</script>

<template>
  <div class="h-screen w-screen overflow-hidden relative">
    <!-- 动态模糊背景 -->
    <div
      class="absolute inset-0 transition-all duration-1000"
      :style="bgStyle"
    >
      <div class="absolute inset-0 bg-black/70 backdrop-blur-3xl"></div>
    </div>

    <!-- 主布局 -->
    <div class="relative z-10 h-full flex flex-col md:flex-row">
      <!-- 侧边栏 - 桌面端显示在左侧 -->
      <Sidebar :active-view="activeView" @navigate="handleNavigate" class="hidden md:flex" />

      <!-- 主内容区 - 移动端需要为底部导航+播放栏留出空间，顶部需要安全区域间距 -->
      <main class="flex-1 flex flex-col overflow-hidden mobile-main-content md:pb-14 pt-safe-top md:pt-0">
        <!-- 首页：推荐内容 -->
        <template v-if="activeView === 'home'">
          <HomeView @navigate="handleNavigate" />
        </template>

        <!-- 播放列表 -->
        <template v-else-if="activeView === 'playlist'">
          <SongList />
        </template>

        <!-- AI 选歌 -->
        <AIPickerView v-else-if="activeView === 'aipicker'" />

        <!-- 排行榜 -->
        <ToplistView v-else-if="activeView === 'toplist'" />

        <!-- 我的歌单 -->
        <PlaylistView v-else-if="activeView === 'myplaylist'" />

        <!-- 我的喜爱 -->
        <FavoriteView v-else-if="activeView === 'favorite'" />

        <!-- WebDAV -->
        <WebDAVView v-else-if="activeView === 'webdav'" />

        <!-- 本地音乐 -->
        <LocalView v-else-if="activeView === 'local'" />

        <!-- 设置 -->
        <SettingsView v-else-if="activeView === 'settings'" />
      </main>
    </div>

    <!-- 移动端底部导航 -->
    <MobileNav :active-view="activeView" @navigate="handleNavigate" class="md:hidden" />

    <!-- 全局搜索浮动按钮（除设置页面外显示） -->
    <Transition name="fab">
      <button
        v-if="showGlobalSearch"
        @click="openGlobalSearch"
        class="fixed right-4 z-40 w-12 h-12 md:w-14 md:h-14 rounded-full bg-gradient-to-br from-purple-600 to-pink-600 text-white shadow-lg shadow-purple-600/40 flex items-center justify-center active:scale-95 hover:shadow-xl hover:shadow-purple-600/50 transition-all group"
        style="bottom: calc(3.5rem + 4rem + env(safe-area-inset-bottom, 0px) + 1rem)"
      >
        <svg class="w-5 h-5 md:w-6 md:h-6 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </button>
    </Transition>

    <!-- 全局 SearchBar（弹窗模式） -->
    <SearchBar ref="searchBarRef" :popup-only="true" />

    <!-- 悬浮播放栏 -->
    <PlayerBar />

    <!-- 歌词面板 -->
    <LyricsPanel />
  </div>
</template>

<style>
/* 安全区域顶部间距 - 移动端适配刘海屏/状态栏 */
.pt-safe-top {
  padding-top: env(safe-area-inset-top, 0px);
}

/* 移动端主内容区底部间距 */
.mobile-main-content {
  padding-bottom: calc(3.5rem + 4rem + env(safe-area-inset-bottom, 0px)); /* 导航栏 + 播放栏 + 安全区域 */
}

@media (min-width: 768px) {
  .mobile-main-content {
    padding-bottom: 3.5rem; /* 桌面端只需要播放栏高度 */
  }
}

/* 悬浮按钮动画 */
.fab-enter-active,
.fab-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}
.fab-enter-from,
.fab-leave-to {
  opacity: 0;
  transform: scale(0.8);
}
</style>
