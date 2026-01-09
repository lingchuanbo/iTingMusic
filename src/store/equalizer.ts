import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { equalizerService, EQ_BANDS, BUILT_IN_PRESETS, type EQPreset } from '@/services/player/EqualizerService'

const STORAGE_KEY = 'zen_equalizer'

// 从 localStorage 加载数据
function loadFromStorage() {
    try {
        const data = localStorage.getItem(STORAGE_KEY)
        if (data) {
            const parsed = JSON.parse(data)
            return {
                enabled: parsed.enabled ?? false,
                gains: parsed.gains ?? new Array(10).fill(0),
                currentPresetId: parsed.currentPresetId ?? 'flat',
                customPresets: parsed.customPresets ?? []
            }
        }
    } catch (e) {
        console.error('加载均衡器数据失败:', e)
    }
    return { enabled: false, gains: new Array(10).fill(0), currentPresetId: 'flat', customPresets: [] }
}

export const useEqualizerStore = defineStore('equalizer', () => {
    const saved = loadFromStorage()

    // 状态
    const enabled = ref(saved.enabled)
    const gains = ref<number[]>(saved.gains)
    const currentPresetId = ref<string>(saved.currentPresetId)
    const customPresets = ref<EQPreset[]>(saved.customPresets)
    const isInitialized = ref(false)

    // 保存到 localStorage
    let saveTimer: ReturnType<typeof setTimeout> | null = null
    function saveToStorage() {
        if (saveTimer) clearTimeout(saveTimer)
        saveTimer = setTimeout(() => {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify({
                    enabled: enabled.value,
                    gains: gains.value,
                    currentPresetId: currentPresetId.value,
                    customPresets: customPresets.value
                }))
            } catch (e) {
                console.error('保存均衡器数据失败:', e)
            }
        }, 300)
    }

    // 监听变化自动保存
    watch([enabled, gains, currentPresetId, customPresets], saveToStorage, { deep: true })

    /**
     * 初始化均衡器
     */
    async function init(): Promise<boolean> {
        if (isInitialized.value) return true

        const success = await equalizerService.init()
        if (success) {
            isInitialized.value = true
            // 应用保存的增益值
            gains.value.forEach((gain, index) => {
                equalizerService.setGain(index, gain)
            })
        }
        return success
    }

    /**
     * 切换启用/禁用
     */
    function toggle() {
        enabled.value = !enabled.value
        // 尝试同步到 service（如果已连接）
        if (enabled.value) {
            equalizerService.enable()
        } else {
            equalizerService.disable()
        }
    }

    /**
     * 设置某个频段的增益
     */
    function setGain(bandIndex: number, gain: number) {
        if (bandIndex < 0 || bandIndex >= 10) return
        gains.value[bandIndex] = Math.max(-12, Math.min(12, gain))
        equalizerService.setGain(bandIndex, gains.value[bandIndex])
        // 当手动调节时，标记为自定义
        currentPresetId.value = 'custom'
    }

    /**
     * 应用预设
     */
    function applyPreset(presetId: string) {
        // 查找预设
        const preset = BUILT_IN_PRESETS.find(p => p.id === presetId)
            || customPresets.value.find(p => p.id === presetId)

        if (preset) {
            equalizerService.applyPreset(preset)
            gains.value = [...preset.gains]
            currentPresetId.value = presetId
        }
    }

    /**
     * 重置为默认
     */
    function reset() {
        equalizerService.reset()
        gains.value = new Array(10).fill(0)
        currentPresetId.value = 'flat'
    }

    /**
     * 保存当前设置为自定义预设
     */
    function saveAsPreset(name: string): EQPreset {
        const id = `custom_${Date.now()}`
        const preset: EQPreset = {
            id,
            name,
            icon: '⭐',
            gains: [...gains.value]
        }
        customPresets.value.push(preset)
        currentPresetId.value = id
        return preset
    }

    /**
     * 删除自定义预设
     */
    function deletePreset(presetId: string) {
        const index = customPresets.value.findIndex(p => p.id === presetId)
        if (index !== -1) {
            customPresets.value.splice(index, 1)
            if (currentPresetId.value === presetId) {
                currentPresetId.value = 'flat'
            }
        }
    }

    /**
     * 获取所有预设（内置 + 自定义）
     */
    function getAllPresets(): EQPreset[] {
        return [...BUILT_IN_PRESETS, ...customPresets.value]
    }

    /**
     * 启用 EQ（在连接音频后调用）
     */
    function enableEQ() {
        if (enabled.value) {
            equalizerService.enable()
        }
    }

    /**
     * 禁用 EQ
     */
    function disableEQ() {
        equalizerService.disable()
        enabled.value = false
    }

    return {
        // 状态
        enabled,
        gains,
        currentPresetId,
        customPresets,
        isInitialized,

        // 常量
        bands: EQ_BANDS,
        builtInPresets: BUILT_IN_PRESETS,

        // 方法
        init,
        toggle,
        setGain,
        applyPreset,
        reset,
        saveAsPreset,
        deletePreset,
        getAllPresets,
        enableEQ,
        disableEQ
    }
})
