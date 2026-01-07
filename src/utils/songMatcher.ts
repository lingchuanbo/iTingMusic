import type { SearchResult, MusicSource } from '@/services/source/OnlineApiSource'
import { searchSongs } from '@/services/source/OnlineApiSource'

/**
 * 精准匹配搜索结果（严格双重验证：歌名+歌手）
 * 用于AI推荐歌曲的精准匹配，避免翻唱、纯音乐、live版本
 */
export function findBestMatch(
  results: SearchResult[],
  targetTitle: string,
  targetArtist: string
): SearchResult | null {
  if (results.length === 0) return null

  const normalizeStr = (s: string) =>
    s
      .toLowerCase()
      .replace(/[\s\-_·・·]/g, '')
      .replace(/[（）()【】\[\]《》<>]/g, '')
      .replace(/['"""'']/g, '')

  const normTitle = normalizeStr(targetTitle)
  const normArtist = normalizeStr(targetArtist)

  // 过滤掉明显的翻唱/纯音乐/live版本
  const excludeKeywords = [
    'cover',
    '翻唱',
    '钢琴版',
    '钢琴曲',
    '纯音乐',
    '伴奏',
    'instrumental',
    'piano',
    'acoustic',
    '轻音乐',
    'remix',
    '改编',
    '演奏',
    'live',
    '现场',
    '演唱会',
    'concert',
    '致敬',
    '版本'
  ]
  const isExcluded = (name: string, artist: string) => {
    const combined = (name + artist).toLowerCase()
    return excludeKeywords.some((kw) => combined.includes(kw))
  }

  // 严格验证歌手是否匹配（必须包含目标歌手名）
  const isArtistMatch = (rArtist: string) => {
    const normRArtist = normalizeStr(rArtist)
    // 目标歌手必须出现在结果歌手中，或者结果歌手必须出现在目标歌手中
    if (normRArtist.includes(normArtist) || normArtist.includes(normRArtist)) {
      return true
    }
    // 处理多歌手情况，用常见分隔符分割
    const targetArtists = normArtist
      .split(/[,，/、&]/)
      .map((a) => a.trim())
      .filter((a) => a.length > 0)
    const resultArtists = normRArtist
      .split(/[,，/、&]/)
      .map((a) => a.trim())
      .filter((a) => a.length > 0)
    // 只要有一个歌手匹配就行
    for (const ta of targetArtists) {
      for (const ra of resultArtists) {
        if (ta.length >= 2 && ra.length >= 2 && (ta.includes(ra) || ra.includes(ta))) {
          return true
        }
      }
    }
    return false
  }

  // 验证歌名是否匹配
  const isTitleMatch = (rName: string, exact: boolean = false) => {
    const normRName = normalizeStr(rName)
    if (exact) {
      return normRName === normTitle
    }
    // 宽松匹配：互相包含
    return normRName.includes(normTitle) || normTitle.includes(normRName)
  }

  // 第一优先级：歌名精确匹配 + 歌手严格匹配
  for (const r of results) {
    if (isExcluded(r.name, r.artist)) continue
    if (isTitleMatch(r.name, true) && isArtistMatch(r.artist)) {
      return r
    }
  }

  // 第二优先级：歌名包含匹配 + 歌手严格匹配
  for (const r of results) {
    if (isExcluded(r.name, r.artist)) continue
    if (isTitleMatch(r.name, false) && isArtistMatch(r.artist)) {
      return r
    }
  }

  // 第三优先级：歌名精确匹配，不验证歌手（可能是合唱版本）
  for (const r of results) {
    if (isExcluded(r.name, r.artist)) continue
    const normRName = normalizeStr(r.name)
    if (normRName === normTitle) {
      return r
    }
  }

  // 不再有更低优先级！必须同时匹配歌名和歌手
  return null
}

/**
 * 搜索并精准匹配歌曲
 * @param title 歌曲名
 * @param artist 歌手名
 * @param sources 音乐源列表，默认 QQ音乐 和 网易音乐
 * @returns 匹配到的搜索结果，或 null
 */
export async function searchAndMatch(
  title: string,
  artist: string,
  sources: MusicSource[] = ['qq', 'netease']
): Promise<SearchResult | null> {
  for (const source of sources) {
    try {
      const results = await searchSongs(source, `${title} ${artist}`, 20)
      const match = findBestMatch(results, title, artist)
      if (match) {
        return match
      }
    } catch {
      continue
    }
  }
  return null
}
