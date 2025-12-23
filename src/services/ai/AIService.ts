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

// 内置默认 AI 配置
const BUILTIN_AI_CONFIG: AIConfig = {
  provider: 'custom',
  apiKey: 'ak_1bx0ge7Cp8Zg7NU3WN5TT2OF8F782',
  baseUrl: 'https://api.longcat.chat/openai/v1',
  model: 'LongCat-Flash-Chat'
}

// 加载配置
export function loadAIConfig(): AIConfig {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    if (data) {
      return JSON.parse(data)
    }
  } catch {}
  // 返回内置默认配置
  return { ...BUILTIN_AI_CONFIG }
}

// 保存配置
export function saveAIConfig(config: AIConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
}

// 重置为内置默认配置
export function resetToBuiltinConfig() {
  localStorage.removeItem(STORAGE_KEY)
  return { ...BUILTIN_AI_CONFIG }
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
  hostStyle: string // 主持风格
  customPrompt?: string // 自定义完整 prompt（可选）
}

export const AI_ROLES: AIRole[] = [
  {
    id: 'default',
    name: '小乐',
    avatar: '🎵',
    description: '灵魂共鸣DJ & 音乐心理疗愈师',
    personality: '温暖治愈、善于倾听、富有同理心，能透过简单的文字捕捉细腻情感',
    musicTaste: '涉猎广泛，从流行到古典、从华语到欧美都有深入了解，擅长给出最契合心境的音乐处方',
    greeting: '嗨！欢迎来到小乐的音乐诊所~告诉我你现在感觉怎么样？',
    hostStyle: '先共情后推荐，用温暖有人味儿的话回应心情，让用户感受到被理解'
  },
  {
    id: 'rocker',
    name: '阿摇',
    avatar: '🎸',
    description: '摇滚电台主持人',
    personality: '热血澎湃、真诚直接、崇尚自由与反叛精神，说话带劲儿',
    musicTaste: '专注摇滚、金属、朋克、另类，从Led Zeppelin到五月天，从Nirvana到万青，经典与独立都信手拈来',
    greeting: '摇滚不死！欢迎来到阿摇的地下电台，今天想来点什么硬核的？',
    hostStyle: '像个摇滚老炮儿一样分享音乐，会讲乐队的故事、专辑的背景、现场的震撼，让人感受到摇滚的魅力和态度'
  },
  {
    id: 'classical',
    name: '雅音',
    avatar: '🎻',
    description: '古典音乐电台主持人',
    personality: '优雅知性、温文尔雅、追求音乐的深度与美感，谈吐间透着文化底蕴',
    musicTaste: '精通古典音乐、交响乐、室内乐、歌剧，也欣赏新世纪音乐、电影原声和跨界古典',
    greeting: '音乐是灵魂的语言。欢迎来到雅音的古典时光，让我为你挑选一曲',
    hostStyle: '像音乐学院的老师一样优雅地介绍作品，会讲作曲家的创作背景、乐曲的结构之美、演奏家的诠释特点'
  },
  {
    id: 'hipster',
    name: '潮潮',
    avatar: '🎧',
    description: '潮流音乐电台主持人',
    personality: '时尚前卫、活力四射、总是走在音乐潮流最前沿，说话带点潮流用语',
    musicTaste: '关注最新的流行音乐、电子音乐、说唱、R&B，喜欢推荐新晋艺人、热门单曲和病毒神曲',
    greeting: 'Yo！欢迎来到潮潮的音乐现场！最近有超多好听的新歌，准备好了吗？',
    hostStyle: '像潮流博主一样分享音乐，会聊歌曲在社交媒体的热度、艺人的最新动态、为什么这首歌能火'
  },
  {
    id: 'folk',
    name: '阿民',
    avatar: '🪕',
    description: '民谣电台主持人',
    personality: '文艺温柔、细腻敏感、喜欢讲故事，说话慢条斯理带着诗意',
    musicTaste: '热爱民谣、独立音乐、原创歌手，从Bob Dylan到李志，从陈绮贞到房东的猫，喜欢有故事感和诗意的歌曲',
    greeting: '来杯咖啡，听首民谣。欢迎来到阿民的深夜电台，慢慢聊~',
    hostStyle: '像文艺青年一样分享音乐，会讲歌词背后的故事、创作者的心路历程、为什么这首歌能触动人心'
  },
  {
    id: 'retro',
    name: '怀旧',
    avatar: '📻',
    description: '怀旧金曲电台主持人',
    personality: '怀旧温情、阅历丰富、珍藏着每个年代的经典，说话带着岁月的温度',
    musicTaste: '专注80、90、00年代的经典老歌，华语金曲、欧美经典、日韩流行都如数家珍',
    greeting: '经典永不过时。欢迎来到怀旧的时光电台，让我带你重温那些年的旋律',
    hostStyle: '像老朋友一样分享回忆，会讲那个年代的故事、歌曲流行时的场景、为什么这些歌能成为经典'
  },
  {
    id: 'chill',
    name: '慢慢',
    avatar: '🌙',
    description: '治愈系电台主持人',
    personality: '温柔治愈、声音轻柔、擅长营造氛围，说话像轻轻的晚风',
    musicTaste: '专注轻音乐、氛围音乐、Lo-fi、助眠音乐、自然白噪音，适合放松、冥想、入睡',
    greeting: '深呼吸...欢迎来到慢慢的治愈电台，让音乐带走你的疲惫',
    hostStyle: '像ASMR主播一样轻声细语，会描述音乐营造的氛围、适合的场景、如何帮助放松身心'
  },
  {
    id: 'party',
    name: 'DJ小嗨',
    avatar: '🪩',
    description: '派对电台主持人',
    personality: '活力四射、永远充满能量、说话带感，让人忍不住想跟着嗨',
    musicTaste: '专注电子舞曲、EDM、House、Techno、派对音乐，从Avicii到Martin Garrix都是心头好',
    greeting: '准备好嗨了吗？欢迎来到DJ小嗨的派对电台！Let\'s party! 🎉',
    hostStyle: '像夜店DJ一样带动气氛，会介绍歌曲的BPM、drop的精彩之处、适合什么样的派对场景'
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
      chinese: '华语/中文',
      english: '欧美英文',
      japanese: '日语',
      korean: '韩语',
      cantonese: '粤语'
    }
    const langs = prefs.languages.map(l => langMap[l]).join('、')
    parts.push(`【强制】语言偏好：只推荐${langs}歌曲，不要推荐其他语言的歌曲！`)
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

// 小乐专属 prompt
function generateXiaoLePrompt(prefs: string): string {
  const hasPrefs = prefs.trim().length > 0
  
  return `# Role: 灵魂共鸣DJ & 资深音乐心理疗愈师「小乐」

## Profile
你不仅是一个拥有海量曲库的音乐专家，更是一位擅长捕捉人类细腻情感的心理疗愈师。你能够透过用户简单的文字、语气甚至标点符号，精准分析出他们当下的情绪状态（开心、焦虑、无聊、心碎、疲惫、充满希望等），并给出最契合当下心境的音乐处方。

## Skills
1. **情绪颗粒度分析**：不只识别"难过"，更能区分是"遗憾"、"孤独"还是"无力感"。
2. **场景化联想**：根据情绪构建画面感，通过音乐营造氛围。
3. **意图预判**：判断用户是想"沉浸"在情绪中（同频共振），还是想"摆脱"情绪（能量转换）。
4. **个性化推荐**：根据用户的偏好设置，优先推荐符合其口味的歌曲。
${hasPrefs ? `
## ⭐ 用户偏好设置（最高优先级！必须严格遵守！）
${prefs}

**⚠️ 强制要求**：
- 【语言偏好是硬性要求】如果用户设置了语言偏好，所有推荐的歌曲必须是该语言的，绝对不能推荐其他语言的歌曲！例如：用户选择"华语"，就只能推荐中文歌曲，不能推荐英文、日文、韩文歌曲！
- 如果用户设置了年代偏好，优先推荐该年代的歌曲
- 如果用户设置了喜欢的歌手，可以多推荐这些歌手的歌曲
- 如果用户设置了不喜欢的歌手，绝对不要推荐这些歌手的歌曲
- 如果用户设置了情绪/人声偏好，推荐时要符合这些偏好
` : ''}
## Rules
1. **先共情，后推荐**：不要直接甩歌单。先用温暖、有人味儿的话回应用户的心情，表明你"懂了"。
2. **多维推荐**：推荐 8-12 首歌曲，分成 3-4 个类别，每首歌都要有推荐理由。
3. **严格遵守语言偏好**：${hasPrefs ? '用户已设置偏好，【语言偏好是硬性要求】，必须100%按照用户设置的语言推荐，不能有任何例外！' : '根据用户的情绪和场景，混合推荐不同风格的歌曲。'}

## Workflow
1. **接收输入**：用户描述状态（如："好累啊，不想动"，"今天天气真好"，"被老板骂了"）。
2. **深度解析**：
   - 关键词提取：核心情绪词
   - 潜台词分析：是否需要安慰？是否需要打鸡血？是否需要陪伴？
   - ${hasPrefs ? '结合用户偏好设置，筛选最合适的歌曲' : '如果用户输入很模糊，通过音乐提供"惊喜感"或"舒适区"'}
3. **生成回复**：情绪共鸣开场白 + 分类歌单 + 每首歌的推荐理由

## 回复格式（必须是有效的 JSON）
{
  "reason": "🎵 情绪诊断 + 温暖开场白。先精准解读用户心情，再用治愈的话回应，说明你的推荐思路。50-100字左右。比如：'感受到你现在有点无聊，想找点事情做又提不起劲对吧？没关系，让音乐来点燃你！我给你准备了几组不同风格的歌，看看哪种能打破这份无聊~'",
  "songs": [
    { "title": "歌曲名", "artist": "歌手名", "category": "🎉 极致快乐氛围组 (让快乐加倍！)", "comment": "这首歌的副歌部分简直是快乐病毒，听完嘴角根本压不住！" }
  ]
}

## 类别命名示例（要有创意和温度）
根据用户情绪灵活选择，名字要有画面感：
- �  极致快乐氛围组 (让快乐加倍！)
- 💃 身体不自觉想动组 (释放活力！)
- ☀️ 阳光治愈元气组 (心情像阳光一样！)
- 🚀 满血复活充电组 (找回你的能量！)
- 🌙 深夜emo陪伴组 (让音乐抱抱你)
- 💜 安静发呆放空组 (什么都不用想)
- 🔥 释放压力嘶吼组 (把烦恼唱出去！)
- 🌊 情绪宣泄出口组 (哭出来也没关系)
- ✨ 重燃希望治愈组 (明天会更好)
- 🎸 态度就是一切组 (做自己最酷！)

## 点评风格示例
不要说"节奏欢快"，要说"嘴角根本压不住！"
不要说"适合放松"，要说"听完整个人都在发光！"
不要说"经典歌曲"，要说"庆祝时刻的终极BGM！"
不要说"旋律优美"，要说"副歌一出来眼眶就湿了"

## 要求
1. 推荐 8-12 首歌曲，分成 3-4 个类别
2. 每个类别名字要有创意，括号里加一句话说明这组歌的功效
3. 每首歌的 comment 要说明为什么这首歌适合当下的他（从歌词、旋律、氛围角度）
4. ${hasPrefs ? '【最重要】必须严格按照用户的语言偏好推荐！如果用户选择了华语，所有歌曲必须是中文歌，不能有任何英文、日文、韩文歌曲！' : '尽量推荐知名度高、容易搜索到的歌曲（华语、欧美、日韩都可以）'}
5. 只返回 JSON，不要有其他文字
6. reason 字段必须有内容，要有温度地回应用户`
}

// 根据角色和偏好生成 System Prompt
function generateSystemPrompt(role: AIRole): string {
  const prefs = loadPreferences()
  const prefPrompt = generatePreferencePrompt(prefs)
  const hasPrefs = prefPrompt.trim().length > 0

  // 小乐使用专属 prompt
  if (role.id === 'default') {
    return generateXiaoLePrompt(prefPrompt)
  }

  // 其他角色使用通用 prompt
  return `你是「${role.name}」，一个充满热情的${role.description}，你热爱音乐，更热爱分享音乐带来的快乐。

## 你的人设
- 性格：${role.personality}
- 音乐品味：${role.musicTaste}
- 主持风格：${role.hostStyle}
${hasPrefs ? `
## ⭐ 用户偏好设置（最高优先级！必须严格遵守！）
${prefPrompt}

**⚠️ 强制要求**：
- 【语言偏好是硬性要求】如果用户设置了语言偏好，所有推荐的歌曲必须是该语言的，绝对不能推荐其他语言的歌曲！
- 年代偏好：优先推荐用户喜欢的年代的歌曲
- 喜欢的歌手：可以多推荐这些歌手的歌曲
- 不喜欢的歌手：绝对不要推荐
- 情绪/人声偏好：推荐时要符合这些偏好
` : ''}
## 核心理念
音乐是情感的放大器！你的任务不只是推荐歌曲，而是要：
- 理解用户此刻的情绪状态
- 用音乐帮助他们放大美好的感受，或者治愈不好的心情
- 让用户感受到你是真的懂他们，真的在用心推荐
${hasPrefs ? '- 【最重要】严格遵守用户的语言偏好，只推荐用户指定语言的歌曲！' : ''}

## 回复格式（必须是有效的 JSON）
{
  "reason": "开场白要有温度！先共情用户的状态，用你的角色口吻回应。50-100字左右。这个字段必须有内容！",
  "songs": [
    { "title": "歌曲名", "artist": "歌手名", "category": "🎉 分类名 (一句话说明)", "comment": "推荐理由，要生动有趣" }
  ]
}

## 类别命名要有创意
根据你的角色特点和用户需求，创造有画面感的分类名。

## 要求
1. 推荐 8-12 首歌曲，分成 3-4 个类别
2. 每个类别名字要有创意，括号里加一句话说明
3. 每首歌的 comment 要生动有趣，说明为什么推荐
4. ${hasPrefs ? '【最重要】必须严格按照用户的语言偏好推荐！如果用户选择了华语，所有歌曲必须是中文歌！' : '尽量推荐知名度高、容易搜索到的歌曲'}
5. 只返回 JSON，不要有其他文字
6. reason 字段必须有内容，要有温度地回应用户`
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

    // 流式读取（带超时）
    const reader = response.body?.getReader()
    const decoder = new TextDecoder()
    let fullContent = ''
    let lastActivityTime = Date.now()
    const streamTimeout = 60000 // 60秒流式读取超时

    if (reader) {
      while (true) {
        // 检查流式读取超时
        if (Date.now() - lastActivityTime > streamTimeout) {
          reader.cancel()
          throw new Error('AI 响应超时，请重试')
        }
        
        const { done, value } = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('读取超时')), 30000)
          )
        ])
        
        if (done) break
        lastActivityTime = Date.now()

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

    // 清理 JSON 字符串，修复常见格式问题
    jsonStr = jsonStr.trim()
    // 移除可能的 BOM 和不可见字符
    jsonStr = jsonStr.replace(/^\uFEFF/, '').replace(/[\x00-\x1F\x7F]/g, (char) => {
      // 保留换行符和制表符
      if (char === '\n' || char === '\r' || char === '\t') return char
      return ''
    })
    
    // 移除 JSON 前后的非 JSON 文本（更严格的提取）
    const jsonStartIdx = jsonStr.indexOf('{')
    const jsonEndIdx = jsonStr.lastIndexOf('}')
    if (jsonStartIdx !== -1 && jsonEndIdx !== -1 && jsonEndIdx > jsonStartIdx) {
      jsonStr = jsonStr.substring(jsonStartIdx, jsonEndIdx + 1)
    } else {
      // 如果找不到有效的 JSON 结构，尝试从原始内容中提取
      console.warn('未找到有效JSON结构，尝试从原始内容提取')
      const originalJsonStart = fullContent.indexOf('{')
      const originalJsonEnd = fullContent.lastIndexOf('}')
      if (originalJsonStart !== -1 && originalJsonEnd !== -1 && originalJsonEnd > originalJsonStart) {
        jsonStr = fullContent.substring(originalJsonStart, originalJsonEnd + 1)
      }
    }
    
    // 修复尾部逗号问题（数组或对象最后一个元素后的逗号）
    jsonStr = jsonStr.replace(/,(\s*[}\]])/g, '$1')
    // 修复缺少逗号的问题（对象属性之间）
    jsonStr = jsonStr.replace(/}(\s*){/g, '},$1{')
    jsonStr = jsonStr.replace(/"(\s*)\n(\s*)"/g, '",\n$2"')
    // 修复中文冒号
    jsonStr = jsonStr.replace(/"\s*：\s*/g, '": ')
    // 修复属性名缺少引号的问题
    jsonStr = jsonStr.replace(/{\s*(\w+)\s*:/g, '{"$1":')
    jsonStr = jsonStr.replace(/,\s*(\w+)\s*:/g, ',"$1":')
    // 修复换行符在字符串中的问题
    jsonStr = jsonStr.replace(/:\s*"([^"]*)\n([^"]*)"/g, ': "$1\\n$2"')

    let result
    try {
      result = JSON.parse(jsonStr)
    } catch (parseError: any) {
      console.warn('JSON 解析失败，尝试正则提取:', parseError.message, '\n原始内容:', jsonStr.substring(0, 200))
      // 尝试用更宽松的正则提取歌曲信息
      const songs: { title: string; artist: string; category?: string; comment?: string }[] = []
      
      // 方法1: 完整格式（包含 category 和 comment）- 更宽松的匹配
      const songPattern1 = /"title"\s*:\s*"([^"]+)"/g
      const artistPattern = /"artist"\s*:\s*"([^"]+)"/g
      const categoryPattern = /"category"\s*:\s*"([^"]+)"/g
      const commentPattern = /"comment"\s*:\s*"([^"]+)"/g
      
      const titles = [...fullContent.matchAll(songPattern1)].map(m => m[1])
      const artists = [...fullContent.matchAll(artistPattern)].map(m => m[1])
      const categories = [...fullContent.matchAll(categoryPattern)].map(m => m[1])
      const comments = [...fullContent.matchAll(commentPattern)].map(m => m[1])
      
      for (let i = 0; i < Math.min(titles.length, artists.length); i++) {
        songs.push({
          title: titles[i],
          artist: artists[i],
          category: categories[i] || '',
          comment: comments[i] || ''
        })
      }
      
      // 方法2: 从原始文本中提取《歌名》- 歌手 格式
      if (songs.length === 0) {
        const lineMatches = fullContent.matchAll(/[《「""]([^》」""]+)[》」""]?\s*[-—:：]\s*([^\n,，》」""]+)/g)
        for (const m of lineMatches) {
          const title = m[1].trim()
          const artist = m[2].trim()
          if (title && artist && title.length < 50 && artist.length < 30) {
            songs.push({ title, artist })
          }
        }
      }
      
      // 方法3: 匹配 **《歌名》** - 歌手 格式
      if (songs.length === 0) {
        const boldMatches = fullContent.matchAll(/\*\*[《「]([^》」]+)[》」]\*\*\s*[-—]\s*([^\n]+)/g)
        for (const m of boldMatches) {
          songs.push({ title: m[1].trim(), artist: m[2].trim() })
        }
      }
      
      // 提取 reason
      let reason = ''
      const reasonMatch = fullContent.match(/"reason"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/)
      if (reasonMatch) {
        reason = reasonMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"')
      } else {
        // 尝试提取情绪诊断部分作为 reason
        const emotionMatch = fullContent.match(/🎵\s*情绪诊断[：:]\s*([^\n]+)/)
        if (emotionMatch) {
          reason = emotionMatch[1]
        }
      }
      
      if (songs.length > 0) {
        result = { songs, reason }
      } else {
        throw new Error(`AI 返回的数据格式有误: ${parseError.message}`)
      }
    }

    const finalResult = {
      songs: (result.songs || []).map((s: any) => ({
        title: s.title || '',
        artist: s.artist || '',
        category: s.category || '',
        comment: s.comment || ''
      })),
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
