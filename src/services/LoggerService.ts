/**
 * 运行日志服务
 * 用于收集和存储应用运行日志，方便调试息屏播放等问题
 */

export type LogType = 'INFO' | 'WARN' | 'ERROR'

export interface LogEntry {
    timestamp: number
    time: string
    type: LogType
    message: string
}

const STORAGE_KEY = 'runtime_logs'
const ENABLED_KEY = 'runtime_logs_enabled'
const MAX_LOGS = 500

class LoggerService {
    private logs: LogEntry[] = []
    private _enabled: boolean = false

    constructor() {
        this.loadState()
    }

    private loadState() {
        try {
            // 加载开关状态
            const enabledStr = localStorage.getItem(ENABLED_KEY)
            this._enabled = enabledStr === 'true'

            // 加载历史日志
            const logsStr = localStorage.getItem(STORAGE_KEY)
            if (logsStr) {
                this.logs = JSON.parse(logsStr)
            }
        } catch (e) {
            console.error('LoggerService: 加载状态失败', e)
        }
    }

    private saveState() {
        try {
            localStorage.setItem(ENABLED_KEY, String(this._enabled))
            // 只保存最近的日志
            const toSave = this.logs.slice(-MAX_LOGS)
            localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
        } catch (e) {
            console.error('LoggerService: 保存状态失败', e)
        }
    }

    private formatTime(date: Date): string {
        const pad = (n: number) => n.toString().padStart(2, '0')
        return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    }

    get enabled(): boolean {
        return this._enabled
    }

    setEnabled(value: boolean) {
        this._enabled = value
        this.saveState()
        if (value) {
            this.log('INFO', '日志记录已开启')
        }
    }

    log(type: LogType, message: string) {
        if (!this._enabled) return

        const now = new Date()
        const entry: LogEntry = {
            timestamp: now.getTime(),
            time: this.formatTime(now),
            type,
            message
        }

        this.logs.push(entry)

        // 超出限制时删除旧日志
        if (this.logs.length > MAX_LOGS) {
            this.logs = this.logs.slice(-MAX_LOGS)
        }

        // 同时输出到控制台
        const consoleMethod = type === 'ERROR' ? console.error : type === 'WARN' ? console.warn : console.log
        consoleMethod(`[LOG] ${entry.time} [${type}] ${message}`)

        // 定期保存 (每10条保存一次)
        if (this.logs.length % 10 === 0) {
            this.saveState()
        }
    }

    info(message: string) {
        this.log('INFO', message)
    }

    warn(message: string) {
        this.log('WARN', message)
    }

    error(message: string) {
        this.log('ERROR', message)
    }

    getLogs(): LogEntry[] {
        return [...this.logs]
    }

    getLogCount(): number {
        return this.logs.length
    }

    clear() {
        this.logs = []
        this.saveState()
    }

    export(): string {
        return this.logs
            .map(entry => `[${entry.time}] [${entry.type}] ${entry.message}`)
            .join('\n')
    }

    // 强制保存（用于关闭应用前）
    flush() {
        this.saveState()
    }
}

export const logger = new LoggerService()
