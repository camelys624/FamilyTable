import { resetDemo } from '../../services/store'
import { runtimeConfig } from '../../config/runtime'
import { familyModule } from '../../modules/family/index'
import { clearSession, ensureSession } from '../../modules/session/index'
import { toAppError } from '../../utils/app-error'
import { WriteIntent } from '../../utils/write-intent'

Page({
  data: {
    familyName: '',
    familyInfoVersion: 0,
    familyDraftName: '',
    canEditFamily: false,
    familyEditorOpen: false,
    familySaving: false,
    familyPending: false,
    familyEditError: '',
    familyError: '',
    loading: false,
    isLocal: runtimeConfig.repositoryMode === 'local',
  },
  familyWriter: new WriteIntent(),

  async onShow() { await this.loadFamily() },

  async loadFamily() {
    if (this.data.loading || this.data.familySaving || this.data.familyPending) return
    this.setData({ loading: true, familyError: '', canEditFamily: false })
    try {
      const session = await ensureSession()
      if (!session.onboarded) { wx.reLaunch({ url: '/pages/onboarding/index' }); return }
      const current = await familyModule.getCurrentFamily()
      this.setData({ familyName: current.family.name, familyInfoVersion: current.family.infoVersion || 0, canEditFamily: current.currentMember.role === 'owner' })
    } catch (error) {
      const failure = toAppError(error)
      this.setData({ familyName: '', familyError: failure.message })
      if (['UNAUTHENTICATED', 'FAMILY_REQUIRED', 'NOT_FAMILY_MEMBER'].includes(failure.code)) {
        clearSession()
        wx.reLaunch({ url: '/pages/onboarding/index' })
      }
    } finally { this.setData({ loading: false }) }
  },

  openFamilyEditor() {
    if (!this.data.canEditFamily || this.data.loading || this.data.familySaving || this.data.familyPending || this.data.familyError || this.data.familyEditorOpen) return
    this.setData({ familyEditorOpen: true, familyDraftName: this.data.familyName, familyEditError: '' })
  },

  closeFamilyEditor() {
    if (this.data.familySaving || this.data.familyPending) return
    this.setData({ familyEditorOpen: false, familyDraftName: '', familyEditError: '' })
  },

  onFamilyNameInput(event: any) {
    if (!this.data.canEditFamily || this.data.familySaving || this.data.familyPending) return
    this.setData({ familyDraftName: event.detail.value, familyEditError: '' })
  },

  async saveFamilyName() {
    if (!this.data.canEditFamily || this.data.loading || this.data.familySaving || !this.data.familyEditorOpen) return
    const input = this.familyWriter.pending?.input || { name: this.data.familyDraftName.trim(), expectedVersion: this.data.familyInfoVersion }
    const name = String(input.name)
    if (!name || name.length > 40) { this.setData({ familyEditError: '饭桌名称需填写 1～40 个字' }); return }
    if (!this.familyWriter.pending && name === this.data.familyName) { this.closeFamilyEditor(); return }
    this.setData({ familySaving: true, familyEditError: '' })
    let refresh = false
    try {
      const result = await this.familyWriter.run('updateFamily', input, (requestId) => familyModule.updateFamily(name, Number(input.expectedVersion), requestId))
      this.setData({ familyName: result.family.name, familyInfoVersion: result.family.infoVersion, familyEditorOpen: false, familyDraftName: '', familyPending: false })
      wx.showToast({ title: '饭桌名称已更新', icon: 'success' })
      refresh = true
    } catch (error) {
      const failure = toAppError(error)
      this.setData({ familyPending: Boolean(this.familyWriter.pending), familyEditError: failure.message })
      if (failure.code === 'VERSION_CONFLICT') refresh = true
      if (['FORBIDDEN', 'FAMILY_REQUIRED', 'NOT_FAMILY_MEMBER'].includes(failure.code)) { this.setData({ canEditFamily: false }); refresh = true }
    } finally { this.setData({ familySaving: false }) }
    if (refresh) await this.loadFamily()
  },

  openLegal() { wx.navigateTo({ url: '/pages/legal/index?type=privacy' }) },

  resetDemo() {
    if (!this.data.isLocal) return
    wx.showModal({
      title: '重置体验数据？',
      content: '新增菜谱、菜单调整和采购勾选都会恢复为初始状态。',
      confirmColor: '#d94f3d',
      confirmText: '确认重置',
      success: (result: any) => {
        if (result.confirm) {
          resetDemo()
          clearSession()
          wx.reLaunch({ url: '/pages/onboarding/index' })
        }
      },
    })
  },
})
