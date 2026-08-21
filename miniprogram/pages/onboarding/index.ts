import { completeOnboarding, ensureSession } from '../../modules/session/index'
import { toAppError } from '../../utils/app-error'

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
    this.setData({ mode: event.currentTarget.dataset.mode })
  },

  onFamilyName(event: any) {
    this.setData({ familyName: event.detail.value })
  },

  onUserName(event: any) {
    this.setData({ userName: event.detail.value })
  },

  onInviteCode(event: any) {
    this.setData({ inviteCode: event.detail.value })
  },

  onChooseAvatar(event: ChooseAvatarEvent) {
    this.setData({ avatarPath: event.detail.avatarUrl, avatarUrl: '' })
  },

  async uploadAvatar(tempPath: string): Promise<string> {
    if (typeof wx.cloud?.uploadFile !== 'function') return ''
    const ext = tempPath.includes('.') ? tempPath.split('.').pop() : 'jpg'
    const cloudPath = `avatars/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const result = await wx.cloud.uploadFile({ cloudPath, filePath: tempPath })
    return result.fileID
  },

  async continue() {
    if (this.data.submitting) return
    this.setData({ submitting: true })
    try {
      let avatarUrl = this.data.avatarUrl
      if (this.data.avatarPath) {
        try {
          avatarUrl = await this.uploadAvatar(this.data.avatarPath)
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
      })
      wx.switchTab({ url: '/pages/home/index' })
    } catch (error) {
      const appError = toAppError(error)
      wx.showToast({ title: appError.message, icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },
})
