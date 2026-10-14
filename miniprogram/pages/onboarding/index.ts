import { completeOnboarding, ensureSession } from '../../modules/session/index'
import { toAppError } from '../../utils/app-error'
import { runtimeConfig } from '../../config/runtime'

interface ChooseAvatarEvent {
  detail: { avatarUrl: string }
}

Page({
  data: {
    mode: 'create',
    familyName: '林家小饭桌',
    userName: '小满',
    inviteCode: '',
    avatarPath: '',
    avatarUrl: '',
    submitting: false,
    isLocal: runtimeConfig.repositoryMode === 'local',
    errorMessage: '',
    termsAccepted: false,
  },

  async onLoad() {
    try {
      const session = await ensureSession()
      if (session.onboarded) {
        wx.switchTab({ url: '/pages/home/index' })
        return
      }
      this.setData({ userName: session.userName || this.data.userName })
    } catch (error) {
      const appError = toAppError(error)
      wx.showToast({ title: appError.message, icon: 'none' })
    }
  },

  setMode(event: any) {
    if (this.data.submitting) return
    this.setData({ mode: event.currentTarget.dataset.mode, errorMessage: '' })
  },

  onAgreementChange(event: any) { if (!this.data.submitting) this.setData({ termsAccepted: event.detail.value.includes('accepted') }) },
  openLegal(event: any) { wx.navigateTo({ url: `/pages/legal/index?type=${event.currentTarget.dataset.type === 'terms' ? 'terms' : 'privacy'}` }) },

  onFamilyName(event: any) {
    if (this.data.submitting) return
    this.setData({ familyName: event.detail.value })
  },

  onUserName(event: any) {
    if (this.data.submitting) return
    this.setData({ userName: event.detail.value })
  },

  onInviteCode(event: any) {
    if (this.data.submitting) return
    this.setData({ inviteCode: event.detail.value.trim().toUpperCase(), errorMessage: '' })
  },

  onChooseAvatar(event: ChooseAvatarEvent) {
    if (this.data.submitting) return
    this.setData({ avatarPath: event.detail.avatarUrl, avatarUrl: '' })
  },

  clearAvatar() { if (!this.data.submitting) this.setData({ avatarPath: '', avatarUrl: '' }) },

  async uploadAvatar(tempPath: string): Promise<string> {
    if (typeof wx.cloud?.uploadFile !== 'function') return ''
    const ext = tempPath.includes('.') ? tempPath.split('.').pop() : 'jpg'
    const cloudPath = `avatars/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const result = await wx.cloud.uploadFile({ cloudPath, filePath: tempPath })
    return result.fileID
  },

  async continue() {
    if (this.data.submitting) return
    if (!this.data.termsAccepted) { wx.showToast({ title: '请先阅读并同意协议', icon: 'none' }); return }
    this.setData({ submitting: true, errorMessage: '' })
    try {
      let avatarUrl = this.data.avatarUrl
      if (this.data.avatarPath && !avatarUrl) {
        try {
          avatarUrl = await this.uploadAvatar(this.data.avatarPath)
          this.setData({ avatarUrl })
        } catch (error) {
          wx.showToast({ title: '头像上传失败，可稍后再设置', icon: 'none' })
        }
      }
      await completeOnboarding({
        mode: this.data.mode,
        userName: this.data.userName,
        familyName: this.data.familyName,
        inviteCode: this.data.inviteCode,
        avatarUrl,
        termsAccepted: this.data.termsAccepted,
      })
      wx.switchTab({ url: '/pages/home/index' })
    } catch (error) {
      const appError = toAppError(error)
      this.setData({ errorMessage: appError.message })
      wx.showToast({ title: appError.message, icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },
})
