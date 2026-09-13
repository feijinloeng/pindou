import { create } from 'zustand'

/** BoardPicker 注册、Toolbar 调用；确认/取消逻辑只在 BoardPicker 本身。 */
export const usePickerActions = create<{
  confirm: (() => void) | null
  cancel: (() => void) | null
  canConfirm: boolean
}>(() => ({ confirm: null, cancel: null, canConfirm: false }))
