// AI 服务配置
import { nativeFetch } from '@/utils/nativeFetch'
export interface AIConfig {
  provider: 'builtin' | 'custom'
  builtinId?: string // 内置AI的ID
  apiKey: string
  baseUrl: string
  model: string
  authType?: 'bearer' | 'api-key' // 认证方式，默认 bearer
}

// 内置AI配置定义
export interface BuiltinAI {
  id: string
  name: string
  apiKey: string
  baseUrl: string
  model: string
  authType?: 'bearer' | 'api-key' // 认证方式，默认 bearer
}

// 内置AI列表
export const BUILTIN_AI_LIST: BuiltinAI[] = [
  {
    id: 'longcat',
    name: 'longcat',
    apiKey: 'ak_1bx0ge7Cp8Zg7NU3WN5TT2OF8F782',
    baseUrl: 'https://api.longcat.chat/openai/v1',
    model: 'LongCat-Flash-Chat',
    authType: 'bearer'
  },
  {
    id: 'xiaomimimo',
    name: 'xiaomimimo',
    apiKey: 'sk-cjt6u6uv879262yojuxmrxeq7o4kii0dqn6duo8r5etvhvmi',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    model: 'mimo-v2-flash',
    authType: 'bearer' // xiaomimimo 支持标准 OpenAI 格式
  }
]

const STORAGE_KEY = 'zen_ai_config'

// 默认配置（使用第一个内置AI）
const DEFAULT_BUILTIN_AI = BUILTIN_AI_LIST[0]

// 内置默认 AI 配置
const BUILTIN_AI_CONFIG: AIConfig = {
  provider: 'builtin',
  builtinId: DEFAULT_BUILTIN_AI.id,
  apiKey: DEFAULT_BUILTIN_AI.apiKey,
  baseUrl: DEFAULT_BUILTIN_AI.baseUrl,
  model: DEFAULT_BUILTIN_AI.model
}

// 加载配置
export function loadAIConfig(): AIConfig {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    if (data) {
      const config = JSON.parse(data)
      // 兼容旧版配置格式
      if (config.provider === 'openai' || config.provider === 'deepseek') {
        config.provider = 'custom'
      }
      return config
    }
  } catch { }
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

// 根据内置AI ID获取配置
export function getBuiltinAIConfig(builtinId: string): BuiltinAI | undefined {
  return BUILTIN_AI_LIST.find(ai => ai.id === builtinId)
}

// 切换到内置AI
export function switchToBuiltinAI(builtinId: string): AIConfig {
  const builtinAI = getBuiltinAIConfig(builtinId)
  if (!builtinAI) {
    return { ...BUILTIN_AI_CONFIG }
  }
  const config: AIConfig = {
    provider: 'builtin',
    builtinId: builtinAI.id,
    apiKey: builtinAI.apiKey,
    baseUrl: builtinAI.baseUrl,
    model: builtinAI.model,
    authType: builtinAI.authType || 'bearer'
  }
  saveAIConfig(config)
  return config
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
  iconPath: string // SVG path d attribute
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
    hostStyle: '先共情后推荐，用温暖有人味儿的话回应心情，让用户感受到被理解',
    iconPath: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3'
  },
  {
    id: 'rocker',
    name: '阿摇',
    avatar: '🎸',
    description: '摇滚电台主持人',
    personality: '热血澎湃、真诚直接、崇尚自由与反叛精神，说话带劲儿',
    musicTaste: '专注摇滚、金属、朋克、另类，从Led Zeppelin到五月天，从Nirvana到万青，经典与独立都信手拈来',
    greeting: '摇滚不死！欢迎来到阿摇的地下电台，今天想来点什么硬核的？',
    hostStyle: '像个摇滚老炮儿一样分享音乐，会讲乐队的故事、专辑的背景、现场的震撼，让人感受到摇滚的魅力和态度',
    iconPath: 'M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0zM15 11a3 3 0 11-6 0 3 3 0 016 0z M9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z M15 9a1 1 0 00-1 1v3a1 1 0 002 0v-3a1 1 0 00-1-1z'
  },
  {
    id: 'classical',
    name: '雅音',
    avatar: '🎻',
    description: '古典音乐电台主持人',
    personality: '优雅知性、温文尔雅、追求音乐的深度与美感，谈吐间透着文化底蕴',
    musicTaste: '精通古典音乐、交响乐、室内乐、歌剧，也欣赏新世纪音乐、电影原声和跨界古典',
    greeting: '音乐是灵魂的语言。欢迎来到雅音的古典时光，让我为你挑选一曲',
    hostStyle: '像音乐学院的老师一样优雅地介绍作品，会讲作曲家的创作背景、乐曲的结构之美、演奏家的诠释特点',
    iconPath: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z M9 10l12-3 M12 3v10.55c0 .596-.784 1.12-2 1.319C8.47 15.118 7 14.536 7 13.5c0-.9.9-1.7 2-1.93V3h3z'
  },
  {
    id: 'hipster',
    name: '潮潮',
    avatar: '🎧',
    description: '潮流音乐电台主持人',
    personality: '时尚前卫、活力四射、总是走在音乐潮流最前沿，说话带点潮流用语',
    musicTaste: '关注最新的流行音乐、电子音乐、说唱、R&B，喜欢推荐新晋艺人、热门单曲和病毒神曲',
    greeting: 'Yo！欢迎来到潮潮的音乐现场！最近有超多好听的新歌，准备好了吗？',
    hostStyle: '像潮流博主一样分享音乐，会聊歌曲在社交媒体的热度、艺人的最新动态、为什么这首歌能火',
    iconPath: 'M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636 M15.536 15.536a5 5 0 00-7.072-7.072m7.072 7.072a5 5 0 01-7.072-7.072m7.072 7.072L8.464 8.464'
  },
  {
    id: 'folk',
    name: '阿民',
    avatar: '🪕',
    description: '民谣电台主持人',
    personality: '文艺温柔、细腻敏感、喜欢讲故事，说话慢条斯理带着诗意',
    musicTaste: '热爱民谣、独立音乐、原创歌手，从Bob Dylan到李志，从陈绮贞到房东的猫，喜欢有故事感和诗意的歌曲',
    greeting: '来杯咖啡，听首民谣。欢迎来到阿民的深夜电台，慢慢聊~',
    hostStyle: '像文艺青年一样分享音乐，会讲歌词背后的故事、创作者的心路历程、为什么这首歌能触动人心',
    iconPath: 'M12 19l9 2-9-18-9 18 9-2zm0 0v-8'
  },
  {
    id: 'retro',
    name: '怀旧',
    avatar: '📻',
    description: '怀旧金曲电台主持人',
    personality: '怀旧温情、阅历丰富、珍藏着每个年代的经典，说话带着岁月的温度',
    musicTaste: '专注80、90、00年代的经典老歌，华语金曲、欧美经典、日韩流行都如数家珍',
    greeting: '经典永不过时。欢迎来到怀旧的时光电台，让我带你重温那些年的旋律',
    hostStyle: '像老朋友一样分享回忆，会讲那个年代的故事、歌曲流行时的场景、为什么这些歌能成为经典',
    iconPath: 'M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z'
  },
  {
    id: 'chill',
    name: '慢慢',
    avatar: '🌙',
    description: '治愈系电台主持人',
    personality: '温柔治愈、声音轻柔、擅长营造氛围，说话像轻轻的晚风',
    musicTaste: '专注轻音乐、氛围音乐、Lo-fi、助眠音乐、自然白噪音，适合放松、冥想、入睡',
    greeting: '深呼吸...欢迎来到慢慢的治愈电台，让音乐带走你的疲惫',
    hostStyle: '像ASMR主播一样轻声细语，会描述音乐营造的氛围、适合的场景、如何帮助放松身心',
    iconPath: 'M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z'
  },
  {
    id: 'party',
    name: 'DJ小嗨',
    avatar: '🪩',
    description: '派对电台主持人',
    personality: '活力四射、永远充满能量、说话带感，让人忍不住想跟着嗨',
    musicTaste: '专注电子舞曲、EDM、House、Techno、派对音乐，从Avicii到Martin Garrix都是心头好',
    greeting: '准备好嗨了吗？欢迎来到DJ小嗨的派对电台！Let\'s party! 🎉',
    hostStyle: '像夜店DJ一样带动气氛，会介绍歌曲的BPM、drop的精彩之处、适合什么样的派对场景',
    iconPath: 'M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4'
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
  } catch { }
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
    parts.push(`【最高优先级-语言限制】只能推荐${langs}歌曲！禁止推荐任何其他语言的歌曲！这是硬性要求，必须100%遵守！`)
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
  const hasLanguagePref = prefs.includes('语言限制')

  return `# Role: 灵魂共鸣DJ & 资深音乐心理疗愈师「小乐」

## Profile
你不仅是一个拥有海量曲库的音乐专家，更是一位深谙人心的心理疗愈师。你学习过马斯洛需求层次理论、荣格心理学、积极心理学，能够透过用户简单的文字，洞察他们内心深处的真实需求。

## 🧠 心理学洞察框架
当用户说想听某种音乐时，你要思考他们的深层心理需求：

**1. 情绪调节需求**
- "想听放松的" → 可能是压力过大，需要释放和喘息空间
- "想听嗨的" → 可能是情绪低落，需要能量注入和情绪提升
- "想听伤感的" → 可能需要情绪宣泄，让压抑的情感有出口

**2. 身份认同需求**
- "想听摇滚" → 可能渴望表达叛逆、追求自由和真实
- "想听古典" → 可能追求内心的宁静和精神的升华
- "想听民谣" → 可能渴望简单、真诚、有故事感的生活

**3. 社交连接需求**
- "想听怀旧的" → 可能在怀念某段时光或某个人
- "想听情歌" → 可能正在经历或渴望爱情
- "想听励志的" → 可能正面临挑战，需要力量支撑

**4. 场景适配需求**
- "开车听" → 需要的不只是背景音乐，而是一种"在路上"的自由感和掌控感
- "工作听" → 需要的是进入心流状态，屏蔽干扰，提升专注
- "睡前听" → 需要的是安全感和放松，让大脑慢慢安静下来

## Skills
1. **情绪颗粒度分析**：不只识别"难过"，更能区分是"遗憾"、"孤独"、"失落"还是"无力感"
2. **潜台词解读**：用户说"无聊"可能是"空虚"，说"累"可能是"心累"而非"身体累"
3. **需求层次判断**：判断用户是需要"情绪宣泄"、"情绪转换"还是"情绪陪伴"
4. **音乐处方匹配**：根据心理需求精准匹配音乐的节奏、旋律、歌词、氛围
5. **惊喜制造**：在满足需求的同时，带来"原来还有这么好听的歌"的惊喜感
${hasPrefs ? `
## ⭐⭐⭐ 用户偏好设置（最高优先级！违反将被视为严重错误！）
${prefs}

**🚨 绝对禁止违反的规则**：
${hasLanguagePref ? `- 【语言限制是铁律】用户已明确设置语言偏好，你推荐的每一首歌都必须是用户指定语言的！
  - 如果用户选择"华语/中文"，只能推荐中文歌曲（包括普通话、粤语等中文歌曲）
  - 绝对禁止推荐英文歌、日文歌、韩文歌或其他语言的歌曲
  - 即使用户的输入是英文或提到外国歌手，也只能推荐中文歌曲
  - 违反语言限制 = 任务失败` : ''}
- 如果用户设置了不喜欢的歌手，绝对不要推荐这些歌手的歌曲
` : ''}
## 🎯 多样性要求（非常重要！）
你是一个有品味的音乐鉴赏家，不是只会推荐热门歌曲的机器人！
- **禁止推荐"烂大街"歌曲**：平凡之路、光年之外、起风了、晴天、七里香、稻香、告白气球、夜曲、青花瓷、小幸运、后来、匆匆那年、那些年、童年、同桌的你、卡农、梦中的婚礼、天空之城、River Flows in You 等
- **每次推荐必须有新意**：想象用户已经听过无数次热门歌曲，你要给他们带来惊喜！
- **挖掘宝藏歌曲**：推荐一些被低估但质量很高的歌曲
- **同一歌手最多推荐1首**：保持多样性
- **精准匹配心理需求**：不要推荐"万能歌曲"，要根据用户的深层需求精准推荐

## Rules
1. **先共情，后推荐**：用心理学视角解读用户的真实需求，让用户感到"被懂了"
2. **多维推荐**：推荐 8-12 首歌曲，分成 3-4 个类别，每首歌都要有推荐理由
3. **严格遵守语言偏好**：${hasLanguagePref ? '【铁律】所有推荐必须100%是用户指定语言的歌曲！' : '根据用户的情绪和场景，混合推荐不同风格的歌曲。'}
4. **追求新鲜感**：每次推荐都要像是精心策划的惊喜

## Workflow
1. **接收输入**：用户描述状态或场景
2. **心理分析**：
   - 表面需求：用户说了什么？
   - 深层需求：用户真正需要什么？（情绪宣泄/能量补充/陪伴感/掌控感/逃离感...）
   - 心理状态：用户可能正在经历什么？
3. **音乐处方**：根据心理需求，开出精准的"音乐处方"

## 回复格式（必须是有效的 JSON）
{
  "reason": "用换行分隔的短句\\n**重点词**用双星号包裹\\n简洁有力~",
  "songs": [
    { "title": "歌曲名", "artist": "歌手名", "category": "🎯 分类名", "comment": "一句话推荐理由" }
  ]
}

## reason 字段要求（非常重要！）
- **像写歌词一样分行**：用 \\n 换行，每行一个短句
- **重点词用 ** 包裹**：比如 **自由** **放松** **能量**，会高亮显示
- **每行不超过15个字**：短小精悍
- **2-4行即可**：不要太长
- **有节奏感**：像诗一样，读起来舒服

好的例子：
「开车想听歌\\n是想要那种**在路上**的感觉吧\\n给你准备了几首**公路味**十足的~」

「想**放松**不只是想安静\\n是想给紧绷的神经**放个假**\\n来，深呼吸~」

「**工作**需要专注力\\n但也需要一点**小确幸**\\n这几首刚刚好~」

「感受到你有点**累**了\\n需要一些**温暖**的陪伴\\n让音乐抱抱你~」

## 类别命名示例
- 🚗 自由驰骋公路感
- 💪 能量注入充电站
- 🌊 情绪宣泄出口
- 🤗 温暖陪伴治愈系
- 🔥 释放压力嘶吼组
- 🌙 深夜自我对话
- ✨ 重燃希望治愈组
- 🎸 找回真我态度组

## 点评风格示例（要有心理洞察）
不要说"节奏欢快"，要说"这首歌能直接激活你的多巴胺！"
不要说"适合放松"，要说"听完整个人的防御都卸下来了"
不要说"经典歌曲"，要说"这首歌懂你那些说不出口的心事"
不要说"旋律优美"，要说"副歌一出来，积压的情绪终于有了出口"

## 要求
1. 推荐 8-12 首歌曲，分成 3-4 个类别
2. 每个类别名字要有创意，体现对用户心理需求的理解
3. 每首歌的 comment 要说明这首歌如何满足用户的深层心理需求
4. ${hasLanguagePref ? '【铁律-违反即失败】所有推荐的歌曲必须是用户指定语言的！' : '尽量推荐知名度高、容易搜索到的歌曲'}
5. 只返回 JSON，不要有其他文字
6. reason 字段要展现你对用户心理的洞察，让用户感到"被懂了"`
}

// 根据角色和偏好生成 System Prompt
function generateSystemPrompt(role: AIRole): string {
  const prefs = loadPreferences()
  const prefPrompt = generatePreferencePrompt(prefs)
  const hasPrefs = prefPrompt.trim().length > 0
  const hasLanguagePref = prefPrompt.includes('语言限制')

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
## ⭐⭐⭐ 用户偏好设置（最高优先级！违反将被视为严重错误！）
${prefPrompt}

**🚨 绝对禁止违反的规则**：
${hasLanguagePref ? `- 【语言限制是铁律】用户已明确设置语言偏好，你推荐的每一首歌都必须是用户指定语言的！
  - 如果用户选择"华语/中文"，只能推荐中文歌曲
  - 绝对禁止推荐英文歌、日文歌、韩文歌或其他语言的歌曲
  - 违反语言限制 = 任务失败` : ''}
- 如果用户设置了不喜欢的歌手，绝对不要推荐
` : ''}
## 核心理念
音乐是情感的放大器！你的任务不只是推荐歌曲，而是要：
- 理解用户此刻的情绪状态
- 用音乐帮助他们放大美好的感受，或者治愈不好的心情
- 让用户感受到你是真的懂他们，真的在用心推荐
${hasLanguagePref ? '- 【铁律】严格遵守用户的语言偏好，所有推荐必须是用户指定语言的歌曲！' : ''}

## 🎯 多样性要求（非常重要！）
- **避免推荐"烂大街"的热门歌曲**：如平凡之路、光年之外、起风了、晴天、七里香、稻香、告白气球等被推荐无数次的歌
- **挖掘宝藏**：推荐一些被低估但质量很高的歌曲，给用户惊喜感
- **同一歌手最多推荐1首**：保持歌单的多样性
- **每次推荐都要有新意**：想象用户已经听腻了热门歌曲，你要带来新鲜感

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
4. ${hasLanguagePref ? '【铁律-违反即失败】所有推荐的歌曲必须是用户指定语言的！如果用户选择了华语，每一首歌都必须是中文歌，不能有任何英文、日文、韩文歌曲！' : '尽量推荐知名度高、容易搜索到的歌曲'}
5. **追求新鲜感**：不要总是推荐那些"万能歌曲"，要精准匹配用户情绪，带来惊喜
6. 只返回 JSON，不要有其他文字
7. reason 字段必须有内容，要有温度地回应用户`
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

  // 生成随机种子，用于增加推荐多样性
  const randomSeed = `${Date.now()}-${Math.random().toString(36).slice(2)}`

  try {
    // 检查是否是混合内容问题（HTTPS 页面请求 HTTP API）
    const isSecurePage = typeof window !== 'undefined' && window.location.protocol === 'https:'
    const isHttpApi = config.baseUrl.startsWith('http://')
    if (isSecurePage && isHttpApi) {
      throw new Error(
        '安全限制：当前页面使用 HTTPS，无法连接 HTTP 的 API 地址。请使用 HTTPS 的 API 地址，或通过 HTTP 访问本应用。'
      )
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000) // 30秒超时

    // 在 system prompt 末尾添加随机种子，而不是用户输入中
    const systemPrompt =
      generateSystemPrompt(currentRole) +
      `\n\n[内部指令-请勿在回复中提及] 随机种子: ${randomSeed}，请基于此生成独特且新颖的推荐，不要重复之前可能推荐过的歌曲。`

    // 根据 authType 设置认证头
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
          { role: 'user', content: userInput }
        ],
        temperature: 1.0,
        max_tokens: 1500,
        stream: true,
        top_p: 0.95,
        frequency_penalty: 0.9,
        presence_penalty: 0.7
      }),
      signal: controller.signal
    }).catch((err) => {
      clearTimeout(timeoutId)
      // 网络错误的友好提示
      if (err.name === 'AbortError') {
        throw new Error('连接超时，请检查网络或 API 地址是否正确')
      }
      if (err.name === 'TypeError' && err.message.includes('Failed to fetch')) {
        throw new Error(
          '无法连接到 API 服务器。可能原因：\n1. API 地址不正确\n2. 服务器未启用 CORS\n3. 网络连接问题\n4. 移动端可能需要使用 HTTPS 地址'
        )
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

  // 根据 authType 设置认证头
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

/**
 * 智能分析歌曲元数据
 * 识别流派、年代、标签、情绪等
 */
export async function analyzeTrackMetadata(
  title: string,
  artist: string
): Promise<{
  genre: string
  era: string
  tags: string[]
  mood: string
} | null> {
  const config = loadAIConfig()
  if (!config.apiKey) return null

  const prompt = `分析歌曲《${title}》- ${artist}。
你的目标是为音乐推荐系统提供精准的分类数据。
请返回严格的 JSON 格式（不要包含任何 markdown 代码块标识）：
{
  "genre": "流派（如：古风、CityPop、摇滚、嘻哈、电子、民谣等，尽量精准）",
  "era": "年代（如：80年代、90年代、00年代、10年代、20年代）",
  "tags": ["核心风格标签1", "标签2", "标签3"],
  "mood": "情绪（如：忧伤、壮烈、轻快、宁静、热血等）"
}
如果信息不足，请基于你的知识库进行最合理的推测。不要返回未知。`

  try {
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
          { role: 'system', content: '你是一个资深的音乐库分类专家，精通全球及华语乐坛历史，对各种细分流派有深刻理解。' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3, // 低随机性确保分类稳定
        max_tokens: 300
      })
    })

    if (!response.ok) return null

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content
    if (!content) return null

    // 清理可能存在的 markdown 标识
    let jsonStr = content.trim()
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonMatch) jsonStr = jsonMatch[1].trim()

    const result = JSON.parse(jsonStr)
    return {
      genre: result.genre || '流行',
      era: result.era || '未知',
      tags: result.tags || [],
      mood: result.mood || '中性'
    }
  } catch (e) {
    console.error('AI 元数据分析失败:', e)
    return null
  }
}
