import { ref } from 'vue'

// UI state for select mode (e.g., multi-select songs)
export const isSelectMode = ref(false)

// UI state for modal visibility
export const isModalOpen = ref(false)

// Helper functions to toggle states
export function setSelectMode(value: boolean) {
  isSelectMode.value = value
}

export function setModalOpen(value: boolean) {
  isModalOpen.value = value
}
