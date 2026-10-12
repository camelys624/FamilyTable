import { getState, resetDemo, updatePreferences } from '../../services/store'
import { runtimeConfig } from '../../config/runtime'
import { familyModule } from '../../modules/family/index'
import { clearSession, ensureSession } from '../../modules/session/index'
import { toAppError } from '../../utils/app-error'
import { createRequestId } from '../../utils/request-id'

Page({
  data: {
    familyName: '',
    userName: '',
    members: [] as Array<{ id: string; name: string; initial: string; role: string; tone: string; isMe: boolean }>,
    spicyLevel: 1,
    spicyLabel: '微辣',
    avoidFood: '',
    inviteCode: '',
    inviteExpiresAt: '',
    inviteExpiryLabel: '',
    invitationActive: false,
    canInvite: false,
    isLocal: runtimeConfig.repositoryMode === 'local',
    loading: false,
    inviting: false,
    familyError: '',
    familyMeta: '',
  },
  inviteRequestId: '',

  async onShow() {
    const state = getState()
    this.setData({
      spicyLevel: state.spicyLevel,
      spicyLabel: this.getSpicyLabel(state.spicyLevel),
      avoidFood: state.avoidFood,
    })
    await this.loadFamily()
  },

  async loadFamily() {
    if (this.data.loading || this.data.inviting) return
    this.setData({ loading: true, familyError: '', canInvite: false })
    try {
      const session = await ensureSession()
      if (!session.onboarded) {
        wx.reLaunch({ url: '/pages/onboarding/index' })
        return
      }
      const current = await familyModule.getCurrentFamily()
      const tones = ['member-red', 'member-blue', 'member-green']
      const members = current.members.map((member, index) => ({
        id: member.id, name: member.displayName, initial: member.displayName.slice(0, 1),
        role: member.role === 'owner' ? '管理员' : '家庭成员',
        tone: tones[index % tones.length], isMe: member.id === current.currentMember.id,
      }))
      const keepCode = this.data.inviteExpiresAt === current.invitation.expiresAt && current.invitation.active
      this.setData({
        familyName: current.family.name, userName: current.currentMember.displayName,
        members, familyMeta: `${members.length} 位家人 · 一起好好吃饭`,
        canInvite: current.currentMember.role === 'owner', invitationActive: current.invitation.active,
        ...(!keepCode && !this.data.isLocal ? { inviteCode: '', inviteExpiresAt: '', inviteExpiryLabel: '' } : {}),
      })
    } catch (error) {
      const appError = toAppError(error)
      this.setData({ familyName: '', members: [], familyMeta: '', inviteCode: '', familyError: appError.message })
      if (['UNAUTHENTICATED', 'FAMILY_REQUIRED', 'NOT_FAMILY_MEMBER'].includes(appError.code)) {
        clearSession()
        wx.reLaunch({ url: '/pages/onboarding/index' })
      }
    } finally {
      this.setData({ loading: false })
    }
  },

  getSpicyLabel(level: number) {
    return ['不辣', '微辣', '中辣', '很辣'][level] || '微辣'
  },

  onSpicyChange(event: any) {
    const spicyLevel = Number(event.detail.value)
    this.setData({ spicyLevel, spicyLabel: this.getSpicyLabel(spicyLevel) })
    updatePreferences(spicyLevel, this.data.avoidFood)
  },

  onAvoidInput(event: any) {
    this.setData({ avoidFood: event.detail.value })
  },

  saveAvoidFood() {
    updatePreferences(this.data.spicyLevel, this.data.avoidFood.trim())
    wx.showToast({ title: '已保存到本机', icon: 'success' })
  },

  copyInviteCode() {
    if (!this.data.inviteCode || Date.parse(this.data.inviteExpiresAt) <= Date.now()) {
      this.setData({ inviteCode: '', invitationActive: false })
      wx.showToast({ title: '请先生成有效邀请码', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: this.data.inviteCode,
      success: () => wx.showToast({ title: '邀请码已复制', icon: 'success' }),
    })
  },

  async addMember() {
    if (this.data.loading || this.data.inviting || !this.data.canInvite) return
    if (this.data.inviteCode && Date.parse(this.data.inviteExpiresAt) > Date.now()) {
      this.copyInviteCode()
      return
    }
    if (this.data.invitationActive && !this.data.isLocal && !this.inviteRequestId) {
      wx.showModal({
        title: '生成新邀请码？', content: '之前的邀请码会立即失效，请把新码发给还没加入的家人。',
        confirmText: '生成新码', confirmColor: '#18332f',
        success: (result: any) => { if (result.confirm) void this.createInvitation() },
      })
      return
    }
    await this.createInvitation()
  },

  async createInvitation() {
    if (this.data.inviting || this.data.loading || !this.data.canInvite) return
    this.inviteRequestId = this.inviteRequestId || createRequestId()
    this.setData({ inviting: true, inviteCode: '', inviteExpiryLabel: '' })
    try {
      const invitation = await familyModule.createInvitation(this.inviteRequestId)
      const expires = new Date(invitation.expiresAt)
      // Asia/Shanghai matches the family's fixed timezone, independent of device settings.
      const local = new Date(expires.getTime() + 8 * 3600000)
      const label = `${local.getUTCMonth() + 1}月${local.getUTCDate()}日 ${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')} 前有效`
      this.setData({ inviteCode: invitation.inviteCode, inviteExpiresAt: invitation.expiresAt,
        inviteExpiryLabel: label, invitationActive: true })
      this.inviteRequestId = ''
    } catch (error) {
      const appError = toAppError(error)
      if (appError.code !== 'NETWORK_ERROR' && appError.code !== 'REQUEST_IN_PROGRESS') this.inviteRequestId = ''
      if (appError.code === 'FORBIDDEN') this.setData({ canInvite: false })
      wx.showToast({ title: appError.message, icon: 'none' })
    } finally {
      this.setData({ inviting: false })
    }
  },

  rotateInvitation() {
    if (this.data.inviting || !this.data.canInvite) return
    wx.showModal({
      title: '更换邀请码？', content: '旧码会立即失效，已加入的家人不受影响。',
      confirmText: '更换', confirmColor: '#18332f',
      success: (result: any) => { if (result.confirm) void this.createInvitation() },
    })
  },

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
