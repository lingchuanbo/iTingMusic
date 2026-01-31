/**
 * 心灵维度服务 (Soul Dimension Service)
 * 追踪用户的音乐心智状态，并随交互进化
 */

export interface SoulDimension {
    resonance: number // 共鸣度: 0(探索/新奇) -> 1(习惯/安全)
    energy: number    // 能量值: 0(静谧/安稳) -> 1(激昂/热烈)
    spectrum: number  // 色谱: 0(小众/深邃) -> 1(流行/明亮)
    depth: number    // 深度: 0(简单/直白) -> 1(复杂/宏大)
}

export interface SoulSession {
    id: string
    timestamp: number
    resonanceScore: number // 最终共鸣评分 (1-100)
    moodTag: string
    songs: { title: string; artist: string }[]
}

export interface SoulState {
    dimensions: SoulDimension
    history: SoulSession[]
    totalSessions: number
    likedTracks: string[] // "Title - Artist"
    dislikedTracks: string[] // "Title - Artist"
}

const STORAGE_KEY = 'zen_soul_state'

const defaultState: SoulState = {
    dimensions: {
        resonance: 0.5,
        energy: 0.5,
        spectrum: 0.5,
        depth: 0.5
    },
    history: [],
    totalSessions: 0,
    likedTracks: [],
    dislikedTracks: []
}

class SoulService {
    private state: SoulState = this.loadState()

    private loadState(): SoulState {
        try {
            const data = localStorage.getItem(STORAGE_KEY)
            if (data) {
                return { ...defaultState, ...JSON.parse(data) }
            }
        } catch (e) {
            console.error('Failed to load soul state:', e)
        }
        return { ...defaultState }
    }

    private saveState() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state))
    }

    getDimensions(): SoulDimension {
        return { ...this.state.dimensions }
    }

    getHistory(): SoulSession[] {
        return [...this.state.history].sort((a, b) => b.timestamp - a.timestamp)
    }

    /**
     * 进化心灵维度
     * 根据用户的反馈调整维度权重
     */
    evolve(feedback: Partial<SoulDimension>, impact = 0.05) {
        const d = this.state.dimensions
        if (feedback.resonance !== undefined) d.resonance += (feedback.resonance - d.resonance) * impact
        if (feedback.energy !== undefined) d.energy += (feedback.energy - d.energy) * impact
        if (feedback.spectrum !== undefined) d.spectrum += (feedback.spectrum - d.spectrum) * impact
        if (feedback.depth !== undefined) d.depth += (feedback.depth - d.depth) * impact

        // 限制范围在 0-1
        Object.keys(d).forEach(k => {
            const key = k as keyof SoulDimension
            d[key] = Math.max(0, Math.min(1, d[key]))
        })

        this.saveState()
    }

    /**
     * 记录一次心灵契合会话
     */
    recordSession(session: Omit<SoulSession, 'id' | 'timestamp'>) {
        const newSession: SoulSession = {
            ...session,
            id: Math.random().toString(36).slice(2, 9),
            timestamp: Date.now()
        }

        this.state.history.unshift(newSession)
        if (this.state.history.length > 20) {
            this.state.history.pop()
        }

        this.state.totalSessions++
        this.saveState()
    }

    /**
     * 记录歌曲反馈 (Like/Dislike)
     * 用于实时进化心灵维度，并显著影响下一次推荐
     */
    recordFeedback(trackName: string, isPositive: boolean, impact = 0.1) {
        if (isPositive) {
            // 正向反馈：固化当前特征，提升共鸣度
            this.evolve({ resonance: 0.9 }, impact)
            if (!this.state.likedTracks.includes(trackName)) {
                this.state.likedTracks.push(trackName)
                if (this.state.likedTracks.length > 50) this.state.likedTracks.shift()
            }
            // 从不喜欢列表中移除（如果存在）
            this.state.dislikedTracks = this.state.dislikedTracks.filter(t => t !== trackName)
        } else {
            // 负向反馈：降低共鸣度，并随机漂移其他维度寻求变化
            this.evolve({
                resonance: 0.1,
                energy: Math.random(),
                spectrum: Math.random(),
                depth: Math.random()
            }, impact * 1.5)

            if (!this.state.dislikedTracks.includes(trackName)) {
                this.state.dislikedTracks.push(trackName)
                if (this.state.dislikedTracks.length > 50) this.state.dislikedTracks.shift()
            }
            // 从喜欢列表中移除（如果存在）
            this.state.likedTracks = this.state.likedTracks.filter(t => t !== trackName)
        }
        this.saveState()
    }

    /**
     * 生成心灵语境 Prompt
     */
    getSoulContextPrompt(): string {
        const { resonance, energy, spectrum, depth } = this.state.dimensions

        const descriptions: string[] = []

        // 解析维度到文学化描述
        if (resonance > 0.7) descriptions.push('渴望在熟悉的旋律中寻找安全感')
        else if (resonance < 0.3) descriptions.push('极度渴望探索未知的音乐疆域，反感陈词滥调')

        if (energy > 0.7) descriptions.push('当前精神能量高涨，偏好节奏感强、生命力旺盛的作品')
        else if (energy < 0.3) descriptions.push('内心追求极致的宁静，偏好极简、低频的安稳感')

        if (spectrum > 0.7) descriptions.push('审美倾向于明亮、色彩斑斓的大众流行语境')
        else if (spectrum < 0.3) descriptions.push('审美倾向于深邃、冷调的独立/实验性语境')

        if (depth > 0.7) descriptions.push('偏好结构复杂、富有思辨性的宏大叙事乐章')
        else if (depth < 0.3) descriptions.push('追求直白、纯粹、未经雕琢的情感表达')

        let prompt = descriptions.length > 0
            ? `目前用户的心灵维度特征为：${descriptions.join('；')}。`
            : '用户目前处于开放且中性的审美状态。'

        if (this.state.likedTracks.length > 0) {
            const sample = this.state.likedTracks.slice(-5).join('、')
            prompt += `\n用户近期深度共鸣的曲目包括：${sample}。请以此为灵魂锚点进行发散。`
        }

        if (this.state.dislikedTracks.length > 0) {
            const sample = this.state.dislikedTracks.slice(-5).join('、')
            prompt += `\n请避开类似于 ${sample} 这种风格或类型的曲目，用户目前对其产生了审美疲劳或不适感。`
        }

        return prompt
    }

    // ========== 临时播放快照 (用于“随便听听”的独立播放规则) ==========
    private playerSnapshot: { playlist: any[], index: number } | null = null

    captureSnapshot(playlist: any[], index: number) {
        this.playerSnapshot = { playlist: [...playlist], index }
    }

    getSnapshot() {
        return this.playerSnapshot
    }

    clearSnapshot() {
        this.playerSnapshot = null
    }
}

export const soulService = new SoulService()
