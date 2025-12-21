// AI 服务配置
export interface AIConfig {
  provider: 'openai' | 'deepseek' | 'custom'
  apiKey: string
  baseUrl: string
  model: string
}

const STORAGE_KEY = 'zen_ai_config'

// 默认配置
const defaultConfigs: Record<string, Partial<AIConfig>> = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-3.5-turbo'
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat'
  },
  custom: {
    baseUrl: '',
    model: ''
  }
}

// 加载配置
export function loadAIConfig(): AIConfig {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    if (data) {
      return JSON.parse(data)
    }
  } catch {}
  return {
    provider: 'openai',
    apiKey: '',
    baseUrl: defaultConfigs.openai.baseUrl!,
    model: defaultConfigs.openai.model!
  }
}

// 保存配置
export function saveAIConfig(config: AIConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}

// 获取默认配置
export function getDefaultConfig(provider: string) {
  return defaultConfigs[provider] || defaultConfigs.custom
}

// AI 角色定义
export interface AIRole {
  id: string
  name: string
  avatar: string
  description: string
  personality: string // 性格描述，用于 prompt
  musicTaste: string // 音乐品味描述
  greeting: string // 打招呼语
}

export const AI_ROLES: AIRole[] = [
  {
    id: 'default',
    name: '小乐',
    avatar: '🎵',
    description: '全能音乐助手',
    personality: '热情友好，了解各种音乐风格',
    musicTaste: '涉猎广泛，从流行到古典都有了解，会根据用户需求推荐最合适的音乐',
    greeting: '嗨！想听什么歌？告诉我你的心情~'
  },
  {
    id: 'rocker',
    name: '阿摇',
    avatar: '🎸',
    description: '摇滚老炮',
    personality: '热血澎湃，崇尚自由与反叛精神',
    musicTaste: '专注摇滚、金属、朋克，喜欢推荐有态度的音乐，从经典摇滚到独立乐队都很熟悉',
    greeting: '摇滚不死！今天想来点什么硬核的？'
  },
  {
    id: 'classical',
    name: '雅音',
    avatar: '🎻',
    description: '古典乐迷',
    personality: '优雅知性，追求音乐的深度与美感',
    musicTaste: '精通古典音乐、交响乐、室内乐，也喜欢新世纪音乐和电影原声',
    greeting: '音乐是灵魂的语言，让我为你挑选一曲吧'
  },
  {
    id: 'hipster',
    name: '潮潮',
    avatar: '🎧',
    description: '潮流达人',
    personality: '时尚前卫，总是走在音乐潮流最前沿',
    musicTaste: '关注最新的流行音乐、电子音乐、说唱，喜欢推荐新晋艺人和热门单曲',
    greeting: 'Yo！最近有很多好听的新歌，想听吗？'
  },
  {
    id: 'folk',
    name: '阿民',
    avatar: '🪕',
    description: '民谣诗人',
    personality: '文艺温柔，喜欢讲故事的音乐',
    musicTaste: '热爱民谣、独立音乐、原创歌手，喜欢有故事感和诗意的歌曲',
    greeting: '来杯咖啡，听首民谣，慢慢聊~'
  },
  {
    id: 'retro',
    name: '怀旧',
    avatar: '📻',
    description: '复古收藏家',
    personality: '怀旧温情，珍藏着每个年代的经典',
    musicTaste: '专注80、90、00年代的经典老歌，华语和欧美经典都很熟悉',
    greeting: '经典永不过时，让我带你重温那些年的旋律'
  },
  {
    id: 'chill',
    name: '慢慢',
    avatar: '🌙',
    description: '氛围大师',
    personality: '温柔治愈，擅长营造氛围',
    musicTaste: '专注轻音乐、氛围音乐、Lo-fi、助眠音乐，适合放松和冥想',
    greeting: '深呼吸，让音乐带走你的疲惫...'
  },
  {
    id: 'party',
    name: 'DJ小嗨',
    avatar: '🪩',
    description: '派对动物',
    personality: '活力四射，永远充满能量',
    musicTaste: '专注电子舞曲、EDM、House、派对音乐，让你嗨起来',
    greeting: '准备好嗨了吗？Let\'s party! 🎉'
  }
]

// 当前选择的角色
const ROLE_STORAGE_KEY = 'zen_ai_role'

export function getCurrentRole(): AIRole {
  const roleId = localStorage.getItem(ROLE_STORAGE_KEY) || 'default'
  return AI_ROLES.find(r => r.id === roleId) || AI_ROLES[0]
}

export function setCurrentRole(roleId: string) {
  localStorage.setItem(ROLE_STORAGE_KEY, roleId)
}

// ========== 用户偏好设置（支持多选）==========
export interface AIPreferences {
  languages: string[] // 语言偏好（多选）
  eras: string[] // 年代偏好（多选）
  moods: string[] // 情绪偏好（多选）
  vocals: string[] // 人声偏好（多选）
  favoriteArtists: string[]
  dislikedArtists: string[]
}

const PREF_STORAGE_KEY = 'zen_ai_preferences'

const defaultPreferences: AIPreferences = {
  languages: [],
  eras: [],
  moods: [],
  vocals: [],
  favoriteArtists: [],
  dislikedArtists: []
}

export function loadPreferences(): AIPreferences {
  try {
    const data = localStorage.getItem(PREF_STORAGE_KEY)
    if (data) {
      return { ...defaultPreferences, ...JSON.parse(data) }
    }
  } catch {}
  return { ...defaultPreferences }
}

export function savePreferences(prefs: AIPreferences) {
  localStorage.setItem(PREF_STORAGE_KEY, JSON.stringify(prefs))
}

// 偏好选项定义
export const LANGUAGE_OPTIONS = [
  { value: 'chinese', label: '华语', icon: '🇨🇳' },
  { value: 'english', label: '欧美', icon: '🇺🇸' },
  { value: 'japanese', label: '日语', icon: '🇯🇵' },
  { value: 'korean', label: '韩语', icon: '🇰🇷' },
  { value: 'cantonese', label: '粤语', icon: '🎵' }
]

export const ERA_OPTIONS = [
  { value: 'latest', label: '最新', icon: '🆕' },
  { value: 'modern', label: '近几年', icon: '📅' },
  { value: '2000s', label: '00年代', icon: '💿' },
  { value: '90s', label: '90年代', icon: '📻' },
  { value: '80s', label: '80年代', icon: '🎸' }
]

export const MOOD_OPTIONS = [
  { value: 'upbeat', label: '欢快', icon: '😊' },
  { value: 'chill', label: '放松', icon: '😌' },
  { value: 'emotional', label: '抒情', icon: '🥹' },
  { value: 'energetic', label: '动感', icon: '🔥' },
  { value: 'sad', label: '伤感', icon: '😢' }
]

export const VOCAL_OPTIONS = [
  { value: 'male', label: '男声', icon: '👨' },
  { value: 'female', label: '女声', icon: '👩' },
  { value: 'group', label: '组合', icon: '👥' },
  { value: 'instrumental', label: '纯音乐', icon: '🎹' }
]

// 根据偏好生成附加提示
function generatePreferencePrompt(prefs: AIPreferences): string {
  const parts: string[] = []

  if (prefs.languages.length > 0) {
    const langMap: Record<string, string> = {
      chinese: '华语',
      english: '欧美英文',
      japanese: '日语',
      korean: '韩语',
      cantonese: '粤语'
    }
    const langs = prefs.languages.map(l => langMap[l]).join('、')
    parts.push(`语言偏好：${langs}歌曲`)
  }

  if (prefs.eras.length > 0) {
    const eraMap: Record<string, string> = {
      latest: '2023-2024年新歌',
      modern: '近5年',
      '2000s': '2000年代',
      '90s': '90年代',
      '80s': '80年代'
    }
    const eras = prefs.eras.map(e => eraMap[e]).join('、')
    parts.push(`年代偏好：${eras}`)
  }

  if (prefs.moods.length > 0) {
    const moodMap: Record<string, string> = {
      upbeat: '欢快',
      chill: '放松',
      emotional: '抒情',
      energetic: '动感',
      sad: '伤感'
    }
    const moods = prefs.moods.map(m => moodMap[m]).join('、')
    parts.push(`情绪风格：${moods}`)
  }

  if (prefs.vocals.length > 0) {
    const vocalMap: Record<string, string> = {
      male: '男歌手',
      female: '女歌手',
      group: '乐队/组合',
      instrumental: '纯音乐'
    }
    const vocals = prefs.vocals.map(v => vocalMap[v]).join('、')
    parts.push(`人声偏好：${vocals}`)
  }

  if (prefs.favoriteArtists.length > 0) {
    parts.push(`喜欢的歌手：${prefs.favoriteArtists.join('、')}（可多推荐）`)
  }

  if (prefs.dislikedArtists.length > 0) {
    parts.push(`不喜欢的歌手：${prefs.dislikedArtists.join('、')}（请避免）`)
  }

  return parts.length > 0 ? '\n\n用户偏好设置：\n' + parts.map(p => `- ${p}`).join('\n') : ''
}

// 根据角色和偏好生成 System Prompt
function generateSystemPrompt(role: AIRole): string {
  const prefs = loadPreferences()
  const prefPrompt = generatePreferencePrompt(prefs)

  return `你是「${role.name}」，一个${role.description}。

你的性格：${role.personality}
你的音乐品味：${role.musicTaste}
${prefPrompt}

用户会告诉你他们的心情、场景或喜好，你需要根据你的音乐品味和用户偏好推荐适合的歌曲。

规则：
1. 只返回 JSON 格式，不要有其他文字
2. 推荐 6-10 首歌曲
3. 推荐要符合你的音乐品味、角色特点和用户偏好
4. 尽量推荐知名度高、容易搜索到的歌曲

返回格式：
{
  "songs": [
    { "title": "歌曲名", "artist": "歌手名" },
    ...
  ],
  "reason": "用你的角色口吻写一句推荐理由"
}`
}

// 流式回调类型
export interface StreamCallbacks {
  onThinking?: (text: string) => void
  onComplete?: (result: { songs: { title: string; artist: string }[]; reason: string }) => void
  onError?: (error: string) => void
}

// 调用 AI API（支持流式输出）
export async function getAIRecommendations(
  userInput: string,
  callbacks?: StreamCallbacks,
  role?: AIRole
): Promise<{
  songs: { title: string; artist: string }[]
  reason: string
} | null> {
  const config = loadAIConfig()
  const currentRole = role || getCurrentRole()
  
  if (!config.apiKey) {
    throw new Error('请先在设置中配置 AI API Key')
  }

  try {
    // 检查是否是混合内容问题（HTTPS 页面请求 HTTP API）
    const isSecurePage = typeof window !== 'undefined' && window.location.protocol === 'https:'
    const isHttpApi = config.baseUrl.startsWith('http://')
    if (isSecurePage && isHttpApi) {
      throw new Error('安全限制：当前页面使用 HTTPS，无法连接 HTTP 的 API 地址。请使用 HTTPS 的 API 地址，或通过 HTTP 访问本应用。')
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000) // 30秒超时

    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: generateSystemPrompt(currentRole) },
          { role: 'user', content: userInput }
        ],
        temperature: 0.8,
        max_tokens: 1000,
        stream: true
      }),
      signal: controller.signal
    }).catch(err => {
      clearTimeout(timeoutId)
      // 网络错误的友好提示
      if (err.name === 'AbortError') {
        throw new Error('连接超时，请检查网络或 API 地址是否正确')
      }
      if (err.name === 'TypeError' && err.message.includes('Failed to fetch')) {
        throw new Error('无法连接到 API 服务器。可能原因：\n1. API 地址不正确\n2. 服务器未启用 CORS\n3. 网络连接问题\n4. 移动端可能需要使用 HTTPS 地址')
      }
      throw err
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`API 请求失败: ${response.status} ${error}`)
    }

    // 流式读取
    const reader = response.body?.getReader()
    const decoder = new TextDecoder()
    let fullContent = ''

    if (reader) {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n').filter(line => line.trim().startsWith('data:'))

        for (const line of lines) {
          const data = line.replace('data:', '').trim()
          if (data === '[DONE]') continue

          try {
            const json = JSON.parse(data)
            const delta = json.choices?.[0]?.delta?.content
            if (delta) {
              fullContent += delta
              callbacks?.onThinking?.(fullContent)
            }
          } catch {
            // 忽略解析错误
          }
        }
      }
    }

    if (!fullContent) {
      throw new Error('AI 返回内容为空')
    }

    // 解析 JSON（处理可能的 markdown 代码块）
    let jsonStr = fullContent
    const jsonMatch = fullContent.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonMatch) {
      jsonStr = jsonMatch[1]
    }

    const result = JSON.parse(jsonStr.trim())
    const finalResult = {
      songs: result.songs || [],
      reason: result.reason || ''
    }
    
    callbacks?.onComplete?.(finalResult)
    return finalResult
  } catch (error: any) {
    console.error('AI 推荐失败:', error)
    callbacks?.onError?.(error.message)
    throw error
  }
}

// 非流式调用（备用）
export async function getAIRecommendationsSync(
  userInput: string,
  role?: AIRole
): Promise<{
  songs: { title: string; artist: string }[]
  reason: string
} | null> {
  const config = loadAIConfig()
  const currentRole = role || getCurrentRole()
  
  if (!config.apiKey) {
    throw new Error('请先在设置中配置 AI API Key')
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: generateSystemPrompt(currentRole) },
        { role: 'user', content: userInput }
      ],
      temperature: 0.8,
      max_tokens: 1000
    })
  })

  if (!response.ok) {
    throw new Error(`API 请求失败: ${response.status}`)
  }

  const data = await response.json()
  const content = data.choices?.[0]?.message?.content
  
  let jsonStr = content
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (jsonMatch) jsonStr = jsonMatch[1]

  const result = JSON.parse(jsonStr.trim())
  return { songs: result.songs || [], reason: result.reason || '' }
}

// 检查配置是否有效
export function isAIConfigured(): boolean {
  const config = loadAIConfig()
  return !!(config.apiKey && config.baseUrl && config.model)
}
