import { ref } from 'vue'

// UI state for select mode (e.g., multi-select songs)
export const isSelectMode = ref(false)

// UI state for modal visibility
export const isModalOpen = ref(false)

// UI state for player bar expansion
export const isPlayerExpanded = ref(false)

// UI state for Random Listen view visibility (hides player bar when open)
export const isRandomListenOpen = ref(false)

// 播放器内弹窗状态（用于返回键优先级判断）
export const showPlaylist = ref(false)
export const showPlaylistPicker = ref(false)

// 排行榜跳转状态 (用于从首页跳转到特定平台榜单)
export const toplistJumpState = ref<{ source: string, id: string } | null>(null)

// 用于收起播放器的回调函数（由 PlayerBar 注册）
let collapsePlayerCallback: (() => void) | null = null

// Helper functions to toggle states
export function setSelectMode(value: boolean) {
  isSelectMode.value = value
}

export function setModalOpen(value: boolean) {
  isModalOpen.value = value
}

export function setPlayerExpanded(value: boolean) {
  isPlayerExpanded.value = value
}

// 注册收起播放器的回调
export function registerCollapsePlayer(callback: () => void) {
  collapsePlayerCallback = callback
}

// 收起播放器
export function collapsePlayer() {
  if (collapsePlayerCallback) {
    collapsePlayerCallback()
  }
}

// 检查是否有任何播放器相关的弹窗打开
export function hasPlayerPopupOpen(): boolean {
  return showPlaylist.value || showPlaylistPicker.value
}

// 关闭所有播放器弹窗
export function closePlayerPopups(): boolean {
  if (showPlaylistPicker.value) {
    showPlaylistPicker.value = false
    return true
  }
  if (showPlaylist.value) {
    showPlaylist.value = false
    return true
  }
  return false
}
