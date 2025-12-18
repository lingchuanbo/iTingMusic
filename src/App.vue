<script setup lang="ts">
import { ref, computed, watch } from 'vue'
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

const store = usePlayerStore()
const activeView = ref('home')

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

// 监听歌曲切换
watch(() => store.currentTrack, (track) => {
  if (track) {
    audioPlayer.play(track.url)
  }
})

// 监听音量变化
watch(() => store.volume, (v) => {
  audioPlayer.setVolume(v)
})

function handleNavigate(id: string) {
  activeView.value = id
}
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
    <div class="relative z-10 h-full flex">
      <!-- 侧边栏 -->
      <Sidebar :active-view="activeView" @navigate="handleNavigate" />

      <!-- 主内容区 -->
      <main class="flex-1 flex flex-col overflow-hidden">
        <!-- 首页：搜索 + 播放列表 -->
        <template v-if="activeView === 'home'">
          <SearchBar />
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

    <!-- 悬浮播放栏 -->
    <PlayerBar />

    <!-- 歌词面板 -->
    <LyricsPanel />
  </div>
</template>
