import { loadAIConfig } from './AIService'
import { nativeFetch } from '@/utils/nativeFetch'

const INTERPRETATION_CACHE_KEY_PREFIX = 'lyrics_interpretation_'

export interface InterpretationResult {
    songTitle: string
    artist: string
    theme: string // 核心主题
    background: string // 背景故事/情感基调
    keyLines: { line: string; meaning: string }[] // 关键歌词解读
    summary: string // AI 总结
    fullText: string // 完整 Markdown 文本
}

/**
 * 歌词解读服务
 */
export async function interpretLyrics(
    songTitle: string,
    artist: string,
    lyrics: string
): Promise<InterpretationResult> {
    // 1. 检查缓存
    const cacheKey = `${INTERPRETATION_CACHE_KEY_PREFIX}${songTitle}_${artist}`
    const cached = localStorage.getItem(cacheKey)
    if (cached) {
        try {
            return JSON.parse(cached)
        } catch {
            localStorage.removeItem(cacheKey)
        }
    }

    // 2. 准备 AI 请求
    const config = loadAIConfig()
    if (!config.apiKey) {
        throw new Error('请先在 AI 设置中配置 API Key')
    }

    const systemPrompt = `你是一位博学且感性的音乐评论家和文学分析师。
你的任务是为用户深度解读歌词，探讨其背后的情感意境、文学隐喻和潜在的故事背景。

## 解读要求：
1. **深度优先**：不要只停留在字面意思，要挖掘词创作者可能想表达的深层意图。
2. **共情力**：文字要温暖、感性且专业，让用户读完后能对歌曲产生更强烈的共鸣。
3. **结构清晰**：包含核心主题、情感背景、金句赏析和结语。
4. **语言**：始终使用中文进行解读。

## 输出格式 (必须是有效的 JSON)：
{
  "theme": "一句话总结核心主题",
  "background": "情感背景或创作故事推测",
  "keyLines": [
    { "line": "歌词原句", "meaning": "该句的深意解读" }
  ],
  "summary": "给听众的一段感性总结",
  "fullText": "一段优雅的 Markdown 格式全文解读，包含标题、段落和重点加粗"
}`

    const userMessage = `请解读这首歌：
歌名：${songTitle}
歌手：${artist}
歌词：
${lyrics.slice(0, 2000)} // 截取防止超长`

    const authHeaders: Record<string, string> =
        config.authType === 'api-key'
            ? { 'api-key': config.apiKey }
            : { Authorization: `Bearer ${config.apiKey}` }

    const response = await nativeFetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...authHeaders
        },
        body: JSON.stringify({
            model: config.model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage }
            ],
            temperature: 0.7,
            response_format: { type: 'json_object' }
        })
    })

    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`AI 请求失败: ${response.status} ${errorText.slice(0, 100)}`)
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content
    if (!content) throw new Error('AI 返回内容为空')

    try {
        const result = JSON.parse(content) as InterpretationResult
        result.songTitle = songTitle
        result.artist = artist

        // 缓存结果
        localStorage.setItem(cacheKey, JSON.stringify(result))
        return result
    } catch (e) {
        console.error('解析解读结果失败:', e, content)
        throw new Error('AI 返回格式错误，请重试')
    }
}
