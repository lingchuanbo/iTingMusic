<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { Capacitor } from '@capacitor/core'
import { usePlayerStore } from '@/store/player'
import { useOfflineStore } from '@/store/offline'
import { useEqualizerStore } from '@/store/equalizer'
import type { AudioQuality, MusicSource, ApiProviderType } from '@/services/source/OnlineApiSource'
import {
  getActiveProviderId,
  setActiveProvider,
  getAllProviders,
  getActiveProvider,
  getTuneHubApiKey,
  setTuneHubApiKey
} from '@/services/source/ApiProviders'
import {
  loadAIConfig,
  saveAIConfig,
  resetToBuiltinConfig,
  switchToBuiltinAI,
  BUILTIN_AI_LIST,
  type AIConfig
} from '@/services/ai/AIService'
import { audioCache } from '@/services/cache/AudioCache'
import { downloadService, type DownloadSettings } from '@/services/DownloadService'
import { logger } from '@/services/LoggerService'
import EqualizerView from '@/components/EqualizerView.vue'
import LogViewer from '@/components/LogViewer.vue'

const store = usePlayerStore()
const offlineStore = useOfflineStore()
const eqStore = useEqualizerStore()

// 均衡器全屏显示状态
const showEqualizer = ref(false)

// 日志查看器显示状态
const showLogViewer = ref(false)
const logCount = ref(logger.getLogCount())
const logEnabled = ref(logger.enabled)

function toggleLogEnabled() {
  logEnabled.value = !logEnabled.value
  logger.setEnabled(logEnabled.value)
}

function openLogViewer() {
  logCount.value = logger.getLogCount()
  showLogViewer.value = true
}

// 下载设置
const downloadSettings = ref<DownloadSettings>(downloadService.getSettings())
const downloadPath = ref(downloadService.getDownloadPathDescription())

const fileNameFormats = [
  { value: 'artist-title', label: '歌手 - 歌名' },
  { value: 'title-artist', label: '歌名 - 歌手' },
  { value: 'title', label: '仅歌名' }
] as const

function updateDownloadSettings() {
  downloadService.saveSettings(downloadSettings.value)
  downloadPath.value = downloadService.getDownloadPathDescription()
}

// API 提供商设置
const currentProviderId = ref<ApiProviderType>(getActiveProviderId())
const allProviders = getAllProviders()

// TuneHub API Key 设置
const tuneHubApiKey = ref(getTuneHubApiKey())
const showTuneHubApiKey = ref(false)

function saveTuneHubApiKey() {
  setTuneHubApiKey(tuneHubApiKey.value)
}

function selectProvider(id: ApiProviderType) {
  currentProviderId.value = id
  setActiveProvider(id)
  // 更新启用的音乐源为当前 provider 支持的源
  const provider = getActiveProvider()
  const supported = provider.supportedPlatforms
  enabledSources.value = enabledSources.value.filter(s => supported.includes(s))
  if (enabledSources.value.length === 0) {
    enabledSources.value = [supported[0]]
  }
  saveEnabledSources(enabledSources.value)
}

// 音乐源设置
const MUSIC_SOURCES_KEY = 'enabled_music_sources'
const allMusicSources: { value: MusicSource; label: string }[] = [
  { value: 'netease', label: '网易云音乐' },
  { value: 'qq', label: 'QQ音乐' },
  { value: 'kuwo', label: '酷我音乐' },
  { value: 'kugou', label: '酷狗音乐' },
  { value: 'migu', label: '咪咕音乐' },
  { value: 'joox', label: 'JOOX' }
]

const defaultEnabledSources: MusicSource[] = ['netease', 'qq', 'kuwo']

function loadEnabledSources(): MusicSource[] {
  try {
    const data = localStorage.getItem(MUSIC_SOURCES_KEY)
    if (data) return JSON.parse(data)
  } catch {}
  return defaultEnabledSources
}

function saveEnabledSources(sources: MusicSource[]) {
  localStorage.setItem(MUSIC_SOURCES_KEY, JSON.stringify(sources))
}

const enabledSources = ref<MusicSource[]>(loadEnabledSources())

function toggleSource(source: MusicSource) {
  const idx = enabledSources.value.indexOf(source)
  if (idx >= 0) {
    if (enabledSources.value.length > 1) {
      enabledSources.value.splice(idx, 1)
    }
  } else {
    enabledSources.value.push(source)
  }
  saveEnabledSources(enabledSources.value)
}

// 缓存统计
const cacheStats = ref({ count: 0, totalSize: 0 })
const cacheLoading = ref(false)

// 缓存大小配置
const CACHE_SIZE_KEY = 'audio_cache_max_size'
const cacheSizeOptions = [
  { value: 500, label: '500MB' },
  { value: 1024, label: '1GB' },
  { value: 2048, label: '2GB' },
  { value: 5120, label: '5GB' },
  { value: 10240, label: '10GB' }
]
const maxCacheSizeMB = ref<number>(
  Number(localStorage.getItem(CACHE_SIZE_KEY)) || 2048
)

function setCacheSize(sizeMB: number) {
  maxCacheSizeMB.value = sizeMB
  localStorage.setItem(CACHE_SIZE_KEY, String(sizeMB))
  // 注意：缓存大小设置在应用重启后生效
}

async function loadCacheStats() {
  if (Capacitor.isNativePlatform()) {
    // Android: 使用 ExoPlayer 原生缓存统计
    const { nativeAudioPlayer } = await import('@/services/player/NativeAudioPlayer')
    const stats = await nativeAudioPlayer.getCacheStats()
    console.log('[SettingsView] 原生缓存统计:', stats)
    cacheStats.value = { count: stats.count, totalSize: stats.sizeBytes }
  } else {
    // Web: 使用 IndexedDB 缓存
    cacheStats.value = await audioCache.getStats()
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

async function clearCache() {
  if (!confirm('确定清空所有缓存？')) return
  cacheLoading.value = true
  if (Capacitor.isNativePlatform()) {
    // Android: 清空 ExoPlayer 原生缓存
    const { nativeAudioPlayer } = await import('@/services/player/NativeAudioPlayer')
    await nativeAudioPlayer.clearCache()
  } else {
    // Web: 清空 IndexedDB 缓存
    await audioCache.clearAll()
  }
  await loadCacheStats()
  cacheLoading.value = false
}

onMounted(loadCacheStats)

// 音质设置
const defaultQuality = ref<AudioQuality>(
  (localStorage.getItem('defaultQuality') as AudioQuality) || '320k'
)

const qualities: { value: AudioQuality; label: string; desc: string }[] = [
  { value: '128k', label: '标准', desc: '128kbps' },
  { value: '320k', label: '高品', desc: '320kbps' },
  { value: 'flac', label: '无损', desc: 'FLAC' },
  { value: 'flac24bit', label: 'Hi-Res', desc: '24bit' }
]

// AI 配置
const aiConfig = ref<AIConfig>(loadAIConfig())
const showApiKey = ref(false)
const aiTestStatus = ref<'idle' | 'testing' | 'success' | 'error'>('idle')
const aiTestMessage = ref('')
const selectedCustomProvider = ref<string>('custom') // 自定义模式下选择的服务商

// 当前 AI 配置显示
const currentAIDisplay = computed(() => {
  if (aiConfig.value.provider === 'builtin' && aiConfig.value.builtinId) {
    const builtin = BUILTIN_AI_LIST.find(ai => ai.id === aiConfig.value.builtinId)
    return builtin?.name || '内置 AI'
  }
  if (aiConfig.value.provider === 'custom') {
    const provider = customProviders.find(p => p.baseUrl === aiConfig.value.baseUrl)
    if (provider && provider.id !== 'custom') {
      return provider.name
    }
    return aiConfig.value.model || '自定义'
  }
  return '未配置'
})

// 自定义AI服务商预设
const customProviders = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'gemini', name: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash' },
  { id: 'custom', name: '通用接口', baseUrl: '', model: '' }
]

// 选择内置AI
function selectBuiltinAI(builtinId: string) {
  aiConfig.value = switchToBuiltinAI(builtinId)
  aiTestStatus.value = 'idle'
}

// 切换到自定义模式
function switchToCustom() {
  aiConfig.value.provider = 'custom'
  aiConfig.value.builtinId = undefined
  // 默认选择通用接口
  selectedCustomProvider.value = 'custom'
  aiConfig.value.apiKey = ''
  aiConfig.value.baseUrl = ''
  aiConfig.value.model = ''
  saveAIConfig(aiConfig.value)
}

// 选择自定义服务商预设
function selectCustomProvider(providerId: string) {
  selectedCustomProvider.value = providerId
  const provider = customProviders.find(p => p.id === providerId)
  if (provider) {
    aiConfig.value.baseUrl = provider.baseUrl
    aiConfig.value.model = provider.model
    // 保留已输入的 API Key
    saveAIConfig(aiConfig.value)
  }
}

function setQuality(q: AudioQuality) {
  defaultQuality.value = q
  localStorage.setItem('defaultQuality', q)
}

function saveAI() {
  saveAIConfig(aiConfig.value)
  aiTestStatus.value = 'idle'
}

async function testAIConnection() {
  if (!aiConfig.value.apiKey) {
    aiTestStatus.value = 'error'
    aiTestMessage.value = '请输入 API Key'
    return
  }

  aiTestStatus.value = 'testing'
  aiTestMessage.value = ''

  try {
    // 根据 authType 设置认证头
    const authHeaders: Record<string, string> =
      aiConfig.value.authType === 'api-key'
        ? { 'api-key': aiConfig.value.apiKey }
        : { Authorization: `Bearer ${aiConfig.value.apiKey}` }

    // 构建请求体
    const requestBody: Record<string, unknown> = {
      model: aiConfig.value.model,
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 10
    }

    // xiaomimimo 需要 thinking 参数
    if (aiConfig.value.builtinId === 'xiaomimimo') {
      requestBody.thinking = { type: 'disabled' }
    }

    const response = await fetch(`${aiConfig.value.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders
      },
      body: JSON.stringify(requestBody)
    })

    if (response.ok) {
      aiTestStatus.value = 'success'
      aiTestMessage.value = '连接成功'
      saveAI()
    } else {
      const errorText = await response.text().catch(() => '')
      aiTestStatus.value = 'error'
      aiTestMessage.value = `失败: ${response.status} ${errorText.slice(0, 50)}`
    }
  } catch (e: any) {
    aiTestStatus.value = 'error'
    // 更友好的错误提示
    if (e.message.includes('NetworkError') || e.message.includes('Failed to fetch')) {
      aiTestMessage.value = '网络错误，可能是 CORS 限制或地址不可达'
    } else {
      aiTestMessage.value = `失败: ${e.message}`
    }
  }
}

function clearPlaylist() {
  if (confirm('确定清空播放列表？')) {
    store.clearPlaylist()
  }
}

function clearFavorites() {
  if (confirm('确定清空收藏？')) {
    localStorage.removeItem('favorites')
  }
}

function clearWebDAV() {
  localStorage.removeItem('webdav_config')
  alert('已清除 WebDAV 配置')
}

function clearAIConfig() {
  aiConfig.value = resetToBuiltinConfig()
  alert('已重置为默认 AI 配置')
}

// 展开/收起状态
const expandedSections = ref<Set<string>>(new Set(['sources']))

function toggleSection(section: string) {
  if (expandedSections.value.has(section)) {
    expandedSections.value.delete(section)
  } else {
    expandedSections.value.add(section)
  }
}
</script>

<template>
  <div class="flex-1 overflow-y-auto">
    <div class="max-w-lg mx-auto p-4 space-y-3">
      <!-- 音乐源 -->
      <section class="bg-white/5 rounded-xl overflow-hidden">
        <button 
          @click="toggleSection('sources')"
          class="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
        >
          <div class="flex items-center gap-3">
            <svg class="w-5 h-5 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 1v6m0 6v10"/>
              <path d="M21 12h-6m-6 0H1"/>
              <path d="m18.36 5.64-4.24 4.24m-4.24 4.24-4.24 4.24"/>
              <path d="m5.64 5.64 4.24 4.24m4.24 4.24 4.24 4.24"/>
            </svg>
            <span class="text-white font-medium">音乐源</span>
          </div>
          <svg 
            class="w-5 h-5 text-white/40 transition-transform" 
            :class="{ 'rotate-180': expandedSections.has('sources') }"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          >
            <path d="m6 9 6 6 6-6"/>
          </svg>
        </button>
        <div v-show="expandedSections.has('sources')" class="px-4 pb-4 space-y-4">
          <!-- API 服务选择 -->
          <div>
            <p class="text-white/50 text-xs mb-2">API 服务</p>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="provider in allProviders"
                :key="provider.id"
                @click="selectProvider(provider.id)"
                :class="[
                  'px-3 py-1.5 rounded-full text-sm transition-all',
                  currentProviderId === provider.id 
                    ? 'bg-blue-500 text-white' 
                    : 'bg-white/10 text-white/60 hover:bg-white/15'
                ]"
              >
                {{ provider.name }}
              </button>
            </div>
          </div>
          
          <!-- 音乐平台选择 -->
          <div>
            <p class="text-white/50 text-xs mb-2">音乐平台</p>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="s in allMusicSources.filter(ms => getActiveProvider().supportedPlatforms.includes(ms.value))"
                :key="s.value"
                @click="toggleSource(s.value)"
                :class="[
                  'px-3 py-1.5 rounded-full text-sm transition-all',
                  enabledSources.includes(s.value) 
                    ? 'bg-purple-500 text-white' 
                    : 'bg-white/10 text-white/60 hover:bg-white/15'
                ]"
              >
                {{ s.label }}
              </button>
            </div>
          </div>

          <!-- TuneHub API Key (仅 TuneHub 时显示) -->
          <div v-if="currentProviderId === 'sayqz'" class="pt-2 border-t border-white/10">
            <p class="text-white/50 text-xs mb-2">TuneHub API Key</p>
            <div class="relative">
              <input
                v-model="tuneHubApiKey"
                :type="showTuneHubApiKey ? 'text' : 'password'"
                placeholder="输入 API Key"
                class="w-full h-10 px-3 pr-20 rounded-lg bg-white/10 text-white text-sm placeholder-white/30 outline-none focus:ring-1 focus:ring-purple-500 font-mono"
                @change="saveTuneHubApiKey"
              />
              <button
                @click="showTuneHubApiKey = !showTuneHubApiKey"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/60"
              >
                <svg v-if="showTuneHubApiKey" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
                <svg v-else class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              </button>
            </div>
            <p class="text-white/30 text-xs mt-1">默认 Key 可直接使用，也可替换为自己的 Key</p>
          </div>
        </div>
      </section>

      <!-- 音质 -->
      <section class="bg-white/5 rounded-xl overflow-hidden">
        <button 
          @click="toggleSection('quality')"
          class="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
        >
          <div class="flex items-center gap-3">
            <svg class="w-5 h-5 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18V5l12-2v13"/>
              <circle cx="6" cy="18" r="3"/>
              <circle cx="18" cy="16" r="3"/>
            </svg>
            <span class="text-white font-medium">音质</span>
            <span class="text-white/40 text-sm">{{ qualities.find(q => q.value === defaultQuality)?.label }}</span>
          </div>
          <svg 
            class="w-5 h-5 text-white/40 transition-transform" 
            :class="{ 'rotate-180': expandedSections.has('quality') }"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          >
            <path d="m6 9 6 6 6-6"/>
          </svg>
        </button>
        <div v-show="expandedSections.has('quality')" class="px-4 pb-4">
          <div class="grid grid-cols-4 gap-2">
            <button
              v-for="q in qualities"
              :key="q.value"
              @click="setQuality(q.value)"
              :class="[
                'p-2 rounded-lg text-center transition-all',
                defaultQuality === q.value 
                  ? 'bg-purple-500 text-white' 
                  : 'bg-white/10 text-white/60 hover:bg-white/15'
              ]"
            >
              <div class="text-sm font-medium">{{ q.label }}</div>
              <div class="text-xs opacity-60">{{ q.desc }}</div>
            </button>
          </div>
        </div>
      </section>

      <!-- 音量 -->
      <section class="bg-white/5 rounded-xl p-4">
        <div class="flex items-center gap-3 mb-3">
          <svg class="w-5 h-5 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
          </svg>
          <span class="text-white font-medium">音量</span>
          <span class="text-white/40 text-sm ml-auto">{{ Math.round(store.volume * 100) }}%</span>
        </div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="store.volume"
          @input="store.setVolume(Number(($event.target as HTMLInputElement).value))"
          class="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer
                 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 
                 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-purple-500 
                 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer"
        />
      </section>

      <!-- 均衡器 -->
      <section class="bg-white/5 rounded-xl overflow-hidden">
        <button 
          @click="showEqualizer = true"
          class="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
        >
          <div class="flex items-center gap-3">
            <svg class="w-5 h-5 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="4" y="4" width="4" height="16" rx="1"/>
              <rect x="10" y="8" width="4" height="12" rx="1"/>
              <rect x="16" y="2" width="4" height="20" rx="1"/>
            </svg>
            <span class="text-white font-medium">均衡器</span>
            <span class="text-white/40 text-sm">{{ eqStore.enabled ? '已开启' : '已关闭' }}</span>
          </div>
          <svg class="w-5 h-5 text-white/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="m9 18 6-6-6-6"/>
          </svg>
        </button>
      </section>

      <!-- AI 配置 -->
      <section class="bg-white/5 rounded-xl overflow-hidden">
        <button 
          @click="toggleSection('ai')"
          class="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
        >
          <div class="flex items-center gap-3">
            <svg class="w-5 h-5 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4z"/>
              <path d="M16 14v2a4 4 0 0 1-8 0v-2"/>
              <line x1="12" y1="18" x2="12" y2="22"/>
              <line x1="8" y1="22" x2="16" y2="22"/>
            </svg>
            <span class="text-white font-medium">AI 配置</span>
            <span class="text-white/40 text-sm">{{ currentAIDisplay }}</span>
          </div>
          <svg 
            class="w-5 h-5 text-white/40 transition-transform" 
            :class="{ 'rotate-180': expandedSections.has('ai') }"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          >
            <path d="m6 9 6 6 6-6"/>
          </svg>
        </button>
        <div v-show="expandedSections.has('ai')" class="px-4 pb-4 space-y-3">
          <!-- 内置AI选择 -->
          <div>
            <p class="text-white/50 text-xs mb-2">内置 AI</p>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="ai in BUILTIN_AI_LIST"
                :key="ai.id"
                @click="selectBuiltinAI(ai.id)"
                :class="[
                  'px-4 py-2 rounded-lg text-sm transition-all',
                  aiConfig.provider === 'builtin' && aiConfig.builtinId === ai.id
                    ? 'bg-purple-500 text-white'
                    : 'bg-white/10 text-white/60 hover:bg-white/15'
                ]"
              >
                {{ ai.name }}
              </button>
            </div>
          </div>

          <!-- 自定义AI -->
          <div>
            <p class="text-white/50 text-xs mb-2">自定义 AI</p>
            <button
              @click="switchToCustom"
              :class="[
                'px-4 py-2 rounded-lg text-sm transition-all',
                aiConfig.provider === 'custom'
                  ? 'bg-purple-500 text-white'
                  : 'bg-white/10 text-white/60 hover:bg-white/15'
              ]"
            >
              自定义
            </button>
          </div>

          <!-- 自定义配置（仅在自定义模式下显示） -->
          <template v-if="aiConfig.provider === 'custom'">
            <!-- 服务商选择 -->
            <div>
              <p class="text-white/50 text-xs mb-2">选择服务商</p>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="provider in customProviders"
                  :key="provider.id"
                  @click="selectCustomProvider(provider.id)"
                  :class="[
                    'px-3 py-1.5 rounded-lg text-xs transition-all',
                    selectedCustomProvider === provider.id
                      ? 'bg-blue-500 text-white'
                      : 'bg-white/10 text-white/60 hover:bg-white/15'
                  ]"
                >
                  {{ provider.name }}
                </button>
              </div>
            </div>

            <!-- API Key -->
            <div class="relative">
              <input
                v-model="aiConfig.apiKey"
                :type="showApiKey ? 'text' : 'password'"
                placeholder="API Key"
                class="w-full h-10 px-3 pr-10 rounded-lg bg-white/10 text-white text-sm placeholder-white/30 outline-none focus:ring-1 focus:ring-purple-500"
                @change="saveAI"
              />
              <button
                @click="showApiKey = !showApiKey"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/60"
              >
                <svg v-if="showApiKey" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
                <svg v-else class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              </button>
            </div>

            <!-- API Base URL（通用接口时可编辑，其他预设时显示但不可编辑） -->
            <input
              v-model="aiConfig.baseUrl"
              type="text"
              placeholder="API Base URL"
              :disabled="selectedCustomProvider !== 'custom'"
              :class="[
                'w-full h-10 px-3 rounded-lg text-sm outline-none focus:ring-1 focus:ring-purple-500',
                selectedCustomProvider !== 'custom' 
                  ? 'bg-white/5 text-white/50 cursor-not-allowed' 
                  : 'bg-white/10 text-white placeholder-white/30'
              ]"
              @change="saveAI"
            />
            
            <!-- 模型名称 -->
            <input
              v-model="aiConfig.model"
              type="text"
              placeholder="模型名称"
              class="w-full h-10 px-3 rounded-lg bg-white/10 text-white text-sm placeholder-white/30 outline-none focus:ring-1 focus:ring-purple-500"
              @change="saveAI"
            />
          </template>

          <!-- 测试 -->
          <div class="flex items-center gap-2">
            <button
              @click="testAIConnection"
              :disabled="aiTestStatus === 'testing'"
              class="px-4 py-2 rounded-lg bg-purple-500 hover:bg-purple-400 text-white text-sm disabled:opacity-50 transition-colors"
            >
              {{ aiTestStatus === 'testing' ? '测试中...' : '测试连接' }}
            </button>
            <span
              v-if="aiTestMessage"
              :class="aiTestStatus === 'success' ? 'text-green-400' : 'text-red-400'"
              class="text-sm"
            >
              {{ aiTestMessage }}
            </span>
          </div>
        </div>
      </section>

      <!-- 缓存 -->
      <section class="bg-white/5 rounded-xl overflow-hidden">
        <button 
          @click="toggleSection('cache')"
          class="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
        >
          <div class="flex items-center gap-3">
            <svg class="w-5 h-5 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
              <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
              <line x1="12" y1="22.08" x2="12" y2="12"/>
            </svg>
            <span class="text-white font-medium">缓存</span>
            <span class="text-white/40 text-sm">{{ cacheStats.count }} 首 · {{ formatSize(cacheStats.totalSize) }}</span>
          </div>
          <svg 
            class="w-5 h-5 text-white/40 transition-transform" 
            :class="{ 'rotate-180': expandedSections.has('cache') }"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          >
            <path d="m6 9 6 6 6-6"/>
          </svg>
        </button>
        <div v-show="expandedSections.has('cache')" class="px-4 pb-4 space-y-3">
          <!-- 离线模式开关 -->
          <div class="flex items-center justify-between py-2">
            <div>
              <p class="text-white text-sm">离线模式</p>
              <p class="text-white/40 text-xs">只播放已缓存的歌曲</p>
            </div>
            <button
              @click="offlineStore.toggleOfflineMode()"
              :class="[
                'relative w-12 h-6 rounded-full transition-colors',
                offlineStore.isOfflineMode ? 'bg-purple-500' : 'bg-white/20'
              ]"
            >
              <span
                :class="[
                  'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform',
                  offlineStore.isOfflineMode ? 'left-7' : 'left-1'
                ]"
              ></span>
            </button>
          </div>

          <!-- 缓存大小限制 -->
          <div>
            <p class="text-white text-sm mb-2">缓存大小上限</p>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="opt in cacheSizeOptions"
                :key="opt.value"
                @click="setCacheSize(opt.value)"
                :class="[
                  'px-3 py-1.5 rounded-lg text-xs transition-all',
                  maxCacheSizeMB === opt.value
                    ? 'bg-purple-500 text-white'
                    : 'bg-white/10 text-white/60 hover:bg-white/15'
                ]"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>

          <!-- 网络状态 -->
          <div class="flex items-center gap-2 text-sm">
            <span 
              class="w-2 h-2 rounded-full"
              :class="offlineStore.isOnline ? 'bg-green-400' : 'bg-orange-400'"
            ></span>
            <span class="text-white/50">
              {{ offlineStore.isOnline ? '网络已连接' : '网络已断开' }}
            </span>
          </div>

          <button
            @click="clearCache"
            :disabled="cacheLoading || cacheStats.count === 0"
            class="w-full py-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 text-sm disabled:opacity-50 transition-colors"
          >
            {{ cacheLoading ? '清理中...' : '清空缓存' }}
          </button>
        </div>
      </section>

      <!-- 下载设置 -->
      <section class="bg-white/5 rounded-xl overflow-hidden">
        <button 
          @click="toggleSection('download')"
          class="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
        >
          <div class="flex items-center gap-3">
            <svg class="w-5 h-5 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            <span class="text-white font-medium">下载设置</span>
          </div>
          <svg 
            class="w-5 h-5 text-white/40 transition-transform" 
            :class="{ 'rotate-180': expandedSections.has('download') }"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          >
            <path d="m6 9 6 6 6-6"/>
          </svg>
        </button>
        <div v-show="expandedSections.has('download')" class="px-4 pb-4 space-y-4">
          <!-- 存储位置 -->
          <div>
            <p class="text-white text-sm mb-2">存储位置</p>
            <div class="p-3 rounded-lg bg-white/5 text-white/60 text-sm">
              <p class="flex items-center gap-2">
                <svg class="w-4 h-4 text-purple-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                <span class="break-all">{{ downloadPath }}</span>
              </p>
            </div>
          </div>

          <!-- 文件夹名称 -->
          <div>
            <p class="text-white text-sm mb-2">文件夹名称</p>
            <input
              v-model="downloadSettings.folderName"
              @change="updateDownloadSettings"
              type="text"
              placeholder="灵听音乐"
              class="w-full h-10 px-3 rounded-lg bg-white/10 text-white text-sm placeholder-white/30 outline-none focus:ring-1 focus:ring-purple-500"
            />
          </div>

          <!-- 文件命名格式 -->
          <div>
            <p class="text-white text-sm mb-2">文件命名格式</p>
            <div class="grid grid-cols-3 gap-2">
              <button
                v-for="format in fileNameFormats"
                :key="format.value"
                @click="downloadSettings.fileNameFormat = format.value; updateDownloadSettings()"
                :class="[
                  'py-2 px-2 rounded-lg text-xs transition-all text-center',
                  downloadSettings.fileNameFormat === format.value 
                    ? 'bg-purple-500 text-white' 
                    : 'bg-white/10 text-white/60 hover:bg-white/15'
                ]"
              >
                {{ format.label }}
              </button>
            </div>
          </div>

          <!-- 自动缓存开关 -->
          <div class="flex items-center justify-between py-2">
            <div>
              <p class="text-white text-sm">下载后自动缓存</p>
              <p class="text-white/40 text-xs">下载的歌曲同时保存到缓存</p>
            </div>
            <button
              @click="downloadSettings.autoCache = !downloadSettings.autoCache; updateDownloadSettings()"
              :class="[
                'relative w-12 h-6 rounded-full transition-colors',
                downloadSettings.autoCache ? 'bg-purple-500' : 'bg-white/20'
              ]"
            >
              <span
                :class="[
                  'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform',
                  downloadSettings.autoCache ? 'left-7' : 'left-1'
                ]"
              ></span>
            </button>
          </div>
        </div>
      </section>

      <!-- 运行日志 -->
      <section class="bg-white/5 rounded-xl overflow-hidden">
        <button 
          @click="toggleSection('logs')"
          class="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
        >
          <div class="flex items-center gap-3">
            <svg class="w-5 h-5 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
            <span class="text-white font-medium">运行日志</span>
            <span class="text-white/40 text-sm">{{ logEnabled ? `${logCount} 条` : '已关闭' }}</span>
          </div>
          <svg 
            class="w-5 h-5 text-white/40 transition-transform" 
            :class="{ 'rotate-180': expandedSections.has('logs') }"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          >
            <path d="m6 9 6 6 6-6"/>
          </svg>
        </button>
        <div v-show="expandedSections.has('logs')" class="px-4 pb-4 space-y-3">
          <!-- 日志开关 -->
          <div class="flex items-center justify-between py-2">
            <div>
              <p class="text-white text-sm">启用日志记录</p>
              <p class="text-white/40 text-xs">记录播放器关键事件，用于调试</p>
            </div>
            <button
              @click="toggleLogEnabled"
              :class="[
                'relative w-12 h-6 rounded-full transition-colors',
                logEnabled ? 'bg-purple-500' : 'bg-white/20'
              ]"
            >
              <span
                :class="[
                  'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform',
                  logEnabled ? 'left-7' : 'left-1'
                ]"
              ></span>
            </button>
          </div>

          <!-- 查看日志按钮 -->
          <button
            @click="openLogViewer"
            class="w-full py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 text-sm text-left px-3 transition-colors flex items-center gap-2"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            查看日志
          </button>
        </div>
      </section>

      <!-- 数据管理 -->
      <section class="bg-white/5 rounded-xl overflow-hidden">
        <button 
          @click="toggleSection('data')"
          class="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
        >
          <div class="flex items-center gap-3">
            <svg class="w-5 h-5 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
            <span class="text-white font-medium">数据管理</span>
          </div>
          <svg 
            class="w-5 h-5 text-white/40 transition-transform" 
            :class="{ 'rotate-180': expandedSections.has('data') }"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          >
            <path d="m6 9 6 6 6-6"/>
          </svg>
        </button>
        <div v-show="expandedSections.has('data')" class="px-4 pb-4 space-y-2">
          <button
            @click="clearPlaylist"
            class="w-full py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 text-sm text-left px-3 transition-colors flex items-center gap-2"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15V6"/>
              <path d="M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"/>
              <path d="M12 12H3"/>
              <path d="M16 6H3"/>
              <path d="M12 18H3"/>
            </svg>
            清空播放列表
          </button>
          <button
            @click="clearFavorites"
            class="w-full py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 text-sm text-left px-3 transition-colors flex items-center gap-2"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
            清空收藏
          </button>
          <button
            @click="clearWebDAV"
            class="w-full py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 text-sm text-left px-3 transition-colors flex items-center gap-2"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            清除 WebDAV 配置
          </button>
          <button
            @click="clearAIConfig"
            class="w-full py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 text-sm text-left px-3 transition-colors flex items-center gap-2"
          >
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
              <path d="M3 3v5h5"/>
            </svg>
            重置 AI 配置
          </button>
        </div>
      </section>

      <!-- 关于 -->
      <section class="text-center py-4 text-white/30 text-xs">
        <p>灵听音乐 v0.2.0</p>
      </section>
    </div>
  </div>

  <!-- 均衡器全屏覆盖层 -->
  <Teleport to="body">
    <Transition name="eq-slide">
      <div 
        v-if="showEqualizer"
        class="fixed inset-0 z-[100] bg-black"
      >
        <EqualizerView @close="showEqualizer = false" />
      </div>
    </Transition>
  </Teleport>

  <!-- 日志查看器全屏覆盖层 -->
  <Teleport to="body">
    <Transition name="log-slide">
      <div 
        v-if="showLogViewer"
        class="fixed inset-0 z-[100] bg-black"
      >
        <LogViewer @close="showLogViewer = false" />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 均衡器滑入动画 */
.eq-slide-enter-active,
.eq-slide-leave-active {
  transition: transform 0.3s ease;
}
.eq-slide-enter-from {
  transform: translateX(100%);
}
.eq-slide-leave-to {
  transform: translateX(100%);
}

/* 日志查看器滑入动画 */
.log-slide-enter-active,
.log-slide-leave-active {
  transition: transform 0.3s ease;
}
.log-slide-enter-from {
  transform: translateX(100%);
}
.log-slide-leave-to {
  transform: translateX(100%);
}
</style>
