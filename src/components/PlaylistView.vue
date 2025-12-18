<script setup lang="ts">
import { ref, computed } from 'vue'
import { usePlayerStore } from '@/store/player'
import { usePlaylistStore } from '@/store/playlist'
import { formatTime } from '@/utils/formatTime'
import type { Playlist } from '@/types'

const playerStore = usePlayerStore()
const playlistStore = usePlaylistStore()

const selectedPlaylist = ref<Playlist | null>(null)
const showCreateModal = ref(false)
const newPlaylistName = ref('')
const editingId = ref<string | null>(null)
const editingName = ref('')

// 视图模式: 'grid' 网格视图, 'list' 多行列表视图
const viewMode = ref<'grid' | 'list'>('grid')

// 获取歌单中的歌曲
const playlistTracks = computed(() => {
  if (!selectedPlaylist.value) return []
  return selectedPlaylist.value.trackIds
    .map(id => playerStore.playlist.find(t => t.id === id))
    .filter(Boolean)
})

// 获取歌单封面（使用第一首歌的封面）
function getPlaylistCover(playlist: Playlist) {
  if (playlist.cover) return playlist.cover
  const firstTrackId = playlist.trackIds[0]
  if (firstTrackId) {
    const track = playerStore.playlist.find(t => t.id === firstTrackId)
    return track?.cover
  }
  return null
}

function createPlaylist() {
  if (!newPlaylistName.value.trim()) return
  playlistStore.createPlaylist(newPlaylistName.value.trim())
  newPlaylistName.value = ''
  showCreateModal.value = false
}

function startEdit(playlist: Playlist) {
  editingId.value = playlist.id
  editingName.value = playlist.name
}

function saveEdit() {
  if (editingId.value && editingName.value.trim()) {
    playlistStore.renamePlaylist(editingId.value, editingName.value.trim())
  }
  editingId.value = null
}

function deletePlaylist(id: string) {
  if (confirm('确定删除这个歌单？')) {
    playlistStore.deletePlaylist(id)
    if (selectedPlaylist.value?.id === id) {
      selectedPlaylist.value = null
    }
  }
}

function selectPlaylist(playlist: Playlist) {
  selectedPlaylist.value = playlist
}

function backToList() {
  selectedPlaylist.value = null
}

function playTrack(trackId: string) {
  const idx = playerStore.playlist.findIndex(t => t.id === trackId)
  if (idx >= 0) {
    playerStore.playTrack(idx)
  }
}

function removeFromPlaylist(trackId: string) {
  if (selectedPlaylist.value) {
    playlistStore.removeFromPlaylist(selectedPlaylist.value.id, trackId)
  }
}

function playAll() {
  if (playlistTracks.value.length > 0) {
    const firstTrack = playlistTracks.value[0]
    if (firstTrack) {
      const idx = playerStore.playlist.findIndex(t => t.id === firstTrack.id)
      if (idx >= 0) playerStore.playTrack(idx)
    }
  }
}
</script>

<template>
  <div class="flex-1 p-6 flex flex-col h-full overflow-hidden">
    <!-- 歌单列表 -->
    <template v-if="!selectedPlaylist">
      <div class="flex items-center justify-between mb-6 flex-shrink-0">
        <h2 class="text-2xl font-bold text-white">📋 我的歌单</h2>
        <div class="flex items-center gap-2">
          <!-- 视图切换按钮 -->
          <div class="flex rounded-lg bg-white/10 p-1">
            <button
              @click="viewMode = 'grid'"
              :class="['px-3 py-1.5 rounded-md text-sm transition-colors', viewMode === 'grid' ? 'bg-purple-600 text-white' : 'text-white/60 hover:text-white']"
              title="网格视图"
            >
              ⊞
            </button>
            <button
              @click="viewMode = 'list'"
              :class="['px-3 py-1.5 rounded-md text-sm transition-colors', viewMode === 'list' ? 'bg-purple-600 text-white' : 'text-white/60 hover:text-white']"
              title="列表视图"
            >
              ☰
            </button>
          </div>
          <button
            @click="showCreateModal = true"
            class="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm transition-colors"
          >
            + 新建歌单
          </button>
        </div>
      </div>

      <div v-if="playlistStore.playlists.length === 0" class="text-center py-20">
        <p class="text-4xl mb-4">📋</p>
        <p class="text-white/50">还没有歌单</p>
        <button
          @click="showCreateModal = true"
          class="mt-4 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm"
        >
          创建第一个歌单
        </button>
      </div>

      <!-- 网格视图 -->
      <div v-else-if="viewMode === 'grid'" class="flex-1 overflow-y-auto grid place-content-center">
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4" style="max-width: fit-content;">
        <div
          v-for="playlist in playlistStore.playlists"
          :key="playlist.id"
          @click="selectPlaylist(playlist)"
          class="group cursor-pointer w-36 flex flex-col items-center"
        >
          <div class="relative aspect-square w-full rounded-xl overflow-hidden bg-white/10 mb-2">
            <img
              v-if="getPlaylistCover(playlist)"
              :src="getPlaylistCover(playlist)"
              class="w-full h-full object-cover"
            />
            <div v-else class="w-full h-full flex items-center justify-center text-4xl bg-gradient-to-br from-purple-600/50 to-pink-600/50">
              🎵
            </div>
            <!-- 悬浮操作 -->
            <div class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
              <button
                @click.stop="startEdit(playlist)"
                class="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30"
                title="编辑"
              >
                ✏️
              </button>
              <button
                @click.stop="deletePlaylist(playlist.id)"
                class="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-red-500/50"
                title="删除"
              >
                🗑️
              </button>
            </div>
            <!-- 歌曲数量 -->
            <div class="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/60 text-white text-xs">
              {{ playlist.trackIds.length }} 首
            </div>
          </div>
          <!-- 歌单名（可编辑） -->
          <div v-if="editingId === playlist.id" class="flex gap-1 w-full">
            <input
              v-model="editingName"
              @keyup.enter="saveEdit"
              @blur="saveEdit"
              class="flex-1 px-2 py-1 rounded bg-white/10 text-white text-sm outline-none text-center"
              autofocus
            />
          </div>
          <p v-else class="text-white text-sm font-medium truncate text-center w-full">{{ playlist.name }}</p>
        </div>
        </div>
      </div>

      <!-- 多行列表视图 -->
      <div v-else class="flex-1 overflow-y-auto space-y-2">
        <div
          v-for="playlist in playlistStore.playlists"
          :key="playlist.id"
          @click="selectPlaylist(playlist)"
          class="group flex items-center gap-4 p-3 rounded-xl cursor-pointer hover:bg-white/10 transition-colors"
        >
          <div class="relative w-14 h-14 rounded-lg overflow-hidden bg-white/10 flex-shrink-0">
            <img
              v-if="getPlaylistCover(playlist)"
              :src="getPlaylistCover(playlist)"
              class="w-full h-full object-cover"
            />
            <div v-else class="w-full h-full flex items-center justify-center text-2xl bg-gradient-to-br from-purple-600/50 to-pink-600/50">
              🎵
            </div>
          </div>
          <div class="flex-1 min-w-0">
            <div v-if="editingId === playlist.id" class="flex gap-1">
              <input
                v-model="editingName"
                @keyup.enter="saveEdit"
                @blur="saveEdit"
                @click.stop
                class="flex-1 px-2 py-1 rounded bg-white/10 text-white text-sm outline-none"
                autofocus
              />
            </div>
            <p v-else class="text-white font-medium truncate">{{ playlist.name }}</p>
            <p class="text-white/50 text-sm">{{ playlist.trackIds.length }} 首歌曲</p>
          </div>
          <div class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              @click.stop="startEdit(playlist)"
              class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20"
              title="编辑"
            >
              ✏️
            </button>
            <button
              @click.stop="deletePlaylist(playlist.id)"
              class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-red-500/50"
              title="删除"
            >
              🗑️
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- 歌单详情 -->
    <template v-else>
      <div class="flex items-center gap-4 mb-6">
        <button
          @click="backToList"
          class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/20"
        >
          ←
        </button>
        <div class="flex-1">
          <h2 class="text-2xl font-bold text-white">{{ selectedPlaylist.name }}</h2>
          <p class="text-white/50 text-sm">{{ selectedPlaylist.trackIds.length }} 首歌曲</p>
        </div>
        <button
          v-if="playlistTracks.length > 0"
          @click="playAll"
          class="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm"
        >
          ▶ 播放全部
        </button>
      </div>

      <div v-if="playlistTracks.length === 0" class="text-center py-20">
        <p class="text-white/50">歌单是空的</p>
        <p class="text-white/30 text-sm mt-2">在播放列表中将歌曲添加到此歌单</p>
      </div>

      <div v-else class="space-y-2">
        <div
          v-for="(track, index) in playlistTracks"
          :key="track!.id"
          @click="playTrack(track!.id)"
          class="group flex items-center gap-4 p-3 rounded-xl cursor-pointer hover:bg-white/10 transition-colors"
        >
          <span class="w-6 text-white/30 text-sm text-right">{{ index + 1 }}</span>
          <div class="w-10 h-10 rounded-lg overflow-hidden bg-white/10 flex-shrink-0">
            <img v-if="track!.cover" :src="track!.cover" class="w-full h-full object-cover" />
            <div v-else class="w-full h-full flex items-center justify-center">🎵</div>
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-white text-sm truncate">{{ track!.title }}</p>
            <p class="text-white/50 text-xs truncate">{{ track!.artist }}</p>
          </div>
          <button
            @click.stop="removeFromPlaylist(track!.id)"
            class="opacity-0 group-hover:opacity-100 text-white/40 hover:text-red-400 transition-all"
            title="从歌单移除"
          >
            ✕
          </button>
          <span class="text-white/30 text-xs">{{ track!.duration ? formatTime(track!.duration) : '--:--' }}</span>
        </div>
      </div>
    </template>

    <!-- 新建歌单弹窗 -->
    <Transition name="fade">
      <div
        v-if="showCreateModal"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        @click.self="showCreateModal = false"
      >
        <div class="bg-neutral-900 rounded-2xl p-6 w-80 border border-white/10">
          <h3 class="text-white font-bold mb-4">新建歌单</h3>
          <input
            v-model="newPlaylistName"
            @keyup.enter="createPlaylist"
            type="text"
            placeholder="输入歌单名称"
            class="w-full h-10 px-3 rounded-lg bg-white/10 text-white placeholder-white/30 outline-none focus:bg-white/15 mb-4"
            autofocus
          />
          <div class="flex gap-2">
            <button
              @click="showCreateModal = false"
              class="flex-1 h-10 rounded-lg bg-white/10 text-white hover:bg-white/20"
            >
              取消
            </button>
            <button
              @click="createPlaylist"
              :disabled="!newPlaylistName.trim()"
              class="flex-1 h-10 rounded-lg bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-50"
            >
              创建
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
