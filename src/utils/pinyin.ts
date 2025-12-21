/**
 * 简拼搜索支持
 * 将拼音首字母转换为可能的搜索关键词
 */

// 常用歌手简拼映射表
const artistPinyinMap: Record<string, string> = {
  // 华语男歌手
  'zjl': '周杰伦',
  'ldr': '刘德华',
  'zxy': '张学友',
  'gmq': '郭美其',
  'lm': '黎明',
  'cyx': '陈奕迅',
  'wlh': '王力宏',
  'ljj': '林俊杰',
  'xzq': '薛之谦',
  'hs': '华晨宇',
  'hcy': '华晨宇',
  'mry': '毛不易',
  'mby': '毛不易',
  'lrj': '李荣浩',
  'lrh': '李荣浩',
  'zyl': '张艺兴',
  'zyx': '张艺兴',
  'wjk': '王嘉尔',
  'wje': '王嘉尔',
  'zyq': '周深',
  'zs': '周深',
  'xm': '许嵩',
  'xs': '许嵩',
  'pyl': '潘玮柏',
  'pwb': '潘玮柏',
  'wf': '汪峰',
  'lj': '李健',
  'lzs': '李宗盛',
  'lhj': '李宗盛',
  'zxz': '张信哲',
  'rxy': '任贤齐',
  'rxq': '任贤齐',
  'wj': '伍佰',
  'wb': '伍佰',
  'dcy': '邓紫棋',
  'dzq': '邓紫棋',
  
  // 华语女歌手
  'tsw': '田馥甄',
  'tfz': '田馥甄',
  'wfq': '王菲',
  'wfei': '王菲',
  'nyl': '那英',
  'ny': '那英',
  'zly': '张靓颖',
  'zjy': '张靓颖',
  'lyl': '李宇春',
  'lyc': '李宇春',
  'zby': '张碧晨',
  'zbc': '张碧晨',
  'gem': '邓紫棋',
  'jj': '蔡依林',
  'cyl': '蔡依林',
  'shl': '孙燕姿',
  'syz': '孙燕姿',
  'lxy': '梁静茹',
  'ljr': '梁静茹',
  'ams': '莫文蔚',
  'mww': '莫文蔚',
  'fyw': '范玮琪',
  'fwq': '范玮琪',
  'yl': '杨丞琳',
  'ycl': '杨丞琳',
  'hebe': '田馥甄',
  'jolin': '蔡依林',
  
  // 组合/乐队
  'wys': '五月天',
  'wyt': '五月天',
  'snh': 'SNH48',
  'tfboys': 'TFBOYS',
  'tfb': 'TFBOYS',
  'bts': 'BTS',
  'exo': 'EXO',
  'sj': 'Super Junior',
  'fhsn': '凤凰传奇',
  'fhcq': '凤凰传奇',
  'xfx': '信乐团',
  'xlt': '信乐团',
  'hhht': '花花',
  'hh': '华晨宇',
  'jsbr': '筷子兄弟',
  'kzxd': '筷子兄弟',
  
  // 港台歌手
  'yjl': '杨千嬅',
  'yqh': '杨千嬅',
  'rjl': '容祖儿',
  'rze': '容祖儿',
  'zxn': '郑秀文',
  'zxw': '郑秀文',
  'lkq': '李克勤',
  'lkqin': '李克勤',
  'xjh': '许冠杰',
  'xgj': '许冠杰',
  'tl': '谭咏麟',
  'tyl': '谭咏麟',
  'zg': '张国荣',
  'zgr': '张国荣',
  'myz': '梅艳芳',
  'myf': '梅艳芳',
  'wjie': '王杰',
  'byz': 'Beyond',
  'beyond': 'Beyond',
  
  // 欧美歌手
  'ts': 'Taylor Swift',
  'taylor': 'Taylor Swift',
  'jb': 'Justin Bieber',
  'ed': 'Ed Sheeran',
  'adele': 'Adele',
  'bw': 'Bruno Mars',
  'bruno': 'Bruno Mars',
  'ariana': 'Ariana Grande',
  'ag': 'Ariana Grande',
  'dualipa': 'Dua Lipa',
  'dl': 'Dua Lipa',
  'theweeknd': 'The Weeknd',
  'weeknd': 'The Weeknd',
  'billie': 'Billie Eilish',
  'be': 'Billie Eilish',
  'rihanna': 'Rihanna',
  'rh': 'Rihanna',
  'ladygaga': 'Lady Gaga',
  'lg': 'Lady Gaga',
  'kp': 'Katy Perry',
  'katy': 'Katy Perry',
  'mj': 'Michael Jackson',
  'michael': 'Michael Jackson',
  'eminem': 'Eminem',
  'em': 'Eminem',
  'drake': 'Drake',
  'coldplay': 'Coldplay',
  'cp': 'Coldplay',
  'maroon5': 'Maroon 5',
  'm5': 'Maroon 5',
  'onerepublic': 'OneRepublic',
  'or': 'OneRepublic',
  'imaginedragons': 'Imagine Dragons',
  'id': 'Imagine Dragons',
  
  // 日韩歌手
  'iu': 'IU',
  'blackpink': 'BLACKPINK',
  'bp': 'BLACKPINK',
  'twice': 'TWICE',
  'bigbang': 'BIGBANG',
  'bb': 'BIGBANG',
  'gd': 'G-Dragon',
  'yoona': '林允儿',
  'lyy': '林允儿',
  'taeyeon': '金泰妍',
  'jty': '金泰妍',
  'akb': 'AKB48',
  'akb48': 'AKB48',
}

// 常用歌曲简拼映射
const songPinyinMap: Record<string, string> = {
  'qlt': '晴天',
  'dxh': '稻香',
  'yfc': '夜曲',
  'yq': '夜曲',
  'qhsx': '青花瓷',
  'qhc': '青花瓷',
  'gxfc': '告白气球',
  'gbqq': '告白气球',
  'djwz': '等你下课',
  'dnxk': '等你下课',
  'jdmm': '简单爱',
  'jda': '简单爱',
  'aqzn': '安静',
  'aj': '安静',
  'hxyl': '花香',
  'hx': '花香',
  'qdss': '七里香',
  'qlx': '七里香',
  'fmg': '发如雪',
  'frx': '发如雪',
  'ycjm': '以父之名',
  'yfzm': '以父之名',
  'ydzm': '一路向北',
  'ylxb': '一路向北',
  'hkn': '黑色幽默',
  'hsym': '黑色幽默',
  'kbnn': '可不可以',
  'kbky': '可不可以',
  'xqgs': '星晴',
  'xq': '星晴',
  'ynhy': '烟花易冷',
  'yhyl': '烟花易冷',
  'lmls': '龙卷风',
  'ljf': '龙卷风',
  'sn': '说好不哭',
  'shbk': '说好不哭',
  'mjt': 'Mojito',
  'mojito': 'Mojito',
}

/**
 * 检测是否为简拼（纯小写字母）
 */
export function isPinyin(str: string): boolean {
  return /^[a-z]+$/i.test(str)
}

/**
 * 将简拼转换为可能的搜索关键词
 * @param pinyin 简拼字符串
 * @returns 转换后的关键词，如果没有匹配则返回原字符串
 */
export function convertPinyin(pinyin: string): string {
  const lower = pinyin.toLowerCase()
  
  // 先查歌手映射
  if (artistPinyinMap[lower]) {
    return artistPinyinMap[lower]
  }
  
  // 再查歌曲映射
  if (songPinyinMap[lower]) {
    return songPinyinMap[lower]
  }
  
  // 没有匹配，返回原字符串
  return pinyin
}

/**
 * 智能搜索关键词处理
 * 如果是简拼则尝试转换，否则返回原关键词
 */
export function processSearchKeyword(keyword: string): string {
  const trimmed = keyword.trim()
  
  // 如果是纯字母且长度较短，尝试简拼转换
  if (isPinyin(trimmed) && trimmed.length <= 10) {
    return convertPinyin(trimmed)
  }
  
  return trimmed
}
