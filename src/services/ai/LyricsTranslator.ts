import { loadAIConfig } from './AIService'

// 翻译 API 类型
export type TranslateProvider = 'builtin-ai' | 'deeplx' | 'google'

// 目标语言类型
export type TargetLanguage = 'auto' | 'zh' | 'en' | 'ja' | 'ko'

// 翻译配置接口
export interface TranslateConfig {
  provider: TranslateProvider
  deeplxKey?: string
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
function detectLanguage(text: string): 'zh' | 'en' | 'ja' | 'ko' | 'other' {
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

  // 判断主要语言（占比超过 50%）
  if (jaCount / total > 0.3) return 'ja' // 日文优先（因为可能混有汉字）
  if (koCount / total > 0.5) return 'ko'
  if (zhCount / total > 0.5) return 'zh'
  if (enCount / total > 0.5) return 'en'

  // 如果有日文假名，判定为日文
  if (jaCount > 0) return 'ja'
  // 如果有中文字符，判定为中文
  if (zhCount > 0) return 'zh'

  return 'other'
}

// 根据源语言自动选择目标语言
function getAutoTargetLang(sourceLang: string): string {
  // 中文 -> 英文，其他 -> 中文
  return sourceLang === 'zh' ? 'en' : 'zh'
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

  for (let i = 0; i < languages.length; i++) {
    const lang = languages[i]
    if (lang === 'other') continue

    if (lastLang && lang !== lastLang) {
      alternateCount++
    }
    lastLang = lang
  }

  // 如果语言交替出现的次数超过总行数的 30%，认为是双语歌词
  const alternateRatio = alternateCount / languages.length
  if (alternateRatio > 0.3) return true

  // 另一种检测：检查相邻行是否是不同语言（中英对照）
  let adjacentDiffCount = 0
  for (let i = 0; i < languages.length - 1; i++) {
    const curr = languages[i]
    const next = languages[i + 1]
    if (curr !== 'other' && next !== 'other' && curr !== next) {
      adjacentDiffCount++
    }
  }

  // 如果相邻不同语言的比例超过 25%，认为是双语
  return adjacentDiffCount / languages.length > 0.25
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
    const translatedText = translatedTexts[i] || ''

    // 如果原文是空行或纯音乐标记，保持原样
    if (!originalText || /^[♪♫\s]*$/.test(originalText)) {
      result.push(`${time}${originalText}`)
    } else if (translatedText) {
      // 有翻译结果，使用翻译
      result.push(`${time}${translatedText}`)
    } else {
      // 翻译缺失，使用原文（这种情况不应该发生）
      result.push(`${time}${originalText}`)
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


// ========== DeepLX 翻译 ==========
async function translateWithDeepLX(
  texts: string[],
  targetLang: string,
  apiKey: string
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

  // 批量翻译，每次最多 50 行
  const batchSize = 50
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize)
    const textToTranslate = batch.join('\n')

    if (!textToTranslate.trim()) {
      results.push(...batch)
      continue
    }

    const response = await fetch(`https://api.deeplx.org/${apiKey}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: textToTranslate,
        source_lang: 'auto',
        target_lang: targetCode
      })
    })

    if (!response.ok) {
      throw new Error(`DeepLX 翻译失败: ${response.status}`)
    }

    const data = await response.json()
    if (data.code !== 200 || !data.data) {
      throw new Error(data.message || 'DeepLX 翻译失败')
    }

    const translatedLines = data.data.split('\n')
    results.push(...translatedLines)
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
function generateTranslationPrompt(targetLang: string, lineCount: number): string {
  const langMap: Record<string, string> = {
    zh: '简体中文',
    en: 'English',
    ja: '日本語',
    ko: '한국어'
  }
  const targetLangName = langMap[targetLang] || '简体中文'

  return `你是一个专业的歌词翻译专家。请将以下歌词逐行翻译成${targetLangName}。

【重要】输入共 ${lineCount} 行，你必须输出恰好 ${lineCount} 行翻译结果！

要求：
1. 严格按照输入格式翻译，每行前面有行号如 "1:" "2:" 等
2. 输出时也必须保留行号，格式为 "行号:翻译内容"
3. 空行输出 "行号:"（冒号后为空）
4. 纯音乐标记输出 "行号:♪"
5. 翻译要自然流畅
6. 只输出翻译结果，不要解释`
}

async function translateWithBuiltinAI(
  texts: string[],
  targetLang: string,
  onProgress?: (lines: string[]) => void
): Promise<string[]> {
  const config = loadAIConfig()

  if (!config.apiKey) {
    throw new Error('请先在设置中配置 AI')
  }

  // 给每行加上行号，确保对齐
  const numberedTexts = texts.map((t, i) => `${i + 1}:${t}`).join('\n')
  const lineCount = texts.length

  const authHeaders: Record<string, string> =
    config.authType === 'api-key'
      ? { 'api-key': config.apiKey }
      : { Authorization: `Bearer ${config.apiKey}` }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: generateTranslationPrompt(targetLang, lineCount) },
        { role: 'user', content: numberedTexts }
      ],
      temperature: 0.3,
      max_tokens: 4000,
      stream: true
    })
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`AI 翻译失败: ${response.status} ${error}`)
  }

  const reader = response.body?.getReader()
  const decoder = new TextDecoder()
  let fullContent = ''

  if (reader) {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value, { stream: true })
      const lines = chunk.split('\n').filter((line) => line.trim().startsWith('data:'))

      for (const line of lines) {
        const data = line.replace('data:', '').trim()
        if (data === '[DONE]') continue

        try {
          const json = JSON.parse(data)
          const delta = json.choices?.[0]?.delta?.content
          if (delta) {
            fullContent += delta
            // 实时解析带行号的结果
            const parsed = parseNumberedLines(fullContent, texts.length)
            onProgress?.(parsed)
          }
        } catch {
          // ignore
        }
      }
    }
  }

  if (!fullContent) {
    throw new Error('翻译结果为空')
  }

  // 解析带行号的翻译结果
  return parseNumberedLines(fullContent, texts.length)
}

// 解析带行号的翻译结果
function parseNumberedLines(content: string, expectedCount: number): string[] {
  const result: string[] = new Array(expectedCount).fill('')
  const lines = content.split('\n')

  for (const line of lines) {
    // 匹配 "数字:" 或 "数字." 或 "数字、" 开头的行
    const match = line.match(/^(\d+)[:.、：]\s*(.*)$/)
    if (match) {
      const lineNum = parseInt(match[1], 10) - 1 // 转为 0-based index
      const text = match[2].trim()
      if (lineNum >= 0 && lineNum < expectedCount) {
        result[lineNum] = text
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
  if (isBilingualLyrics(originalLines)) {
    callbacks?.onError?.('歌词已经是双语，无需翻译')
    throw new Error('歌词已经是双语，无需翻译')
  }

  const textsToTranslate = originalLines.map((l) => l.text)

  // 确定目标语言
  let targetLang = translateConfig.targetLang
  if (targetLang === 'auto') {
    // 自动检测：取前几行歌词检测语言
    const sampleText = textsToTranslate.slice(0, 10).join(' ')
    const sourceLang = detectLanguage(sampleText)
    targetLang = getAutoTargetLang(sourceLang) as TargetLanguage
  }

  try {
    let translatedTexts: string[]

    switch (translateConfig.provider) {
      case 'deeplx':
        if (!translateConfig.deeplxKey) {
          throw new Error('请先配置 DeepLX API Key')
        }
        translatedTexts = await translateWithDeepLX(textsToTranslate, targetLang, translateConfig.deeplxKey)
        break

      case 'google':
        translatedTexts = await translateWithGoogle(textsToTranslate, targetLang)
        break

      case 'builtin-ai':
      default:
        translatedTexts = await translateWithBuiltinAI(textsToTranslate, targetLang, (lines) => {
          const mergedLyrics = mergeLyricsWithTimestamps(originalLines, lines)
          callbacks?.onProgress?.(mergedLyrics)
        })
        break
    }

    const finalLyrics = mergeLyricsWithTimestamps(originalLines, translatedTexts)
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

  // 确定目标语言用于缓存 key
  let targetLang = translateConfig.targetLang
  if (targetLang === 'auto') {
    const originalLines = parseLyricLines(lyrics)
    const sampleText = originalLines
      .slice(0, 10)
      .map((l) => l.text)
      .join(' ')
    const sourceLang = detectLanguage(sampleText)
    targetLang = getAutoTargetLang(sourceLang) as TargetLanguage
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
