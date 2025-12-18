import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { Track, PlayMode } from '@/types'

const STORAGE_KEY = 'zen_player_data'

// 从 localStorage 加载数据
function loadFromStorage() {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    if (data) {
      const parsed = JSON.parse(data)
      return {
        playlist: parsed.playlist || [],
        currentIndex: parsed.currentIndex ?? -1,
        volume: parsed.volume ?? 0.8,
        playMode: parsed.playMode || 'sequence'
      }
    }
  } catch (e) {
    console.error('加载播放数据失败:', e)
  }
  return { playlist: [], currentIndex: -1, volume: 0.8, playMode: 'sequence' }
}

export const usePlayerStore = defineStore('player', () => {
  // 从存储加载初始数据
  const saved = loadFromStorage()

  // 状态
  const playlist = ref<Track[]>(saved.playlist)
  const currentIndex = ref(saved.currentIndex)
  const isPlaying = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  const volume = ref(saved.volume)
  const playMode = ref<PlayMode>(saved.playMode as PlayMode)
  const showLyrics = ref(false)

  // 计算属性
  const currentTrack = computed(() =>
    currentIndex.value >= 0 ? playlist.value[currentIndex.value] : null
  )

  const progress = computed(() =>
    duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0
  )

  // 保存到 localStorage
  function saveToStorage() {
    try {
      // 过滤掉本地文件的 blob URL（无法持久化）
      const savablePlaylist = playlist.value.map(track => ({
        ...track,
        // 本地文件的 blob URL 无法保存，标记一下
        url: track.url.startsWith('blob:') ? '' : track.url,
        cover: track.cover?.startsWith('blob:') ? '' : track.cover
      })).filter(t => t.url) // 只保存有有效 URL 的

      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        playlist: savablePlaylist,
        currentIndex: currentIndex.value,
        volume: volume.value,
        playMode: playMode.value
      }))
    } catch (e) {
      console.error('保存播放数据失败:', e)
    }
  }

  // 监听变化自动保存
  watch([playlist, currentIndex, volume, playMode], saveToStorage, { deep: true })

  // 操作
  function setPlaylist(tracks: Track[]) {
    playlist.value = tracks
  }

  function addTrack(track: Track) {
    // 检查是否已存在
    const exists = playlist.value.some(t => t.id === track.id)
    if (!exists) {
      playlist.value.push(track)
    }
  }

  function playTrack(index: number) {
    if (index >= 0 && index < playlist.value.length) {
      currentIndex.value = index
      isPlaying.value = true
    }
  }

  function togglePlay() {
    isPlaying.value = !isPlaying.value
  }

  function nextTrack() {
    if (playlist.value.length === 0) return
    if (playMode.value === 'shuffle') {
      currentIndex.value = Math.floor(Math.random() * playlist.value.length)
    } else {
      currentIndex.value = (currentIndex.value + 1) % playlist.value.length
    }
  }

  function prevTrack() {
    if (playlist.value.length === 0) return
    currentIndex.value = currentIndex.value <= 0
      ? playlist.value.length - 1
      : currentIndex.value - 1
  }

  function setCurrentTime(time: number) {
    currentTime.value = time
  }

  function setDuration(d: number) {
    duration.value = d
  }

  function setVolume(v: number) {
    volume.value = Math.max(0, Math.min(1, v))
  }

  function togglePlayMode() {
    const modes: PlayMode[] = ['sequence', 'loop', 'shuffle', 'single']
    const idx = modes.indexOf(playMode.value)
    playMode.value = modes[(idx + 1) % modes.length]
  }

  function toggleLyrics() {
    showLyrics.value = !showLyrics.value
  }

  function clearPlaylist() {
    playlist.value = []
    currentIndex.value = -1
  }

  return {
    playlist, currentIndex, isPlaying, currentTime, duration, volume, playMode, showLyrics,
    currentTrack, progress,
    setPlaylist, addTrack, playTrack, togglePlay, nextTrack, prevTrack,
    setCurrentTime, setDuration, setVolume, togglePlayMode, toggleLyrics, clearPlaylist
  }
})
