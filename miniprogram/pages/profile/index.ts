import { DEMO_INVITE_CODE, getState, resetDemo, updatePreferences } from '../../services/store'

Page({
  data: {
    familyName: '',
    userName: '',
    members: [] as Array<{ name: string; initial: string; role: string; tone: string }>,
    spicyLevel: 1,
    spicyLabel: '微辣',
    avoidFood: '',
    inviteCode: DEMO_INVITE_CODE,
    familyMeta: '',
  },

  onShow() {
    const state = getState()
    const tones = ['member-red', 'member-blue', 'member-green']
    const members = state.members.map((name, index) => ({
      name,
      initial: name.slice(0, 1),
      role: index === 0 ? '管理员' : '家庭成员',
      tone: tones[index % tones.length],
    }))
    const mealCount = state.weekMenu.reduce((total, day) => total + day.breakfast.length + day.lunch.length + day.dinner.length, 0)
    this.setData({
      familyName: state.familyName,
      userName: state.userName,
      members,
      spicyLevel: state.spicyLevel,
      spicyLabel: this.getSpicyLabel(state.spicyLevel),
      avoidFood: state.avoidFood,
      familyMeta: `${state.members.length} 位家人 · 本周已安排 ${mealCount} 道菜`,
    })
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
    wx.showToast({ title: '饮食偏好已保存', icon: 'success' })
  },

  copyInviteCode() {
    wx.setClipboardData({
      data: this.data.inviteCode,
      success: () => wx.showToast({ title: '邀请码已复制', icon: 'success' }),
    })
  },

  addMember() {
    this.copyInviteCode()
  },

  resetDemo() {
    wx.showModal({
      title: '重置体验数据？',
      content: '新增菜谱、菜单调整和采购勾选都会恢复为初始状态。',
      confirmColor: '#d94f3d',
      confirmText: '确认重置',
      success: (result: any) => {
        if (result.confirm) {
          resetDemo()
          wx.reLaunch({ url: '/pages/onboarding/index' })
        }
      },
    })
  },
})
