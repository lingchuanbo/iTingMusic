<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Capacitor } from '@capacitor/core'
import { useEqualizerStore } from '@/store/equalizer'
import { BAND_LABELS, type EQBand } from '@/services/player/EqualizerService'
import { nativeAudioPlayer } from '@/services/player/NativeAudioPlayer'

const emit = defineEmits<{
  (e: 'close'): void
}>()

const eqStore = useEqualizerStore()

// 检测是否是 Android 平台 - 现在支持原生均衡器
const isAndroid = computed(() => Capacitor.isNativePlatform())

// 保存预设对话框
const showSaveDialog = ref(false)
const presetName = ref('')

// 低音增强和环绕声强度 (0-100)
const bassBoost = ref(0)
const virtualizer = ref(0)

// 初始化
onMounted(async () => {
  await eqStore.init()
  // Android 上启用原生均衡器
  if (isAndroid.value && eqStore.enabled) {
    await nativeAudioPlayer.setEqualizerEnabled(true)
  }
})



// 旋钮控制相关
const knobStartY = ref(0)
const knobStartValue = ref(0)
const activeKnob = ref<'bass' | 'virt' | null>(null)

function startBassKnob(e: TouchEvent) {
  knobStartY.value = e.touches[0].clientY
  knobStartValue.value = bassBoost.value
  activeKnob.value = 'bass'
}

function startVirtKnob(e: TouchEvent) {
  knobStartY.value = e.touches[0].clientY
  knobStartValue.value = virtualizer.value
  activeKnob.value = 'virt'
}

async function moveBassKnob(e: TouchEvent) {
  if (activeKnob.value !== 'bass') return
  const deltaY = knobStartY.value - e.touches[0].clientY
  const newValue = Math.max(0, Math.min(100, knobStartValue.value + Math.round(deltaY / 1.5)))
  bassBoost.value = newValue
  if (isAndroid.value) {
    await nativeAudioPlayer.setBassBoost(newValue)
  }
}

async function moveVirtKnob(e: TouchEvent) {
  if (activeKnob.value !== 'virt') return
  const deltaY = knobStartY.value - e.touches[0].clientY
  const newValue = Math.max(0, Math.min(100, knobStartValue.value + Math.round(deltaY / 1.5)))
  virtualizer.value = newValue
  if (isAndroid.value) {
    await nativeAudioPlayer.setVirtualizer(newValue)
  }
}

function endKnob() {
  activeKnob.value = null
}

// 鼠标事件支持（用于桌面调试）
function startBassKnobMouse(e: MouseEvent) {
  knobStartY.value = e.clientY
  knobStartValue.value = bassBoost.value
  activeKnob.value = 'bass'
  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)
}

function startVirtKnobMouse(e: MouseEvent) {
  knobStartY.value = e.clientY
  knobStartValue.value = virtualizer.value
  activeKnob.value = 'virt'
  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)
}

async function handleMouseMove(e: MouseEvent) {
  const deltaY = knobStartY.value - e.clientY
  const newValue = Math.max(0, Math.min(100, knobStartValue.value + Math.round(deltaY / 1.5)))
  if (activeKnob.value === 'bass') {
    bassBoost.value = newValue
    if (isAndroid.value) {
      await nativeAudioPlayer.setBassBoost(newValue)
    }
  } else if (activeKnob.value === 'virt') {
    virtualizer.value = newValue
    if (isAndroid.value) {
      await nativeAudioPlayer.setVirtualizer(newValue)
    }
  }
}

function handleMouseUp() {
  activeKnob.value = null
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
}

// 当前预设名称
const currentPresetName = computed(() => {
  if (eqStore.currentPresetId === 'custom') return '自定义'
  const preset = eqStore.getAllPresets().find(p => p.id === eqStore.currentPresetId)
  return preset?.name || '默认'
})

// 滑块拖动处理
async function handleSliderInput(index: number, event: Event) {
  const target = event.target as HTMLInputElement
  const value = parseFloat(target.value)
  eqStore.setGain(index, value)
  // Android 上同步到原生均衡器
  if (isAndroid.value) {
    // 转换 -12~+12 dB 到原生 API 的 mB 范围
    await nativeAudioPlayer.setEqualizerBand(index, Math.round(value * 100))
  }
}

// 开关切换处理
async function handleToggle() {
  eqStore.toggle()
  // Android 上同步到原生均衡器
  if (isAndroid.value) {
    await nativeAudioPlayer.setEqualizerEnabled(eqStore.enabled)
  }
}

// 保存自定义预设
function savePreset() {
  if (presetName.value.trim()) {
    eqStore.saveAsPreset(presetName.value.trim())
    presetName.value = ''
    showSaveDialog.value = false
  }
}

// 应用预设并同步到原生均衡器
async function applyPresetWithNative(presetId: string) {
  eqStore.applyPreset(presetId)
  // Android 上同步所有频段到原生均衡器
  if (isAndroid.value) {
    for (let i = 0; i < eqStore.gains.length; i++) {
      await nativeAudioPlayer.setEqualizerBand(i, Math.round(eqStore.gains[i] * 100))
    }
  }
}

// 重置并同步到原生均衡器
async function resetWithNative() {
  eqStore.reset()
  // Android 上重置所有频段
  if (isAndroid.value) {
    for (let i = 0; i < eqStore.gains.length; i++) {
      await nativeAudioPlayer.setEqualizerBand(i, 0)
    }
  }
}

// 返回上一页
function goBack() {
  emit('close')
}

// 获取频段标签
function getBandLabel(freq: number): string {
  return BAND_LABELS[freq as EQBand] || freq.toString()
}

// 计算曲线路径
const curvePath = computed(() => {
  const gains = eqStore.gains
  const width = 300
  const height = 80
  const padding = 15
  const usableWidth = width - padding * 2
  const usableHeight = height - padding * 2
  const centerY = height / 2

  if (gains.length === 0) return ''

  const points = gains.map((gain, i) => {
    const x = padding + (i / (gains.length - 1)) * usableWidth
    const y = centerY - (gain / 12) * (usableHeight / 2)
    return { x, y }
  })

  // 生成平滑曲线
  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const curr = points[i]
    const cpx = (prev.x + curr.x) / 2
    d += ` Q ${cpx} ${prev.y} ${cpx} ${(prev.y + curr.y) / 2}`
    d += ` Q ${cpx} ${curr.y} ${curr.x} ${curr.y}`
  }

  return d
})

// 填充曲线路径
const fillPath = computed(() => {
  if (!curvePath.value) return ''
  return curvePath.value + ' L 285 80 L 15 80 Z'
})
</script>

<template>
  <div class="flex-1 flex flex-col bg-black min-h-screen text-white">
    <!-- 简洁头部 -->
    <header class="flex items-center px-4 py-3">
      <button @click="goBack" class="w-9 h-9 -ml-1 rounded-full flex items-center justify-center text-white/60 hover:text-white active:bg-white/10 transition-all">
        <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="m15 18-6-6 6-6"/>
        </svg>
      </button>
      <h1 class="flex-1 text-center text-base font-medium pr-9">均衡器</h1>
    </header>

    <!-- 开关区域 -->
    <div class="flex items-center justify-between px-5 py-3 border-b border-white/5">
      <span class="text-sm text-white/60">音效增强</span>
      <button 
        @click="handleToggle"
        :class="[
          'relative w-12 h-6 rounded-full transition-all duration-200',
          eqStore.enabled 
            ? 'bg-purple-500' 
            : 'bg-white/15'
        ]"
      >
        <span 
          :class="[
            'absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all duration-200',
            eqStore.enabled ? 'left-6' : 'left-0.5'
          ]"
        />
      </button>
    </div>

    <!-- 低音增强和环绕声控件 -->
    <div class="mx-4 mt-4 mb-2">
      <div class="flex items-center justify-center gap-8">
        <!-- 低音增强旋钮 -->
        <div class="flex flex-col items-center">
          <div 
            class="knob-container relative w-20 h-20 rounded-full flex items-center justify-center cursor-pointer select-none"
            @touchstart.prevent="startBassKnob"
            @touchmove.prevent="moveBassKnob"
            @touchend="endKnob"
            @mousedown.prevent="startBassKnobMouse"
          >
            <!-- 背景圆环 -->
            <svg class="absolute w-full h-full -rotate-90" viewBox="0 0 80 80">
              <circle 
                cx="40" cy="40" r="34" 
                fill="none" 
                stroke="rgba(255,255,255,0.08)" 
                stroke-width="6"
              />
              <circle 
                cx="40" cy="40" r="34" 
                fill="none" 
                stroke="url(#bassGradient)" 
                stroke-width="6"
                stroke-linecap="round"
                :stroke-dasharray="`${bassBoost * 2.136} 213.6`"
              />
              <defs>
                <linearGradient id="bassGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stop-color="#a855f7"/>
                  <stop offset="100%" stop-color="#ec4899"/>
                </linearGradient>
              </defs>
            </svg>
            <!-- 内圆和数值 -->
            <div class="relative w-14 h-14 rounded-full bg-white/5 backdrop-blur flex flex-col items-center justify-center shadow-lg border border-white/10">
              <span class="text-lg font-bold text-white">{{ bassBoost }}</span>
              <span class="text-[8px] text-white/40 -mt-0.5">%</span>
            </div>
          </div>
          <div class="mt-2 flex items-center gap-1.5">
            <svg class="w-4 h-4 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 18V5l12-2v13"/>
              <circle cx="6" cy="18" r="3"/>
              <circle cx="18" cy="16" r="3"/>
            </svg>
            <span class="text-xs text-white/60">低音增强</span>
          </div>
        </div>

        <!-- 环绕声旋钮 -->
        <div class="flex flex-col items-center">
          <div 
            class="knob-container relative w-20 h-20 rounded-full flex items-center justify-center cursor-pointer select-none"
            @touchstart.prevent="startVirtKnob"
            @touchmove.prevent="moveVirtKnob"
            @touchend="endKnob"
            @mousedown.prevent="startVirtKnobMouse"
          >
            <!-- 背景圆环 -->
            <svg class="absolute w-full h-full -rotate-90" viewBox="0 0 80 80">
              <circle 
                cx="40" cy="40" r="34" 
                fill="none" 
                stroke="rgba(255,255,255,0.08)" 
                stroke-width="6"
              />
              <circle 
                cx="40" cy="40" r="34" 
                fill="none" 
                stroke="url(#virtGradient)" 
                stroke-width="6"
                stroke-linecap="round"
                :stroke-dasharray="`${virtualizer * 2.136} 213.6`"
              />
              <defs>
                <linearGradient id="virtGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stop-color="#22d3ee"/>
                  <stop offset="100%" stop-color="#06b6d4"/>
                </linearGradient>
              </defs>
            </svg>
            <!-- 内圆和数值 -->
            <div class="relative w-14 h-14 rounded-full bg-white/5 backdrop-blur flex flex-col items-center justify-center shadow-lg border border-white/10">
              <span class="text-lg font-bold text-white">{{ virtualizer }}</span>
              <span class="text-[8px] text-white/40 -mt-0.5">%</span>
            </div>
          </div>
          <div class="mt-2 flex items-center gap-1.5">
            <svg class="w-4 h-4 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 5L6 9H2v6h4l5 4V5z"/>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
            </svg>
            <span class="text-xs text-white/60">环绕声</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 主内容 -->
    <div class="flex-1 flex flex-col px-4 pt-4 pb-6 overflow-hidden">
      <!-- 频率响应曲线 -->
      <div class="bg-white/5 rounded-xl p-3 mb-4">
        <svg viewBox="0 0 300 80" class="w-full h-16">
          <!-- 中线 -->
          <line x1="15" y1="40" x2="285" y2="40" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
          
          <!-- 填充 -->
          <path 
            :d="fillPath" 
            fill="url(#eqFillGradient)"
            opacity="0.4"
          />
          
          <!-- 曲线 -->
          <path 
            :d="curvePath" 
            fill="none" 
            stroke="url(#eqCurveGradient)" 
            stroke-width="2"
            stroke-linecap="round"
          />
          
          <defs>
            <linearGradient id="eqCurveGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stop-color="#a855f7"/>
              <stop offset="100%" stop-color="#ec4899"/>
            </linearGradient>
            <linearGradient id="eqFillGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stop-color="#a855f7" stop-opacity="0.4"/>
              <stop offset="100%" stop-color="#a855f7" stop-opacity="0"/>
            </linearGradient>
          </defs>
        </svg>
        <div class="flex justify-between text-[10px] text-white/30 mt-1 px-1">
          <span>低频</span>
          <span class="text-purple-400">{{ currentPresetName }}</span>
          <span>高频</span>
        </div>
      </div>

      <!-- 滑块 -->
      <div class="flex-1 flex items-stretch gap-0 mb-4 min-h-[140px]">
        <div 
          v-for="(freq, index) in eqStore.bands" 
          :key="freq"
          class="flex-1 flex flex-col items-center"
        >
          <!-- 增益值 -->
          <div class="text-[10px] font-medium mb-1 h-4 flex items-center"
               :class="eqStore.gains[index] > 0 ? 'text-pink-400' : eqStore.gains[index] < 0 ? 'text-cyan-400' : 'text-white/30'">
            {{ eqStore.gains[index] > 0 ? '+' : '' }}{{ eqStore.gains[index].toFixed(0) }}
          </div>
          
          <!-- 滑块 -->
          <div class="flex-1 relative flex items-center justify-center w-full">
            <div class="absolute w-0.5 h-full bg-white/10 rounded-full"/>
            
            <div 
              class="absolute w-0.5 rounded-full"
              :class="eqStore.gains[index] >= 0 ? 'bg-purple-500' : 'bg-cyan-500'"
              :style="{
                height: `${Math.abs(eqStore.gains[index]) / 12 * 50}%`,
                top: eqStore.gains[index] >= 0 ? `${50 - Math.abs(eqStore.gains[index]) / 12 * 50}%` : '50%'
              }"
            />
            
            <div class="absolute w-2 h-[1px] bg-white/20"/>
            
            <input
              type="range"
              min="-12"
              max="12"
              step="1"
              :value="eqStore.gains[index]"
              @input="handleSliderInput(index, $event)"
              class="absolute w-full h-full opacity-0 cursor-pointer"
              style="writing-mode: vertical-lr; direction: rtl;"
            />
            
            <div 
              class="absolute w-3.5 h-3.5 bg-white rounded-full shadow pointer-events-none"
              :style="{
                top: `${50 - eqStore.gains[index] / 12 * 50}%`,
                transform: 'translateY(-50%)'
              }"
            />
          </div>
          
          <div class="text-[9px] text-white/40 mt-1">{{ getBandLabel(freq) }}</div>
        </div>
      </div>

      <!-- 预设 -->
      <div>
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <span class="text-xs text-white/50">预设</span>
            <span class="text-[10px] text-white/25">← 左右滑动 →</span>
          </div>
          <div class="flex gap-2">
            <button 
              @click="resetWithNative()"
              class="px-3 py-1.5 text-[10px] bg-white/5 hover:bg-white/10 rounded-full transition-colors"
            >
              重置
            </button>
            <button 
              @click="showSaveDialog = true"
              class="px-3 py-1.5 text-[10px] bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 rounded-full transition-colors"
            >
              + 保存
            </button>
          </div>
        </div>
        
        <!-- 水平滚动预设列表 -->
        <div class="preset-scroll -mx-4 px-4 pb-2 overflow-x-auto scrollbar-hide">
          <div class="flex gap-2 w-max">
            <button
              v-for="preset in eqStore.getAllPresets()"
              :key="preset.id"
              @click="applyPresetWithNative(preset.id)"
              :class="[
                'px-4 py-2.5 rounded-full text-xs font-medium whitespace-nowrap transition-all duration-200',
                eqStore.currentPresetId === preset.id
                  ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg shadow-purple-500/25 scale-105'
                  : 'bg-white/5 text-white/60 hover:bg-white/10 active:scale-95'
              ]"
            >
              {{ preset.name }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 保存弹窗 -->
    <Teleport to="body">
      <Transition name="fade">
        <div 
          v-if="showSaveDialog"
          class="fixed inset-0 bg-black/80 flex items-center justify-center z-[300] p-4"
          @click.self="showSaveDialog = false"
        >
          <div class="bg-zinc-900 rounded-xl p-4 w-full max-w-xs">
            <h3 class="text-sm font-medium mb-3">保存预设</h3>
            <input
              v-model="presetName"
              type="text"
              placeholder="预设名称"
              class="w-full px-3 py-2.5 bg-white/5 rounded-lg text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-purple-500/50 mb-3"
              @keyup.enter="savePreset"
            />
            <div class="flex gap-2">
              <button 
                @click="showSaveDialog = false"
                class="flex-1 py-2.5 bg-white/5 hover:bg-white/10 rounded-lg text-sm transition-colors"
              >
                取消
              </button>
              <button 
                @click="savePreset"
                :disabled="!presetName.trim()"
                class="flex-1 py-2.5 bg-purple-500 disabled:opacity-50 rounded-lg text-sm transition-colors"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
input[type="range"] {
  -webkit-appearance: slider-vertical;
  appearance: slider-vertical;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* 隐藏滚动条 */
.scrollbar-hide {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
.scrollbar-hide::-webkit-scrollbar {
  display: none;
}

/* 旋钮触摸反馈 */
.knob-container {
  touch-action: none;
}
.knob-container:active {
  transform: scale(0.95);
  transition: transform 0.1s ease;
}
</style>
