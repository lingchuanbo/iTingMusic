<script setup lang="ts">
import { ref } from 'vue'
import { usePlayerStore } from '@/store/player'
import { connectWebDAV, scanWebDAV, isConnected } from '@/services/source/WebDAVSource'

const store = usePlayerStore()
const config = ref({
  url: '',
  username: '',
  password: ''
})
const connected = ref(false)
const loading = ref(false)
const scanning = ref(false)
const currentPath = ref('/')
const error = ref('')

async function handleConnect() {
  if (!config.value.url) {
    error.value = '请输入 WebDAV 地址'
    return
  }
  loading.value = true
  error.value = ''
  try {
    connectWebDAV(config.value)
    // 测试连接
    await scanWebDAV('/')
    connected.value = true
    localStorage.setItem('webdav_config', JSON.stringify(config.value))
  } catch (e) {
    error.value = '连接失败，请检查配置'
    connected.value = false
  } finally {
    loading.value = false
  }
}

async function scanFolder(path: string = '/') {
  scanning.value = true
  currentPath.value = path
  try {
    const tracks = await scanWebDAV(path)
    tracks.forEach(t => store.addTrack(t))
  } catch (e) {
    error.value = '扫描失败'
  } finally {
    scanning.value = false
  }
}

// 尝试恢复保存的配置
const saved = localStorage.getItem('webdav_config')
if (saved) {
  try {
    config.value = JSON.parse(saved)
  } catch {}
}
</script>

<template>
  <div class="flex-1 overflow-y-auto p-6">
    <h2 class="text-2xl font-bold text-white mb-6">☁️ WebDAV 云盘</h2>

    <!-- 未连接：显示配置表单 -->
    <div v-if="!connected" class="max-w-md">
      <div class="space-y-4">
        <div>
          <label class="block text-white/60 text-sm mb-1">WebDAV 地址</label>
          <input
            v-model="config.url"
            type="text"
            placeholder="https://your-webdav-server.com/dav"
            class="w-full h-10 px-3 rounded-lg bg-white/10 text-white placeholder-white/30 outline-none focus:bg-white/15"
          />
        </div>
        <div>
          <label class="block text-white/60 text-sm mb-1">用户名</label>
          <input
            v-model="config.username"
            type="text"
            placeholder="username"
            class="w-full h-10 px-3 rounded-lg bg-white/10 text-white placeholder-white/30 outline-none focus:bg-white/15"
          />
        </div>
        <div>
          <label class="block text-white/60 text-sm mb-1">密码</label>
          <input
            v-model="config.password"
            type="password"
            placeholder="password"
            class="w-full h-10 px-3 rounded-lg bg-white/10 text-white placeholder-white/30 outline-none focus:bg-white/15"
          />
        </div>

        <div v-if="error" class="text-red-400 text-sm">{{ error }}</div>

        <button
          @click="handleConnect"
          :disabled="loading"
          class="w-full h-10 rounded-lg bg-purple-600 hover:bg-purple-500 text-white transition-colors disabled:opacity-50"
        >
          {{ loading ? '连接中...' : '连接' }}
        </button>
      </div>

      <div class="mt-6 text-white/40 text-sm">
        <p>支持的 WebDAV 服务：</p>
        <ul class="list-disc list-inside mt-2 space-y-1">
          <li>坚果云</li>
          <li>Nextcloud / ownCloud</li>
          <li>群晖 NAS</li>
          <li>其他标准 WebDAV 服务</li>
        </ul>
      </div>
    </div>

    <!-- 已连接：显示操作界面 -->
    <div v-else>
      <div class="flex items-center gap-4 mb-6">
        <span class="text-green-400">✓ 已连接</span>
        <span class="text-white/50 text-sm">{{ config.url }}</span>
        <button
          @click="connected = false"
          class="text-white/50 text-sm hover:text-white"
        >
          断开
        </button>
      </div>

      <div class="flex gap-3">
        <button
          @click="scanFolder('/')"
          :disabled="scanning"
          class="px-4 py-2 rounded-lg bg-white/10 text-white hover:bg-white/20 disabled:opacity-50"
        >
          {{ scanning ? '扫描中...' : '扫描根目录' }}
        </button>
        <button
          @click="scanFolder('/Music')"
          :disabled="scanning"
          class="px-4 py-2 rounded-lg bg-white/10 text-white hover:bg-white/20 disabled:opacity-50"
        >
          扫描 /Music
        </button>
      </div>

      <p class="mt-4 text-white/40 text-sm">
        扫描到的音乐会自动添加到播放列表
      </p>
    </div>
  </div>
</template>
