# 🎵 灵听音乐 (iTingMusic)

一款基于 Vue 3 + Capacitor 的跨平台音乐播放器，支持 AI 智能选歌、多平台音源聚合、WebDAV 云盘同步等功能。

## ✨ 功能特性

### 🎯 已完成功能

#### 核心播放
- [x] 音频播放器（基于 Howler.js）
- [x] 播放控制（播放/暂停/上一首/下一首）
- [x] 播放模式（顺序/循环/随机/单曲）
- [x] 音量控制
- [x] 进度条拖拽
- [x] 缓冲进度显示
- [x] 播放列表管理
- [x] 歌词同步显示（LRC 解析）
- [x] 后台播放支持

#### 音乐源
- [x] 在线音乐搜索（聚合搜索）
- [x] 多平台支持：网易云、QQ音乐、酷我、酷狗、咪咕
- [x] 音质选择（128k/320k/FLAC/Hi-Res）
- [x] 排行榜浏览
- [x] 本地音乐导入（支持 mp3/flac/wav/m4a/ogg）
- [x] WebDAV 云盘连接

#### AI 智能选歌
- [x] AI 推荐引擎（支持 OpenAI/DeepSeek/自定义）
- [x] 8 种 AI 角色人设（小乐、阿摇、雅音、潮潮等）
- [x] 用户偏好设置（语言/年代/情绪/人声）
- [x] 快捷场景推荐
- [x] 智能歌曲匹配（拼音模糊匹配）
- [x] 批量添加到播放列表/歌单

#### 个人中心
- [x] 我的收藏
- [x] 自定义歌单（创建/编辑/删除）
- [x] 播放历史持久化
- [x] 音频缓存管理

#### UI/UX
- [x] 响应式设计（移动端/桌面端适配）
- [x] 动态模糊背景
- [x] 沉浸式歌词面板
- [x] 下拉刷新
- [x] Toast 提示
- [x] 安全区域适配（刘海屏/底部手势条）
- [x] Android 返回键处理

### 🚧 待完成功能

#### 高优先级
- [ ] 歌曲下载功能
- [ ] 离线播放模式
- [ ] 歌单导入/导出
- [ ] 搜索历史记录
- [ ] 播放队列管理（插队播放）

#### 中优先级
- [ ] 均衡器（EQ）
- [ ] 定时关闭
- [ ] 桌面歌词
- [ ] 分享功能
- [ ] 多语言支持（i18n）

#### 低优先级
- [ ] 主题切换（深色/浅色）
- [ ] 自定义主题色
- [ ] 歌词翻译
- [ ] MV 播放
- [ ] 社交功能（评论/动态）

---

## 🛠️ 技术栈

| 类别 | 技术 |
|------|------|
| 前端框架 | Vue 3 + Composition API |
| 状态管理 | Pinia |
| 构建工具 | Vite 5 |
| 样式方案 | Tailwind CSS |
| 跨平台 | Capacitor 8 |
| 音频播放 | Howler.js |
| 音频元数据 | music-metadata-browser |
| WebDAV | webdav (npm) |
| 类型检查 | TypeScript |

---

## 📁 项目结构

```
src/
├── components/          # 页面组件
│   ├── App.vue          # 根组件
│   ├── HomeView.vue     # 首页（推荐/轮播/快捷入口）
│   ├── SearchBar.vue    # 全局搜索
│   ├── SongList.vue     # 播放列表
│   ├── PlayerBar.vue    # 底部播放栏
│   ├── LyricsPanel.vue  # 歌词面板
│   ├── AIPickerView.vue # AI 选歌
│   ├── ToplistView.vue  # 排行榜
│   ├── PlaylistView.vue # 我的歌单
│   ├── FavoriteView.vue # 我的收藏
│   ├── LocalView.vue    # 本地音乐
│   ├── WebDAVView.vue   # WebDAV 云盘
│   ├── SettingsView.vue # 设置
│   ├── Sidebar.vue      # 桌面端侧边栏
│   └── MobileNav.vue    # 移动端底部导航
│
├── services/            # 服务层
│   ├── ai/
│   │   └── AIService.ts       # AI 推荐服务
│   ├── cache/
│   │   └── AudioCache.ts      # 音频缓存（IndexedDB）
│   ├── player/
│   │   ├── AudioPlayer.ts     # 播放器核心
│   │   └── BackgroundMode.ts  # 后台播放
│   ├── source/
│   │   ├── OnlineApiSource.ts # 在线音源 API
│   │   ├── LocalSource.ts     # 本地文件处理
│   │   └── WebDAVSource.ts    # WebDAV 连接
│   └── TrackStorage.ts        # 歌曲存储
│
├── store/               # 状态管理
│   ├── player.ts        # 播放器状态
│   ├── playlist.ts      # 歌单状态
│   └── ui.ts            # UI 状态
│
├── utils/               # 工具函数
│   ├── formatTime.ts    # 时间格式化
│   ├── parseLyrics.ts   # 歌词解析
│   ├── pinyin.ts        # 拼音转换
│   └── songMatcher.ts   # 歌曲匹配算法
│
├── types/
│   └── index.ts         # 类型定义
│
├── main.ts              # 入口文件
└── style.css            # 全局样式
```

---

## 🚀 快速开始

### 环境要求
- Node.js >= 18
- pnpm / npm / yarn

### 安装依赖
```bash
pnpm install
```

### 开发模式
```bash
pnpm dev
```

### 构建生产版本
```bash
pnpm build
```

### Android 构建
```bash
# 同步到 Android 项目
npx cap sync android

# 打开 Android Studio
npx cap open android
```

---

## 🔮 后期维护与扩展方向

### 1. 功能增强
- **智能推荐升级**：接入更多 AI 模型，支持本地大模型
- **音频处理**：添加均衡器、音效增强、3D 环绕
- **社交功能**：歌单分享、好友动态、评论互动
- **跨设备同步**：账号系统、云端同步播放进度

### 2. 平台扩展
- **iOS 版本**：Capacitor 已支持，需配置 Xcode
- **桌面版本**：使用 Electron 或 Tauri 打包
- **Web PWA**：添加 Service Worker 支持离线

### 3. 性能优化
- **虚拟列表**：大量歌曲时的列表渲染优化
- **预加载**：下一首歌曲预缓冲
- **图片懒加载**：封面图片按需加载
- **代码分割**：路由级别的懒加载

### 4. 音源扩展
- **更多平台**：Spotify、Apple Music、YouTube Music
- **播客支持**：播客订阅与播放
- **电台功能**：在线电台流媒体

### 5. 用户体验
- **手势操作**：滑动切歌、双击收藏
- **快捷指令**：Siri/Google Assistant 集成
- **小组件**：桌面/锁屏小组件
- **CarPlay/Android Auto**：车载模式

### 6. 数据与安全
- **数据备份**：导出/导入用户数据
- **隐私保护**：本地化处理，减少数据上传
- **API 安全**：请求签名、防盗链

---

## 📄 License

MIT License

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！
