/**
 * 均衡器服务
 * 使用 Web Audio API BiquadFilterNode 实现 10 频段图形均衡器
 */

// 10 频段中心频率
export const EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const
export type EQBand = typeof EQ_BANDS[number]

// 频段显示标签
export const BAND_LABELS: Record<EQBand, string> = {
    32: '32',
    64: '64',
    125: '125',
    250: '250',
    500: '500',
    1000: '1k',
    2000: '2k',
    4000: '4k',
    8000: '8k',
    16000: '16k'
}

// 预设类型
export interface EQPreset {
    id: string
    name: string
    icon: string
    gains: number[] // 10 个频段的增益值 (-12 to 12)
}

// 内置预设
export const BUILT_IN_PRESETS: EQPreset[] = [
    { id: 'flat', name: '默认', icon: '🎵', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    { id: 'bass', name: '低音增强', icon: '🎧', gains: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
    { id: 'vocal', name: '人声清晰', icon: '🎤', gains: [-2, -1, 0, 2, 4, 4, 3, 2, 1, 0] },
    { id: 'rock', name: '摇滚', icon: '🎸', gains: [5, 4, 2, 0, -1, -1, 0, 2, 4, 5] },
    { id: 'pop', name: '流行', icon: '🎹', gains: [2, 3, 4, 3, 1, 0, 1, 2, 3, 2] },
    { id: 'classical', name: '古典', icon: '🎻', gains: [0, 0, 0, 0, 0, 0, -1, -2, -2, -3] },
    { id: 'electronic', name: '电子', icon: '🎛️', gains: [5, 4, 2, 0, -2, -2, 0, 3, 4, 5] },
    { id: 'jazz', name: '爵士', icon: '🎷', gains: [0, 0, 1, 3, 3, 3, 3, 2, 1, 0] }
]

class EqualizerService {
    private audioContext: AudioContext | null = null
    private filters: BiquadFilterNode[] = []
    private sourceNode: MediaElementAudioSourceNode | null = null
    private gainNode: GainNode | null = null
    private isEnabled = false
    private isConnected = false
    private currentGains: number[] = new Array(10).fill(0)

    /**
     * 初始化 AudioContext（需要在用户交互后调用）
     */
    async init(): Promise<boolean> {
        if (this.audioContext) {
            return true
        }

        try {
            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()

            // 创建增益节点
            this.gainNode = this.audioContext.createGain()
            this.gainNode.gain.value = 1

            // 创建 10 个滤波器
            this.createFilters()

            console.log('EqualizerService: AudioContext 初始化成功')
            return true
        } catch (e) {
            console.error('EqualizerService: AudioContext 初始化失败', e)
            return false
        }
    }

    /**
     * 创建 10 个频段的滤波器
     */
    private createFilters() {
        if (!this.audioContext) return

        this.filters = EQ_BANDS.map((freq, index) => {
            const filter = this.audioContext!.createBiquadFilter()
            filter.frequency.value = freq
            filter.gain.value = 0
            filter.Q.value = 1.4 // 适中的 Q 值

            // 设置滤波器类型
            if (index === 0) {
                filter.type = 'lowshelf'
            } else if (index === EQ_BANDS.length - 1) {
                filter.type = 'highshelf'
            } else {
                filter.type = 'peaking'
            }

            return filter
        })

        // 串联滤波器
        for (let i = 0; i < this.filters.length - 1; i++) {
            this.filters[i].connect(this.filters[i + 1])
        }

        // 最后一个滤波器连接到增益节点
        this.filters[this.filters.length - 1].connect(this.gainNode!)

        // 增益节点连接到输出
        this.gainNode!.connect(this.audioContext.destination)
    }

    /**
     * 连接音频元素
     */
    connectAudioElement(audio: HTMLAudioElement): boolean {
        if (!this.audioContext || this.isConnected) {
            return false
        }

        try {
            // 恢复 AudioContext（如果被暂停）
            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume()
            }

            // 创建媒体元素源
            this.sourceNode = this.audioContext.createMediaElementSource(audio)

            if (this.isEnabled && this.filters.length > 0) {
                // 启用 EQ：源 -> 滤波器链 -> 输出
                this.sourceNode.connect(this.filters[0])
            } else {
                // 禁用 EQ：源 -> 直接输出
                this.sourceNode.connect(this.audioContext.destination)
            }

            this.isConnected = true
            console.log('EqualizerService: 已连接音频元素')
            return true
        } catch (e) {
            console.error('EqualizerService: 连接音频元素失败', e)
            return false
        }
    }

    /**
     * 断开连接（切换歌曲时调用）
     */
    disconnect() {
        if (this.sourceNode) {
            try {
                this.sourceNode.disconnect()
            } catch (e) {
                // 忽略断开连接错误
            }
            this.sourceNode = null
        }
        this.isConnected = false
    }

    /**
     * 设置某个频段的增益
     */
    setGain(bandIndex: number, gain: number) {
        if (bandIndex < 0 || bandIndex >= this.filters.length) return

        // 限制范围 -12 到 +12 dB
        const clampedGain = Math.max(-12, Math.min(12, gain))
        this.currentGains[bandIndex] = clampedGain

        if (this.filters[bandIndex]) {
            this.filters[bandIndex].gain.value = clampedGain
        }
    }

    /**
     * 获取所有增益值
     */
    getGains(): number[] {
        return [...this.currentGains]
    }

    /**
     * 应用预设
     */
    applyPreset(preset: EQPreset) {
        preset.gains.forEach((gain, index) => {
            this.setGain(index, gain)
        })
    }

    /**
     * 重置为默认（所有频段归零）
     */
    reset() {
        for (let i = 0; i < 10; i++) {
            this.setGain(i, 0)
        }
    }

    /**
     * 启用均衡器
     */
    enable() {
        if (!this.audioContext || !this.sourceNode || this.isEnabled) return

        try {
            this.sourceNode.disconnect()
            this.sourceNode.connect(this.filters[0])
            this.isEnabled = true
            console.log('EqualizerService: EQ 已启用')
        } catch (e) {
            console.error('EqualizerService: 启用 EQ 失败', e)
        }
    }

    /**
     * 禁用均衡器（直通模式）
     */
    disable() {
        if (!this.audioContext || !this.sourceNode || !this.isEnabled) return

        try {
            this.sourceNode.disconnect()
            this.sourceNode.connect(this.audioContext.destination)
            this.isEnabled = false
            console.log('EqualizerService: EQ 已禁用')
        } catch (e) {
            console.error('EqualizerService: 禁用 EQ 失败', e)
        }
    }

    /**
     * 切换启用/禁用
     */
    toggle(): boolean {
        if (this.isEnabled) {
            this.disable()
        } else {
            this.enable()
        }
        return this.isEnabled
    }

    /**
     * 获取当前状态
     */
    getEnabled(): boolean {
        return this.isEnabled
    }

    /**
     * 获取 AudioContext（供可视化使用）
     */
    getAudioContext(): AudioContext | null {
        return this.audioContext
    }

    /**
     * 获取源节点（供可视化使用）
     */
    getSourceNode(): MediaElementAudioSourceNode | null {
        return this.sourceNode
    }
}

export const equalizerService = new EqualizerService()
