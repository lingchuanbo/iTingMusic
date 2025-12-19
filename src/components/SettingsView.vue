<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { usePlayerStore } from '@/store/player'
import type { AudioQuality } from '@/services/source/OnlineApiSource'
import {
  loadAIConfig,
  saveAIConfig,
  getDefaultConfig,
  type AIConfig
} from '@/services/ai/AIService'
import { audioCache } from '@/services/cache/AudioCache'

const store = usePlayerStore()

// 缓存统计
const cacheStats = ref({ count: 0, totalSize: 0 })
const cacheLoading = ref(false)

async function loadCacheStats() {
  cacheStats.value = await audioCache.getStats()
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

async function clearCache() {
  if (!confirm('确定清空所有缓存（音频、封面、歌词）？')) return
  cacheLoading.value = true
  await audioCache.clearAll()
  await loadCacheStats()
  cacheLoading.value = false
}

onMounted(loadCacheStats)

// 音质设置
const defaultQuality = ref<AudioQuality>(
  (localStorage.getItem('defaultQuality') as AudioQuality) || '320k'
)

const qualities: { value: AudioQuality; label: string; desc: string }[] = [
  { value: '128k', label: '标准音质', desc: '128kbps，节省流量' },
  { value: '320k', label: '高品质', desc: '320kbps，推荐' },
  { value: 'flac', label: '无损音质', desc: '~1000kbps' },
  { value: 'flac24bit', label: 'Hi-Res', desc: '~1400kbps，发烧级' }
]

// AI 配置
const aiConfig = ref<AIConfig>(loadAIConfig())
const showApiKey = ref(false)
const aiTestStatus = ref<'idle' | 'testing' | 'success' | 'error'>('idle')
const aiTestMessage = ref('')

const aiProviders = [
  { value: 'openai', label: 'OpenAI', desc: 'GPT-3.5/4' },
  { value: 'deepseek', label: 'DeepSeek', desc: '国产大模型，性价比高' },
  { value: 'custom', label: '自定义', desc: '其他兼容 OpenAI 格式的 API' }
]

// 切换 AI 提供商时更新默认配置
watch(() => aiConfig.value.provider, (provider) => {
  const defaults = getDefaultConfig(provider)
  if (provider !== 'custom') {
    aiConfig.value.baseUrl = defaults.baseUrl || ''
    aiConfig.value.model = defaults.model || ''
  }
})

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
    const response = await fetch(`${aiConfig.value.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aiConfig.value.apiKey}`
      },
      body: JSON.stringify({
        model: aiConfig.value.model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 10
      })
    })

    if (response.ok) {
      aiTestStatus.value = 'success'
      aiTestMessage.value = '连接成功！'
      saveAI()
    } else {
      const error = await response.text()
      aiTestStatus.value = 'error'
      aiTestMessage.value = `连接失败: ${response.status}`
      console.error(error)
    }
  } catch (e: any) {
    aiTestStatus.value = 'error'
    aiTestMessage.value = `连接失败: ${e.message}`
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
  localStorage.removeItem('zen_ai_config')
  aiConfig.value = loadAIConfig()
  alert('已清除 AI 配置')
}
</script>

<template>
  <div class="flex-1 overflow-y-auto p-6">
    <h2 class="text-2xl font-bold text-white mb-6">⚙️ 设置</h2>

    <div class="max-w-lg space-y-8">
      <!-- AI 配置 -->
      <section>
        <h3 class="text-white/80 font-medium mb-3 flex items-center gap-2">
          🤖 AI 选歌配置
          <span class="text-xs text-white/40 font-normal">用于智能推荐歌曲</span>
        </h3>

        <!-- 提供商选择 -->
        <div class="space-y-3">
          <div>
            <label class="block text-white/60 text-sm mb-1">AI 服务商</label>
            <div class="flex gap-2">
              <button
                v-for="p in aiProviders"
                :key="p.value"
                @click="aiConfig.provider = p.value as AIConfig['provider']"
                :class="[
                  'flex-1 p-2 rounded-lg text-sm transition-colors',
                  aiConfig.provider === p.value
                    ? 'bg-purple-600 text-white'
                    : 'bg-white/5 text-white/70 hover:bg-white/10'
                ]"
              >
                {{ p.label }}
              </button>
            </div>
            <p class="text-white/40 text-xs mt-1">
              {{ aiProviders.find(p => p.value === aiConfig.provider)?.desc }}
            </p>
          </div>

          <!-- API Key -->
          <div>
            <label class="block text-white/60 text-sm mb-1">API Key</label>
            <div class="relative">
              <input
                v-model="aiConfig.apiKey"
                :type="showApiKey ? 'text' : 'password'"
                placeholder="sk-..."
                class="w-full h-10 px-3 pr-10 rounded-lg bg-white/10 text-white placeholder-white/30 outline-none focus:bg-white/15"
                @change="saveAI"
              />
              <button
                @click="showApiKey = !showApiKey"
                class="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/60"
              >
                {{ showApiKey ? '🙈' : '👁️' }}
              </button>
            </div>
          </div>

          <!-- Base URL (自定义时显示) -->
          <div v-if="aiConfig.provider === 'custom'">
            <label class="block text-white/60 text-sm mb-1">API Base URL</label>
            <input
              v-model="aiConfig.baseUrl"
              type="text"
              placeholder="https://api.example.com/v1"
              class="w-full h-10 px-3 rounded-lg bg-white/10 text-white placeholder-white/30 outline-none focus:bg-white/15"
              @change="saveAI"
            />
          </div>

          <!-- Model -->
          <div v-if="aiConfig.provider === 'custom'">
            <label class="block text-white/60 text-sm mb-1">模型名称</label>
            <input
              v-model="aiConfig.model"
              type="text"
              placeholder="gpt-3.5-turbo"
              class="w-full h-10 px-3 rounded-lg bg-white/10 text-white placeholder-white/30 outline-none focus:bg-white/15"
              @change="saveAI"
            />
          </div>

          <!-- 测试连接 -->
          <div class="flex items-center gap-3">
            <button
              @click="testAIConnection"
              :disabled="aiTestStatus === 'testing'"
              class="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-sm disabled:opacity-50"
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

          <!-- 提示 -->
          <div class="p-3 rounded-lg bg-white/5 text-white/50 text-xs space-y-1">
            <p>💡 如何获取 API Key：</p>
            <p>• OpenAI: <a href="https://platform.openai.com/api-keys" target="_blank" class="text-purple-400 hover:underline">platform.openai.com</a></p>
            <p>• DeepSeek: <a href="https://platform.deepseek.com/api_keys" target="_blank" class="text-purple-400 hover:underline">platform.deepseek.com</a></p>
          </div>
        </div>
      </section>

      <!-- 音质设置 -->
      <section>
        <h3 class="text-white/80 font-medium mb-3">🎵 默认音质</h3>
        <div class="space-y-2">
          <button
            v-for="q in qualities"
            :key="q.value"
            @click="setQuality(q.value)"
            :class="[
              'w-full flex items-center justify-between p-3 rounded-lg transition-colors',
              defaultQuality === q.value ? 'bg-purple-600/50' : 'bg-white/5 hover:bg-white/10'
            ]"
          >
            <div>
              <p class="text-white">{{ q.label }}</p>
              <p class="text-white/50 text-sm">{{ q.desc }}</p>
            </div>
            <span v-if="defaultQuality === q.value" class="text-green-400">✓</span>
          </button>
        </div>
      </section>

      <!-- 音量 -->
      <section>
        <h3 class="text-white/80 font-medium mb-3">🔊 音量 {{ Math.round(store.volume * 100) }}%</h3>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="store.volume"
          @input="store.setVolume(Number(($event.target as HTMLInputElement).value))"
          class="w-full accent-purple-500"
        />
      </section>

      <!-- 音频缓存 -->
      <section>
        <h3 class="text-white/80 font-medium mb-3">💾 音频缓存</h3>
        <div class="p-4 rounded-lg bg-white/5 space-y-3">
          <div class="flex justify-between text-white/70">
            <span>已缓存歌曲</span>
            <span>{{ cacheStats.count }} 首</span>
          </div>
          <div class="flex justify-between text-white/70">
            <span>占用空间</span>
            <span>{{ formatSize(cacheStats.totalSize) }}</span>
          </div>
          <p class="text-white/40 text-xs">
            播放过的在线歌曲会自动缓存，下次播放无需联网
          </p>
          <button
            @click="clearCache"
            :disabled="cacheLoading || cacheStats.count === 0"
            class="w-full p-2 rounded-lg bg-red-600/30 hover:bg-red-600/50 text-red-300 text-sm disabled:opacity-50"
          >
            {{ cacheLoading ? '清理中...' : '清空缓存' }}
          </button>
        </div>
      </section>

      <!-- 数据管理 -->
      <section>
        <h3 class="text-white/80 font-medium mb-3">🗑️ 数据管理</h3>
        <div class="space-y-2">
          <button
            @click="clearPlaylist"
            class="w-full p-3 rounded-lg bg-white/5 hover:bg-white/10 text-left text-white/70"
          >
            清空播放列表
          </button>
          <button
            @click="clearFavorites"
            class="w-full p-3 rounded-lg bg-white/5 hover:bg-white/10 text-left text-white/70"
          >
            清空收藏
          </button>
          <button
            @click="clearWebDAV"
            class="w-full p-3 rounded-lg bg-white/5 hover:bg-white/10 text-left text-white/70"
          >
            清除 WebDAV 配置
          </button>
          <button
            @click="clearAIConfig"
            class="w-full p-3 rounded-lg bg-white/5 hover:bg-white/10 text-left text-white/70"
          >
            清除 AI 配置
          </button>
        </div>
      </section>

      <!-- 关于 -->
      <section class="text-white/40 text-sm">
        <p>Zen Player v0.1.0</p>
        <p>Vue 3 + Tailwind CSS + Howler.js</p>
      </section>
    </div>
  </div>
</template>
