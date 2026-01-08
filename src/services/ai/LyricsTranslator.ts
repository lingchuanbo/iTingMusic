import { loadAIConfig } from './AIService'

// 翻译 API 类型
export type TranslateProvider = 'builtin-ai' | 'deeplx' | 'google'

// 目标语言类型
export type TargetLanguage = 'auto' | 'zh' | 'en' | 'ja' | 'ko'

// 翻译配置接口
export interface TranslateConfig {
  provider: TranslateProvider
  deeplxKey?: string
  deeplxBaseUrl?: string // DeepLX API 地址
  targetLang: TargetLanguage // 目标语言，auto 表示自动检测
}

const TRANSLATE_CONFIG_KEY = 'lyrics_translate_config'

// 默认配置
const defaultTranslateConfig: TranslateConfig = {
  provider: 'builtin-ai',
  targetLang: 'auto'
}

// 加载翻译配置
export function loadTranslateConfig(): TranslateConfig {
  try {
    const data = localStorage.getItem(TRANSLATE_CONFIG_KEY)
    if (data) {
      return { ...defaultTranslateConfig, ...JSON.parse(data) }
    }
  } catch {
    // ignore
  }
  return { ...defaultTranslateConfig }
}

// 保存翻译配置
export function saveTranslateConfig(config: TranslateConfig): void {
  localStorage.setItem(TRANSLATE_CONFIG_KEY, JSON.stringify(config))
}

// 翻译结果接口
export interface TranslatedLyrics {
  original: string
  translated: string
  targetLang: string
  timestamp: number
}

// 解析歌词行，提取时间戳和文本
interface LyricLine {
  time: string
  text: string
}

// 检测文本主要语言
export function detectLanguage(text: string): 'zh' | 'en' | 'ja' | 'ko' | 'other' {
  // 移除标点和空格
  const cleanText = text.replace(/[\s\p{P}]/gu, '')
  if (!cleanText) return 'other'

  let zhCount = 0
  let enCount = 0
  let jaCount = 0
  let koCount = 0

  for (const char of cleanText) {
    const code = char.charCodeAt(0)
    // 中文字符范围
    if (code >= 0x4e00 && code <= 0x9fff) {
      zhCount++
    }
    // 日文平假名和片假名
    else if ((code >= 0x3040 && code <= 0x309f) || (code >= 0x30a0 && code <= 0x30ff)) {
      jaCount++
    }
    // 韩文
    else if (code >= 0xac00 && code <= 0xd7af) {
      koCount++
    }
    // 英文字母
    else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) {
      enCount++
    }
  }

  const total = zhCount + enCount + jaCount + koCount
  if (total === 0) return 'other'

  // 计算占比
  const zhRatio = zhCount / total
  const jaRatio = jaCount / total
  const koRatio = koCount / total

  // 优先级：韩文 > 日文 > 中文 > 英文
  if (koCount > 0 && (koRatio > 0.1 || koCount > 1)) return 'ko'
  if (jaCount > 0 && (jaRatio > 0.1 || jaCount > 1)) return 'ja'
  if (zhRatio > 0.2 || zhCount > 2) return 'zh'
  if (enCount > 0) return 'en'

  return 'other'
}

// 根据源语言自动选择目标语言
export function getAutoTargetLang(sourceLang: string): string {
  // 中文 -> 英文
  if (sourceLang === 'zh') return 'en'
  // 英文/日文/韩文/其他 -> 中文
  return 'zh'
}

// 检测歌词是否已经是双语
function isBilingualLyrics(lines: LyricLine[]): boolean {
  if (lines.length < 4) return false

  // 统计每行的语言
  const languages: string[] = []
  for (const line of lines) {
    if (!line.text || /^[♪♫\s]*$/.test(line.text)) continue
    languages.push(detectLanguage(line.text))
  }

  if (languages.length < 4) return false

  // 检测是否有交替出现的不同语言（双语歌词的典型特征）
  let alternateCount = 0
  let lastLang = ''
  const uniqueLangs = new Set<string>()

  for (let i = 0; i < languages.length; i++) {
    const lang = languages[i]
    if (lang === 'other') continue
    uniqueLangs.add(lang)

    if (lastLang && lang !== lastLang) {
      alternateCount++
    }
    lastLang = lang
  }

  // 如果只有一种语言（哪怕交替也只是空行或其他），则不算双语
  if (uniqueLangs.size < 2) return false

  // 如果语言交替出现的次数超过总行数的 40%，认为是双语歌词
  const alternateRatio = alternateCount / languages.length
  return alternateRatio > 0.4
}

function parseLyricLines(lrc: string): LyricLine[] {
  const lines = lrc.split('\n')
  const result: LyricLine[] = []

  for (const line of lines) {
    const match = line.match(/^(\[\d{2}:\d{2}(?:\.\d{2,3})?\])(.*)$/)
    if (match) {
      result.push({
        time: match[1],
        text: match[2].trim()
      })
    }
  }

  return result
}

// 将翻译结果与原时间戳合并
function mergeLyricsWithTimestamps(originalLines: LyricLine[], translatedTexts: string[]): string {
  const result: string[] = []

  // 直接使用翻译结果（已经是按行号解析好的数组）
  for (let i = 0; i < originalLines.length; i++) {
    const time = originalLines[i].time
    const originalText = originalLines[i].text
    // 修正：只要翻译数组里有这一项（哪怕是空字符串），就使用翻译结果
    // 只有当这一项完全不存在（undefined）时，才回退到原文
    if (!originalText || /^[♪♫\s]*$/.test(originalText)) {
      result.push(`${time}${originalText}`)
    } else {
      // 这里的逻辑变更为：如果翻译结果是空或者是被过滤掉的重复，宁可显示空行也不要显示重复的中文
      const translatedLine = translatedTexts[i]
      const textToShow = translatedLine !== undefined ? translatedLine : originalText
      result.push(`${time}${textToShow}`)
    }
  }

  return result.join('\n')
}

// 翻译缓存
function getTranslationCacheKey(trackId: string, targetLang: string): string {
  return `lyrics_translation_${trackId}_${targetLang}`
}

export async function getCachedTranslation(
  trackId: string,
  targetLang: string = 'zh'
): Promise<string | null> {
  try {
    const key = getTranslationCacheKey(trackId, targetLang)
    const cached = localStorage.getItem(key)
    if (cached) {
      const data: TranslatedLyrics = JSON.parse(cached)

      // 增加缓存质量检查：如果预期目标是英文，但结果检测为中文，则丢弃缓存
      if (targetLang === 'en') {
        const sample = data.translated.slice(0, 100)
        if (detectLanguage(sample) === 'zh') {
          console.warn('[缓存守卫] 丢弃错误的中文缓存 (预期英文)')
          localStorage.removeItem(key)
          return null
        }
      }

      return data.translated
    }
  } catch {
    // ignore
  }
  return null
}

export function cacheTranslation(
  trackId: string,
  original: string,
  translated: string,
  targetLang: string = 'zh'
): void {
  try {
    const key = getTranslationCacheKey(trackId, targetLang)
    const data: TranslatedLyrics = {
      original,
      translated,
      targetLang,
      timestamp: Date.now()
    }
    localStorage.setItem(key, JSON.stringify(data))
  } catch {
    // ignore
  }
}


// ========== DeepLX 代理翻译 ==========
// ========== DeepLX 代理翻译 ==========
async function translateWithDeepLX(
  texts: string[],
  targetLang: string,
  apiKey: string,
  baseUrl: string = 'https://api.deeplx.org'
): Promise<string[]> {
  const results: string[] = []

  // DeepLX 语言代码映射
  const langMap: Record<string, string> = {
    zh: 'ZH',
    en: 'EN',
    ja: 'JA',
    ko: 'KO'
  }
  const targetCode = langMap[targetLang] || 'ZH'

  // 处理 API URL
  let apiUrl = baseUrl

  // 支持多种占位符格式
  const placeholders = ['{{apiKey}}', '{apiKey}', '<api-key>', '$apiKey']
  let substituted = false
  for (const p of placeholders) {
    if (apiUrl.includes(p)) {
      apiUrl = apiUrl.replace(p, apiKey)
      substituted = true
    }
  }

  // 如果没有手动指定占位符，且是 api.deeplx.org，则尝试自动插入路径 token
  if (!substituted && apiUrl.includes('api.deeplx.org') && apiKey) {
    // 只有当 URL 中没有 apiKey 时才进行替换，避免重复
    if (!apiUrl.includes(apiKey)) {
      // 如果只有域名或以后缀 / 结尾，则插入 token
      // 匹配 https://api.deeplx.org 或 https://api.deeplx.org/
      const domainMatch = apiUrl.match(/^(https?:\/\/api\.deeplx\.org)(\/)?$/i)
      if (domainMatch) {
        apiUrl = `${domainMatch[1]}/${apiKey}`
      } else {
        // 如果包含路径但路径中不含 apiKey，且是 api.deeplx.org，则在域名后插入
        // 例如 https://api.deeplx.org/translate -> https://api.deeplx.org/TOKEN/translate
        apiUrl = apiUrl.replace(/api\.deeplx\.org/i, `api.deeplx.org/${apiKey}`)
      }
    }
  }

  // 确保有 /translate 后缀，如果没有则添加
  // 但如果用户已经写了包含占位符的完整路径（如自定义 API），则不强加 /translate
  if (!apiUrl.includes('/translate') && !substituted) {
    apiUrl = apiUrl.endsWith('/') ? `${apiUrl}translate` : `${apiUrl}/translate`
  }

  // 批量翻译，每次最多 50 行
  const batchSize = 50
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize)
    const textToTranslate = batch.join('\n')

    if (!textToTranslate.trim()) {
      results.push(...batch)
      continue
    }

    const payload = {
      text: textToTranslate,
      source_lang: 'auto',
      target_lang: targetCode
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (apiKey) {
      // 兼容多种 Key 认证方式：部分服务器在 URL 路径中接收，部分在 Header 中接收
      // 同时发送通常是安全的
      headers['Authorization'] = `Bearer ${apiKey}`
    }

    let data: any

    try {
      const { CapacitorHttp } = await import('@capacitor/core').catch(() => ({ CapacitorHttp: null }))

      if (CapacitorHttp && (window as any).Capacitor?.isNativePlatform()) {
        const res = await CapacitorHttp.post({
          url: apiUrl,
          headers,
          data: payload
        })

        if (res.status >= 200 && res.status < 300) {
          data = res.data
        } else {
          const errMsg = typeof res.data === 'string' ? res.data : JSON.stringify(res.data)
          throw new Error(`HTTP ${res.status}: ${errMsg.slice(0, 100)}`)
        }
      } else {
        const res = await fetch(apiUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        })

        if (!res.ok) {
          const errorText = await res.text().catch(() => '')
          throw new Error(`HTTP ${res.status}: ${errorText.slice(0, 100)}`)
        }
        data = await res.json()
      }
    } catch (e: any) {
      console.error('DeepLX 请求失败:', e)
      if (e.message.includes('Failed to fetch') || e.message.includes('Network Error')) {
        throw new Error('网络请求失败。请检查 API 地址是否可达，或者是否存在跨域限制。')
      }
      throw new Error(`DeepLX 请求异常: ${e.message}`)
    }

    if (data.code !== 200 && data.code !== undefined && data.message) {
      throw new Error(`DeepLX 错误 ${data.code}: ${data.message}`)
    }

    // 兼容多种返回格式
    let translatedResult: string | null = null
    if (data.data && typeof data.data === 'string') {
      translatedResult = data.data
    } else if (data.text && typeof data.text === 'string') {
      translatedResult = data.text
    } else if (Array.isArray(data.translations)) {
      // 兼容 DeepL 官方或兼容 API 格式
      translatedResult = data.translations.map((t: any) => t.text).join('\n')
    } else if (typeof data === 'string') {
      translatedResult = data
    } else if (data.data && Array.isArray(data.data)) {
      // 部分代理返回的是数组
      translatedResult = data.data.join('\n')
    }

    if (translatedResult) {
      const translatedLines = String(translatedResult).split('\n')
      results.push(...translatedLines)
    } else {
      console.warn('DeepLX 返回了未知格式的数据:', data)
      results.push(...batch)
    }

    // 添加延迟避免请求过快
    if (i + batchSize < texts.length) {
      await new Promise(resolve => setTimeout(resolve, 300))
    }
  }

  return results
}

// ========== Google Translate ==========
async function translateWithGoogle(texts: string[], targetLang: string): Promise<string[]> {
  const results: string[] = []

  // Google 语言代码
  const langMap: Record<string, string> = {
    zh: 'zh-CN',
    en: 'en',
    ja: 'ja',
    ko: 'ko'
  }
  const targetCode = langMap[targetLang] || 'zh-CN'

  // 批量翻译
  const batchSize = 30
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize)
    const textToTranslate = batch.join('\n')

    if (!textToTranslate.trim()) {
      results.push(...batch)
      continue
    }

    // 使用 Google Translate 免费 API
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetCode}&dt=t&q=${encodeURIComponent(textToTranslate)}`

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Google 翻译失败: ${response.status}`)
    }

    const data = await response.json()
    // Google 返回格式: [[["translated text","original text",null,null,10],...],null,"en",...]
    let translatedText = ''
    if (data && data[0]) {
      translatedText = data[0].map((item: any) => item[0]).join('')
    }

    const translatedLines = translatedText.split('\n')
    results.push(...translatedLines)
  }
  return results
}

// ========== 内置 AI 翻译 ==========
const LANG_NAMES: Record<string, string> = {
  zh: 'Chinese',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean'
}

function generateTranslationPrompt(sourceLang: string, targetLang: string): string {
  const source = LANG_NAMES[sourceLang] || sourceLang
  const target = LANG_NAMES[targetLang] || targetLang

  return `You are a professional song lyrics translator.

## Your Task
Translate ${source} lyrics into natural, fluent ${target}.

## Output Rules
1. Output ONLY the translated text, one line per input line
2. Use format: "N:translated text" where N is the line number
3. Every output line MUST be in ${target} language
4. Do NOT repeat or echo the original ${source} text
5. Do NOT add explanations, notes, or commentary
6. Preserve the emotional tone and meaning of the lyrics
7. If a line is just music symbols (♪), output "N:♪"

## Example
Input: 1:我爱你
Output: 1:I love you`
}

// 翻译结果清洗与防御
function cleanTranslationLines(
  lines: string[],
  originalTexts: string[],
  targetLang: string,
  sourceLang: string
): string[] {
  return lines.map((line, idx) => {
    if (!line) return ''

    // 终极镜像检测：如果翻译结果与原文完全一模一样，且源语言不是目标语言
    //（排除确实不需要翻译的情况，但如果是翻译任务，通常这就是复读）
    if (originalTexts[idx] && line.trim() === originalTexts[idx].trim()) {
      // 只有当源和目标不同时，复读才是异常的
      if (sourceLang !== targetLang) return ''
    }

    if (targetLang === 'en') {
      // 如果目标是英文，移除所有中日韩字符
      const cleaned = line.replace(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g, '').trim()
      // 如果清洗后空了，或者剩下的是纯干扰项
      if (!cleaned || (!/[a-zA-Z0-9]/.test(cleaned) && sourceLang === 'zh')) return ''
      return cleaned
    }

    return line
  })
}

async function translateWithBuiltinAI(
  texts: string[],
  sourceLang: string,
  targetLang: string,
  onProgress?: (lines: string[]) => void
): Promise<string[]> {
  const config = loadAIConfig()

  if (!config.apiKey) {
    throw new Error('请先在设置中配置 AI')
  }

  const numberedTexts = texts.map((t, i) => `${i + 1}:${t}`).join('\n')
  const lineCount = texts.length

  const authHeaders: Record<string, string> =
    config.authType === 'api-key'
      ? { 'api-key': config.apiKey }
      : { Authorization: `Bearer ${config.apiKey}` }

  const sourceLangName = LANG_NAMES[sourceLang] || sourceLang
  const targetLangName = LANG_NAMES[targetLang] || targetLang

  const userMessage = `Translate the following ${lineCount} lines from ${sourceLangName} to ${targetLangName}.

INPUT:
${numberedTexts}

OUTPUT:`

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: generateTranslationPrompt(sourceLang, targetLang) },
        { role: 'user', content: userMessage }
      ],
      temperature: 0.3,
      max_tokens: 8000,
      stream: false  // 使用非流式请求，更稳定
    })
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`AI 翻译失败: ${response.status} ${error}`)
  }

  const json = await response.json()
  const fullContent = json.choices?.[0]?.message?.content || ''

  if (!fullContent && lineCount > 0) {
    console.error('[AI翻译] 返回内容为空')
    throw new Error('AI 返回内容为空')
  }

  // 解析翻译结果
  const parsed = parseNumberedLines(fullContent, lineCount)

  // 通知进度（一次性完成）
  if (onProgress) {
    const cleanedProgress = cleanTranslationLines(parsed, texts, targetLang, sourceLang)
    onProgress(cleanedProgress)
  }

  return parsed
}

// 解析带行号的翻译结果
function parseNumberedLines(content: string, expectedCount: number): string[] {
  const result: string[] = new Array(expectedCount).fill('')
  // 移除思考过程
  const cleanContent = content.replace(/<think>[\s\S]*?<\/think>/gi, '')
  const lines = cleanContent.split('\n')

  for (const line of lines) {
    // 匹配多种格式：
    // "1:text", "1：text", "1.text", "1、text", "1) text", "1. text"
    const match = line.match(/^\s*(\d+)\s*[:.\u3001\uff1a)\]\-]\s*(.*)$/)
    if (match) {
      const lineNum = parseInt(match[1], 10) - 1 // 转为 0-based index
      const text = match[2].trim()
      if (lineNum >= 0 && lineNum < expectedCount) {
        // 如果这一行已经有内容且新内容为空，不覆盖
        if (!result[lineNum] || text) {
          result[lineNum] = text
        }
      }
    }
  }

  // 检查是否有未翻译的行，尝试用备用方法解析
  const emptyCount = result.filter(r => r === '').length
  if (emptyCount > expectedCount * 0.3) {
    // 如果超过30%的行为空，尝试按顺序解析
    // 过滤掉包含括号、中括号的非歌词行
    const contentLines = cleanContent
      .split('\n')
      .filter(l => l.trim() && !l.match(/^\s*[\[\(]/))

    for (let i = 0; i < Math.min(contentLines.length, expectedCount); i++) {
      const line = contentLines[i]
      // 移除可能的行号前缀
      const cleaned = line.replace(/^\s*\d+\s*[:.\u3001\uff1a)\]\-]\s*/, '').trim()
      if (cleaned && !result[i]) {
        result[i] = cleaned
      }
    }
  }

  return result
}

// ========== 统一翻译接口 ==========
export interface TranslateCallbacks {
  onProgress?: (text: string) => void
  onComplete?: (translated: string) => void
  onError?: (error: string) => void
}

export async function translateLyrics(
  lyrics: string,
  callbacks?: TranslateCallbacks
): Promise<{ translated: string; targetLang: string } | null> {
  const translateConfig = loadTranslateConfig()

  // 解析原歌词
  const originalLines = parseLyricLines(lyrics)
  if (originalLines.length === 0) {
    callbacks?.onError?.('无法解析歌词')
    throw new Error('无法解析歌词')
  }

  // 检测是否已经是双语歌词
  // 增加逻辑：如果用户手动重试翻译，通过 textsToTranslate 的长度判断是否来自单语原文
  if (isBilingualLyrics(originalLines)) {
    // 双语歌词，检查是否需要重新互译
  }

  // 检测源语言
  const textsToTranslate = originalLines.map((l) => l.text)
  // 获取前30行有意义的文本进行检测 (增加样本容量防止 intro 干扰)
  const sampleText = textsToTranslate
    .filter(t => t.trim() && !/^[♪♫\s]*$/.test(t))
    .slice(0, 30).join('\n')
  const sourceLang = detectLanguage(sampleText || textsToTranslate[0])

  // 确定目标语言
  let targetLang = translateConfig.targetLang
  if (targetLang === 'auto') {
    targetLang = getAutoTargetLang(sourceLang) as TargetLanguage
  }

  // 强制互译：如果源是中文，必须翻译成英文
  if (sourceLang === 'zh') {
    targetLang = 'en'
  }

  try {
    let translatedTexts: string[]

    switch (translateConfig.provider) {
      case 'deeplx':
        if (!translateConfig.deeplxKey && !translateConfig.deeplxBaseUrl) {
          throw new Error('请先配置 DeepLX API Key 或 API 地址')
        }
        translatedTexts = await translateWithDeepLX(
          textsToTranslate,
          targetLang,
          translateConfig.deeplxKey || '',
          translateConfig.deeplxBaseUrl
        )
        break

      case 'google':
        translatedTexts = await translateWithGoogle(textsToTranslate, targetLang)
        break

      case 'builtin-ai':
      default:
        try {
          translatedTexts = await translateWithBuiltinAI(textsToTranslate, sourceLang, targetLang, (lines) => {
            const mergedLyrics = mergeLyricsWithTimestamps(originalLines, lines)
            callbacks?.onProgress?.(mergedLyrics)
          })
        } catch (error: any) {
          // 如果 AI 翻译失败或被拦截（回显），尝试静默降级到 Google 翻译
          console.warn('AI 翻译异常，尝试降级到 Google 翻译:', error.message)
          translatedTexts = await translateWithGoogle(textsToTranslate, targetLang)
        }
        break
    }

    // 终极防御：如果目标是英文，则强力清洗掉所有中日韩字符
    translatedTexts = cleanTranslationLines(translatedTexts, textsToTranslate, targetLang, sourceLang)

    // 补救机制：检测哪些行翻译缺失，用 Google 翻译补充
    const missingIndices: number[] = []
    for (let i = 0; i < translatedTexts.length; i++) {
      const original = textsToTranslate[i]
      const translated = translatedTexts[i]
      // 如果原文有内容但翻译为空，记录下来
      if (original && original.trim() && !/^[♪♫\s]*$/.test(original) && !translated) {
        missingIndices.push(i)
      }
    }

    if (missingIndices.length > 0) {
      const missingTexts = missingIndices.map(i => textsToTranslate[i])
      try {
        const filledTexts = await translateWithGoogle(missingTexts, targetLang)
        for (let j = 0; j < missingIndices.length; j++) {
          translatedTexts[missingIndices[j]] = filledTexts[j] || ''
        }
      } catch (e) {
        console.warn('[翻译补救] Google 翻译补充失败:', e)
      }
    }

    const finalLyrics = mergeLyricsWithTimestamps(originalLines, translatedTexts)

    // 最后的最后，做一个极其严格的检查：如果源是中文且结果里依然全是中文，这绝对是失败的
    if (sourceLang === 'zh' && targetLang === 'en') {
      const sample = translatedTexts.filter(t => t.trim() && t !== '♪').slice(0, 10).join(' ')
      const resultLang = detectLanguage(sample)
      if (sample && resultLang === 'zh') {
        console.error('[最终校验失败] 翻译结果检测仍为中文', { resultLang, sample: sample.slice(0, 50) })
        throw new Error('翻译结果异常：检测到结果仍为中文原文。请尝试切换 AI 模型或稍后再试。')
      }
    }

    callbacks?.onComplete?.(finalLyrics)
    return { translated: finalLyrics, targetLang }
  } catch (error: any) {
    console.error('歌词翻译失败:', error)
    callbacks?.onError?.(error.message)
    throw error
  }
}

export async function translateAndCacheLyrics(
  trackId: string,
  lyrics: string,
  callbacks?: TranslateCallbacks
): Promise<string | null> {
  const translateConfig = loadTranslateConfig()

  const originalLines = parseLyricLines(lyrics)
  const textsToTranslate = originalLines.map((l) => l.text)
  const sampleText = textsToTranslate
    .filter(t => t.trim() && !t.includes('♪'))
    .slice(0, 10).join('\n')
  const sourceLang = detectLanguage(sampleText || textsToTranslate[0])

  // 确定目标语言用于缓存 key
  let targetLang = translateConfig.targetLang
  if (targetLang === 'auto') {
    targetLang = getAutoTargetLang(sourceLang) as TargetLanguage
  }

  // 强制纠偏逻辑：与 translateLyrics 保持完全一致
  if (sourceLang === 'zh') {
    targetLang = 'en'
  }

  // 先检查缓存
  const cached = await getCachedTranslation(trackId, targetLang)
  if (cached) {
    callbacks?.onComplete?.(cached)
    return cached
  }

  // 翻译
  const result = await translateLyrics(lyrics, callbacks)

  // 缓存结果
  if (result) {
    cacheTranslation(trackId, lyrics, result.translated, result.targetLang)
  }

  return result?.translated || null
}
