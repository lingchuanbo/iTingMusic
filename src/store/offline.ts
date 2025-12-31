/**
 * 离线模式状态管理
 */
import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

const STORAGE_KEY = 'zen_offline_mode'

export const useOfflineStore = defineStore('offline', () => {
  // 离线模式开关
  const isOfflineMode = ref(loadOfflineMode())
  
  // 网络状态
  const isOnline = ref(navigator.onLine)

  function loadOfflineMode(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true'
    } catch {
      return false
    }
  }

  function saveOfflineMode() {
    localStorage.setItem(STORAGE_KEY, String(isOfflineMode.value))
  }

  // 切换离线模式
  function toggleOfflineMode() {
    isOfflineMode.value = !isOfflineMode.value
    saveOfflineMode()
  }

  // 设置离线模式
  function setOfflineMode(value: boolean) {
    isOfflineMode.value = value
    saveOfflineMode()
  }

  // 监听网络状态
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      isOnline.value = true
    })
    window.addEventListener('offline', () => {
      isOnline.value = false
      // 网络断开时自动启用离线模式
      if (!isOfflineMode.value) {
        isOfflineMode.value = true
        saveOfflineMode()
      }
    })
  }

  // 监听变化自动保存
  watch(isOfflineMode, saveOfflineMode)

  return {
    isOfflineMode,
    isOnline,
    toggleOfflineMode,
    setOfflineMode
  }
})
