<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { Capacitor } from '@capacitor/core'
import { usePlayerStore } from '@/store/player'
import { useOfflineStore } from '@/store/offline'
import { audioCache, type CacheMeta } from '@/services/cache/AudioCache'
import { trackStorage } from '@/services/TrackStorage'
import { downloadService } from '@/services/DownloadService'
import type { Track } from '@/types'

const playerStore = usePlayerStore()
const offlineStore = useOfflineStore()

const loading = ref(true)
const cachedTracks = ref<(CacheMeta & { track?: Track })[]>([])
const exportingId = ref<string | null>(null)

// 原生缓存统计（仅 Android）
const nativeCacheSize = ref(0)
const nativeCacheCount = ref(0)

// 移动端操作菜单
const showActionMenu = ref(false)
const actionMenuItem = ref<(CacheMeta & { track?: Track }) | null>(null)

function openActionMenu(item: CacheMeta & { track?: Track }) {
  actionMenuItem.value = item
  showActionMenu.value = true
}

function closeActionMenu() {
  showActionMenu.value = false
  actionMenuItem.value = null
}

// 格式化文件大小
function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

// 总缓存大小：Android 使用原生统计，Web 使用 IndexedDB 统计
const totalSize = computed(() => {
  if (Capacitor.isNativePlatform()) {
    return nativeCacheSize.value
  }
  return cachedTracks.value.reduce((sum, t) => sum + t.size, 0)
})

// 缓存歌曲数量：Android 使用原生统计
const cacheCount = computed(() => {
  if (Capacitor.isNativePlatform()) {
    return nativeCacheCount.value
  }
  return cachedTracks.value.length
})

// 加载缓存列表
async function loadCachedTracks() {
  loading.value = true
  try {
    if (Capacitor.isNativePlatform()) {
      // Android: 获取原生缓存统计和歌曲列表
      const { nativeAudioPlayer } = await import('@/services/player/NativeAudioPlayer')
      const stats = await nativeAudioPlayer.getCacheStats()
      nativeCacheSize.value = stats.sizeBytes
      nativeCacheCount.value = stats.count
      
      // 获取缓存的歌曲 URL 列表
      const cachedKeys = await nativeAudioPlayer.getCachedSongs()
      
      // 调试日志
      console.log('[OfflineView] 原生缓存统计:', { size: stats.sizeBytes, count: stats.count })
      console.log('[OfflineView] 缓存 URL 列表:', cachedKeys)
      
      // 从 trackStorage 中匹配歌曲信息
      const allTracks = trackStorage.getAllTracks()
      console.log('[OfflineView] TrackStorage 歌曲数量:', allTracks.length)
      console.log('[OfflineView] 前5首歌曲信息:', allTracks.slice(0, 5).map((t: any) => ({
        id: t.id,
        _songId: t._songId,
        _platform: t._platform,
        title: t.title,
        url: t.url?.substring(0, 80)
      })))
      
      // 从缓存 URL 中提取所有的 id 参数，建立快速查找表
      const cachedIdSet = new Set<string>()
      const cachedUrlSet = new Set<string>()
      
      cachedKeys.forEach((key: string) => {
        cachedUrlSet.add(key)
        // 使用正则提取 URL 中的 id 参数
        const idMatch = key.match(/[?&]id=([^&]+)/)
        if (idMatch) {
          cachedIdSet.add(idMatch[1])
        }
      })
      
      console.log('[OfflineView] 缓存中提取的 songId 集合:', Array.from(cachedIdSet))
      
      cachedTracks.value = allTracks
        .filter((track: any) => {
          const songId = track._songId
          const trackId = track.id
          
          // 匹配策略 1: 使用 _songId 匹配
          if (songId && cachedIdSet.has(String(songId))) {
            console.log('[OfflineView] 匹配成功 (songId):', track.title, songId)
            return true
          }
          
          // 匹配策略 2: 使用 track.id 匹配（某些情况下 _songId 可能未保存）
          if (trackId && cachedIdSet.has(String(trackId))) {
            console.log('[OfflineView] 匹配成功 (trackId):', track.title, trackId)
            return true
          }
          
          // 匹配策略 3: 检查 track.id 是否为 "platform_songId" 格式
          if (trackId && trackId.includes('_')) {
            const parts = trackId.split('_')
            const extractedId = parts[parts.length - 1]
            if (cachedIdSet.has(extractedId)) {
              console.log('[OfflineView] 匹配成功 (extractedId):', track.title, extractedId)
              return true
            }
          }
          
          // 匹配策略 4: 完整 URL 匹配
          if (track.url && cachedUrlSet.has(track.url)) {
            console.log('[OfflineView] 匹配成功 (URL):', track.title)
            return true
          }
          
          return false
        })
        .map((track: any) => ({
          id: track.id,
          title: track.title,
          artist: track.artist,
          size: 0, // 原生缓存不提供单个文件大小
          cachedAt: Date.now(),
          lastAccess: Date.now(),
          track
        }))
      
      console.log('[OfflineView] 匹配到的缓存歌曲数:', cachedTracks.value.length)
    } else {
      // Web: 使用 IndexedDB
      const metas = await audioCache.getCacheList()
      cachedTracks.value = metas.map(meta => {
        const track = trackStorage.getTrack(meta.id)
        return { ...meta, track }
      })
    }
  } finally {
    loading.value = false
  }
}

// 播放缓存歌曲
async function playCachedTrack(meta: CacheMeta & { track?: Track }) {
  if (Capacitor.isNativePlatform()) {
    // Android: 直接播放 track 中的 URL (ExoPlayer 会自动处理缓存)
    if (!meta.track) {
      alert('歌曲数据丢失')
      return
    }

    const { nativeAudioPlayer } = await import('@/services/player/NativeAudioPlayer')
    const isCached = await nativeAudioPlayer.isCached(meta.track.url)
    
    if (!isCached) {
      alert('缓存已失效，请重新缓存')
      await loadCachedTracks()
      return
    }

    playerStore.addTrack(meta.track)
    const idx = playerStore.playlist.findIndex(t => t.id === meta.track!.id)
    if (idx >= 0) {
      playerStore.playTrack(idx)
    }
    return
  }

  // Web: 获取缓存的音频 URL
  const cachedUrl = await audioCache.get(meta.id)
  if (!cachedUrl) {
    alert('缓存已失效，请重新缓存')
    await loadCachedTracks()
    return
  }

  // 构建 track 对象
  const track: Track = meta.track || {
    id: meta.id,
    title: meta.title,
    artist: meta.artist,
    url: cachedUrl,
    source: 'online',
    _cached: true
  }

  // 尝试获取缓存的封面
  const cachedCover = await audioCache.getCover(meta.id)
  if (cachedCover) {
    track.cover = cachedCover
  }

  // 添加到播放列表并播放
  playerStore.addTrack({ ...track, url: cachedUrl })
  const idx = playerStore.playlist.findIndex(t => t.id === track.id)
  if (idx >= 0) {
    playerStore.playTrack(idx)
  }
}

// 播放全部缓存歌曲
async function playAll() {
  if (cachedTracks.value.length === 0) return

  // 清空当前播放列表
  playerStore.setPlaylist([])

  if (Capacitor.isNativePlatform()) {
    // Android: 直接使用 trackStorage 中的数据
    for (const meta of cachedTracks.value) {
      if (meta.track) {
        playerStore.addTrack(meta.track)
      }
    }
  } else {
    // Web: 获取每个音频的 Blob URL
    for (const meta of cachedTracks.value) {
      const cachedUrl = await audioCache.get(meta.id)
      if (cachedUrl) {
        const track: Track = meta.track || {
          id: meta.id,
          title: meta.title,
          artist: meta.artist,
          url: cachedUrl,
          source: 'online',
          _cached: true
        }
        const cachedCover = await audioCache.getCover(meta.id)
        if (cachedCover) {
          track.cover = cachedCover
        }
        playerStore.addTrack({ ...track, url: cachedUrl })
      }
    }
  }

  // 播放第一首
  if (playerStore.playlist.length > 0) {
    playerStore.playTrack(0)
  }
}

// 删除单个缓存
async function deleteCache(id: string) {
  await audioCache.delete(id)
  closeActionMenu()
  await loadCachedTracks()
}

// 导出到本地
async function exportToLocal(item: CacheMeta & { track?: Track }) {
  exportingId.value = item.id
  closeActionMenu()
  try {
    const track: Track = item.track || {
      id: item.id,
      title: item.title,
      artist: item.artist,
      url: '',
      source: 'online'
    }
    await downloadService.download(track)
  } finally {
    exportingId.value = null
  }
}

onMounted(loadCachedTracks)
</script>

<template>
  <div class="flex-1 overflow-y-auto">
    <!-- 头部 -->
    <div class="sticky top-0 z-10 bg-black/50 backdrop-blur-xl p-4 border-b border-white/5">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-xl font-bold text-white flex items-center gap-2">
          <svg class="w-6 h-6 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          离线歌曲
        </h2>
        
        <!-- 离线模式开关 -->
        <button
          @click="offlineStore.toggleOfflineMode()"
          :class="[
            'flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-all',
            offlineStore.isOfflineMode 
              ? 'bg-purple-500 text-white' 
              : 'bg-white/10 text-white/60'
          ]"
        >
          <span class="w-2 h-2 rounded-full" :class="offlineStore.isOfflineMode ? 'bg-white' : 'bg-white/40'"></span>
          {{ offlineStore.isOfflineMode ? '离线模式' : '在线模式' }}
        </button>
      </div>

      <!-- 统计信息 -->
      <div class="flex items-center gap-4 text-sm text-white/50">
        <span>{{ cacheCount }} 首歌曲</span>
        <span>{{ formatSize(totalSize) }}</span>
        <!-- 刷新按钮 -->
        <button
          @click="loadCachedTracks"
          :disabled="loading"
          class="p-1 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition-all disabled:opacity-50"
          title="刷新列表"
        >
          <svg 
            :class="['w-4 h-4', loading ? 'animate-spin' : '']" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            stroke-width="2"
          >
            <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
          </svg>
        </button>
        <span v-if="!offlineStore.isOnline" class="text-orange-400 flex items-center gap-1">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="1" y1="1" x2="23" y2="23"/>
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/>
            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/>
            <path d="M10.71 5.05A16 16 0 0 1 22.58 9"/>
            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/>
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
            <line x1="12" y1="20" x2="12.01" y2="20"/>
          </svg>
          无网络
        </span>
      </div>

      <!-- 播放全部按钮 -->
      <button
        v-if="cachedTracks.length > 0"
        @click="playAll"
        class="mt-3 flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-purple-600 to-pink-600 text-white text-sm hover:opacity-90 transition-opacity"
      >
        <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z"/>
        </svg>
        播放全部
      </button>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <div class="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
    </div>

    <!-- 空状态 -->
    <div v-else-if="cachedTracks.length === 0" class="flex flex-col items-center justify-center py-20 text-white/40">
      <svg class="w-16 h-16 mb-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      <p class="text-lg mb-2">暂无离线歌曲</p>
      <p class="text-sm">播放在线歌曲时会自动缓存</p>
    </div>

    <!-- 歌曲列表 -->
    <div v-else class="p-4 space-y-2">
      <div
        v-for="item in cachedTracks"
        :key="item.id"
        class="group flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 active:bg-white/15 transition-colors cursor-pointer"
        @click="playCachedTrack(item)"
      >
        <!-- 封面占位 -->
        <div class="w-12 h-12 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0 overflow-hidden relative">
          <img 
            v-if="item.track?.cover" 
            :src="item.track.cover" 
            class="w-full h-full object-cover"
            @error="($event.target as HTMLImageElement).style.display = 'none'"
          />
          <svg v-else class="w-6 h-6 text-white/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18V5l12-2v13"/>
            <circle cx="6" cy="18" r="3"/>
            <circle cx="18" cy="16" r="3"/>
          </svg>
          <!-- 导出中指示器 -->
          <div v-if="exportingId === item.id" class="absolute inset-0 bg-black/50 flex items-center justify-center">
            <svg class="w-5 h-5 text-white animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
            </svg>
          </div>
        </div>

        <!-- 歌曲信息 -->
        <div class="flex-1 min-w-0">
          <p class="text-white font-medium truncate">{{ item.title }}</p>
          <div class="flex items-center gap-2 text-white/50 text-sm">
            <span class="truncate">{{ item.artist }}</span>
            <span v-if="item.size > 0" class="text-white/30 text-xs">{{ formatSize(item.size) }}</span>
          </div>
        </div>

        <!-- 桌面端：悬浮显示操作按钮 -->
        <div class="hidden sm:flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <!-- 导出按钮 -->
          <button
            @click.stop="exportToLocal(item)"
            :disabled="exportingId === item.id"
            class="p-2 rounded-full hover:bg-white/10 text-white/40 hover:text-blue-400 transition-all disabled:opacity-50"
            title="导出到本地"
          >
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
            </svg>
          </button>
          <!-- 删除按钮 -->
          <button
            @click.stop="deleteCache(item.id)"
            class="p-2 rounded-full hover:bg-white/10 text-white/40 hover:text-red-400 transition-all"
          >
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>

        <!-- 移动端：更多按钮 -->
        <button
          @click.stop="openActionMenu(item)"
          class="sm:hidden p-2 rounded-full text-white/40 active:bg-white/10"
        >
          <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- 移动端操作菜单 -->
    <Transition name="action-menu">
      <div 
        v-if="showActionMenu && actionMenuItem" 
        class="fixed inset-0 z-[200] sm:hidden"
        @click="closeActionMenu"
      >
        <div class="absolute inset-0 bg-black/60"></div>
        <div class="absolute bottom-0 left-0 right-0 bg-neutral-900 rounded-t-2xl safe-area-pb" @click.stop>
          <!-- 歌曲信息 -->
          <div class="flex items-center gap-3 p-4 border-b border-white/10">
            <div class="w-12 h-12 rounded-lg bg-white/10 flex items-center justify-center overflow-hidden">
              <img 
                v-if="actionMenuItem.track?.cover" 
                :src="actionMenuItem.track.cover" 
                class="w-full h-full object-cover"
              />
              <span v-else class="text-2xl">🎵</span>
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-white font-medium truncate">{{ actionMenuItem.title }}</p>
              <p class="text-white/50 text-sm truncate">{{ actionMenuItem.artist }}</p>
            </div>
          </div>
          
          <!-- 操作按钮 -->
          <div class="py-2">
            <button
              @click="playCachedTrack(actionMenuItem!); closeActionMenu()"
              class="w-full flex items-center gap-4 px-4 py-3 text-white active:bg-white/10"
            >
              <svg class="w-6 h-6 text-purple-400" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z"/>
              </svg>
              <span>播放</span>
            </button>
            <button
              @click="exportToLocal(actionMenuItem!)"
              :disabled="exportingId === actionMenuItem.id"
              class="w-full flex items-center gap-4 px-4 py-3 text-white active:bg-white/10 disabled:opacity-50"
            >
              <svg class="w-6 h-6 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
              </svg>
              <span>{{ exportingId === actionMenuItem.id ? '导出中...' : '导出到本地' }}</span>
            </button>
            <button
              @click="deleteCache(actionMenuItem!.id)"
              class="w-full flex items-center gap-4 px-4 py-3 text-red-400 active:bg-white/10"
            >
              <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
              <span>删除缓存</span>
            </button>
          </div>
          
          <!-- 取消按钮 -->
          <div class="p-4 border-t border-white/10">
            <button
              @click="closeActionMenu"
              class="w-full py-3 rounded-xl bg-white/10 text-white font-medium active:bg-white/20"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 提示信息 -->
    <div class="p-4">
      <div class="p-4 rounded-lg bg-white/5 text-white/50 text-sm">
        <p class="font-medium text-white/70 mb-2">💡 离线模式说明</p>
        <ul class="space-y-1">
          <li>• 开启离线模式后，只播放已缓存的歌曲</li>
          <li>• 播放在线歌曲时会自动缓存到本地</li>
          <li>• 网络断开时会自动切换到离线模式</li>
          <li>• 缓存上限为 500MB，超出后自动清理旧缓存</li>
        </ul>
      </div>
    </div>
  </div>
</template>


<style scoped>
/* 安全区域底部 */
.safe-area-pb {
  padding-bottom: env(safe-area-inset-bottom, 0);
}

/* 操作菜单动画 */
.action-menu-enter-active,
.action-menu-leave-active {
  transition: all 0.3s ease;
}
.action-menu-enter-active > div:last-child,
.action-menu-leave-active > div:last-child {
  transition: transform 0.3s ease;
}
.action-menu-enter-from,
.action-menu-leave-to {
  opacity: 0;
}
.action-menu-enter-from > div:last-child,
.action-menu-leave-to > div:last-child {
  transform: translateY(100%);
}
</style>
