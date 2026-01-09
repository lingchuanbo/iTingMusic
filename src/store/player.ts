import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import type { Track, PlayMode } from '@/types'
import { audioCache } from '@/services/cache/AudioCache'

const STORAGE_KEY = 'zen_player_data'
const CACHED_URLS_KEY = 'zen_cached_urls'

// 从 localStorage 加载缓存 URL 列表
function loadCachedUrls(): Set<string> {
  try {
    const data = localStorage.getItem(CACHED_URLS_KEY)
    if (data) {
      return new Set(JSON.parse(data))
    }
  } catch (e) {
    console.error('加载缓存URL列表失败:', e)
  }
  return new Set()
}

// 保存缓存 URL 列表
function saveCachedUrls(urls: Set<string>) {
  try {
    // 限制最多保存 500 个 URL
    const arr = Array.from(urls).slice(-500)
    localStorage.setItem(CACHED_URLS_KEY, JSON.stringify(arr))
  } catch (e) {
    console.error('保存缓存URL列表失败:', e)
  }
}
function loadFromStorage() {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    if (data) {
      const parsed = JSON.parse(data)
      return {
        playlist: parsed.playlist || [],
        currentIndex: parsed.currentIndex ?? -1,
        volume: parsed.volume ?? 0.8,
        playMode: parsed.playMode || 'sequence',
        backgroundPlayEnabled: parsed.backgroundPlayEnabled ?? true
      }
    }
  } catch (e) {
    console.error('加载播放数据失败:', e)
  }
  return { playlist: [], currentIndex: -1, volume: 0.8, playMode: 'sequence', backgroundPlayEnabled: true }
}

export const usePlayerStore = defineStore('player', () => {
  // 从存储加载初始数据
  const saved = loadFromStorage()

  // 状态
  const playlist = ref<Track[]>(saved.playlist)
  const currentIndex = ref(saved.currentIndex)
  const playVersion = ref(0) // 播放版本号，用于强制触发播放
  const isPlaying = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  const buffered = ref(0) // 缓冲进度 0-100
  const isCached = ref(false) // 当前歌曲是否已缓存
  const volume = ref(saved.volume)
  const playMode = ref<PlayMode>(saved.playMode as PlayMode)
  const showLyrics = ref(false)
  const backgroundPlayEnabled = ref(saved.backgroundPlayEnabled)

  // 缓存 URL 记录 (前端追踪已缓存的歌曲)
  const cachedUrls = loadCachedUrls()

  // 计算属性
  const currentTrack = computed(() =>
    currentIndex.value >= 0 ? playlist.value[currentIndex.value] : null
  )

  const progress = computed(() =>
    duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0
  )

  // 保存到 localStorage - 使用防抖减少写入频率
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  function saveToStorage() {
    // 防抖：300ms 内的多次调用只执行最后一次
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
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
          playMode: playMode.value,
          backgroundPlayEnabled: backgroundPlayEnabled.value
        }))
      } catch (e) {
        console.error('保存播放数据失败:', e)
      }
    }, 300)
  }

  // 监听变化自动保存
  watch([playlist, currentIndex, volume, playMode, backgroundPlayEnabled], saveToStorage, { deep: true })

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
      // 重置播放时间
      currentTime.value = 0
      duration.value = 0
      // 更新索引
      currentIndex.value = index
      // 立即检查缓存状态
      checkAndSetCached()
      // 增加版本号强制触发播放（即使是同一首歌）
      playVersion.value++
      isPlaying.value = true
    }
  }

  function togglePlay() {
    isPlaying.value = !isPlaying.value
  }

  function nextTrack() {
    if (playlist.value.length === 0) return
    // 重置播放时间
    currentTime.value = 0
    duration.value = 0

    if (playMode.value === 'shuffle') {
      currentIndex.value = Math.floor(Math.random() * playlist.value.length)
    } else {
      currentIndex.value = (currentIndex.value + 1) % playlist.value.length
    }
    // 检查缓存状态
    checkAndSetCached()
    // 增加版本号触发播放
    playVersion.value++
    isPlaying.value = true
  }

  function prevTrack() {
    if (playlist.value.length === 0) return
    // 重置播放时间
    currentTime.value = 0
    duration.value = 0

    currentIndex.value = currentIndex.value <= 0
      ? playlist.value.length - 1
      : currentIndex.value - 1
    // 检查缓存状态
    checkAndSetCached()
    // 增加版本号触发播放
    playVersion.value++
    isPlaying.value = true
  }

  function setCurrentTime(time: number) {
    currentTime.value = time
  }

  function setDuration(d: number) {
    duration.value = d
  }

  function setBuffered(b: number) {
    buffered.value = Math.max(0, Math.min(100, b))
  }

  function setCached(cached: boolean) {
    isCached.value = cached
  }

  // 标记当前歌曲为已缓存
  function markCurrentAsCached() {
    const track = currentTrack.value
    if (track?.url) {
      cachedUrls.add(track.url)
      saveCachedUrls(cachedUrls)
      isCached.value = true
    }
  }

  // 检查并设置当前歌曲的缓存状态
  function checkAndSetCached() {
    const track = currentTrack.value
    if (track?.url) {
      isCached.value = cachedUrls.has(track.url)
    } else {
      isCached.value = false
    }
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
    // 删除所有歌曲的缓存
    playlist.value.forEach(track => {
      audioCache.delete(track.id)
    })
    playlist.value = []
    currentIndex.value = -1
  }

  function removeTrack(index: number) {
    if (index < 0 || index >= playlist.value.length) return

    const track = playlist.value[index]
    // 删除该歌曲的缓存
    audioCache.delete(track.id)

    playlist.value.splice(index, 1)

    // 调整当前索引
    if (playlist.value.length === 0) {
      currentIndex.value = -1
      isPlaying.value = false
    } else if (index < currentIndex.value) {
      currentIndex.value--
    } else if (index === currentIndex.value) {
      // 删除的是当前播放的歌曲
      if (currentIndex.value >= playlist.value.length) {
        currentIndex.value = 0
      }
      playVersion.value++
    }
  }

  function toggleBackgroundPlay() {
    backgroundPlayEnabled.value = !backgroundPlayEnabled.value
  }

  return {
    playlist, currentIndex, playVersion, isPlaying, currentTime, duration, buffered, isCached, volume, playMode, showLyrics, backgroundPlayEnabled,
    currentTrack, progress,
    setPlaylist, addTrack, playTrack, togglePlay, nextTrack, prevTrack,
    setCurrentTime, setDuration, setBuffered, setCached, markCurrentAsCached, checkAndSetCached, setVolume, togglePlayMode, toggleLyrics, clearPlaylist, removeTrack, toggleBackgroundPlay
  }
})
