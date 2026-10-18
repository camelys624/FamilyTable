import { runtimeConfig } from '../../config/runtime'
import { familyModule } from '../../modules/family/index'
import { clearSession, ensureSession } from '../../modules/session/index'
import { toAppError } from '../../utils/app-error'
import { createRequestId } from '../../utils/request-id'
import { preferenceModule } from '../../modules/preference/index'
import { WriteIntent } from '../../utils/write-intent'
import { ALLERGEN_OPTIONS, DISLIKE_OPTIONS, MAX_PREFERENCE_ITEMS, SPICY_OPTIONS } from '../../config/preference-options'
import { memberNameView } from '../../utils/display-name'

interface OptionView { name: string; checked: boolean }
interface SpicyView { level: number; label: string; heat: number; dots: number[] }

const TONES = ['member-red', 'member-blue', 'member-green']

Page({
  data: {
    familyName: '',
    userName: '',
    members: [] as Array<{ id: string; name: string; initial: string; isFallback: boolean; role: string; tone: string; isMe: boolean }>,
    myName: '',
    needProfileTip: false,

    spicyLevel: 1,
    spicyLabel: '微辣',
    dislikes: [] as string[],
    allergies: [] as string[],
    dislikeDraft: '',
    allergenDraft: '',
    dislikeOptions: [] as OptionView[],
    allergenOptions: [] as OptionView[],
    spicyOptions: [] as SpicyView[],
    openPicker: '',
    dirty: false,
    canSave: false,
    preferenceNotes: '',
    maxItems: MAX_PREFERENCE_ITEMS,

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
    preferenceLoading: false,
    preferenceSaving: false,
    /** 读取失败：口味表单不可信，必须先重新加载。 */
    preferenceError: '',
    /** 保存失败：草稿保留，可以修改后再次保存。 */
    preferenceSaveError: '',
    preferencePending: false,
  },

  inviteRequestId: '',
  preferenceWriter: new WriteIntent(),
  /** 已保存内容指纹，用于判断「有没有改过」。 */
  savedKey: '',

  async onShow() {
    await this.loadFamily()
    if (!this.data.familyError) await this.loadPreferences()
  },

  onHide() { this.setData({ openPicker: '' }) },

  async loadPreferences() {
    if (this.data.preferenceSaving || this.data.preferencePending || this.data.preferenceLoading) return
    // 从设置页等处返回时，不要用服务端旧值冲掉还没保存的修改。
    if (this.data.dirty && !this.data.preferenceError) return
    this.setData({ preferenceLoading: true, preferenceError: '', preferenceSaveError: '' })
    try {
      const preference = await preferenceModule.getMine()
      const dislikes = preference.avoidFoods || []
      const allergies = preference.allergies || []
      this.savedKey = this.preferenceKey({ spicyLevel: preference.spicyLevel, dislikes, allergies })
      this.setData({ spicyLevel: preference.spicyLevel, dislikes, allergies, preferenceNotes: preference.notes || '' })
      this.syncView()
    } catch (error) { this.setData({ preferenceError: toAppError(error).message }) }
    finally { this.setData({ preferenceLoading: false }) }
  },

  async loadFamily() {
    if (this.data.loading || this.data.inviting) return
    this.setData({ loading: true, familyError: '' })
    try {
      const session = await ensureSession()
      if (!session.onboarded) {
        wx.reLaunch({ url: '/pages/onboarding/index' })
        return
      }
      const current = await familyModule.getCurrentFamily()
      const members = current.members.map((member, index) => {
        const isMe = member.id === current.currentMember.id
        const view = memberNameView(member.displayName, index, isMe)
        return {
          id: member.id,
          name: view.name,
          initial: view.initial,
          isFallback: view.isFallback,
          // 角色统一用标签呈现：家长琥珀色，成员中性灰。
          role: member.role === 'owner' ? '家长' : '成员',
          tone: TONES[index % TONES.length],
          isMe,
        }
      })
      const me = members.filter((member) => member.isMe)[0]
      const keepCode = this.data.inviteExpiresAt === current.invitation.expiresAt && current.invitation.active
      this.setData({
        familyName: current.family.name, userName: current.currentMember.displayName,
        members, familyMeta: `${members.length} 位家人 · 一起好好吃饭`,
        myName: me ? me.name : '',
        needProfileTip: Boolean(me && me.isFallback),
        canInvite: current.currentMember.role === 'owner', invitationActive: current.invitation.active,
        ...(!keepCode && !this.data.isLocal ? { inviteCode: '', inviteExpiresAt: '', inviteExpiryLabel: '' } : {}),
      })
    } catch (error) {
      const appError = toAppError(error)
      this.setData({ familyName: '', members: [], familyMeta: '', inviteCode: '', canInvite: false, familyError: appError.message })
      if (['UNAUTHENTICATED', 'FAMILY_REQUIRED', 'NOT_FAMILY_MEMBER'].includes(appError.code)) {
        clearSession()
        wx.reLaunch({ url: '/pages/onboarding/index' })
      }
    } finally {
      this.setData({ loading: false })
    }
  },

  /* ---------- 口味：下拉选择 ---------- */

  getSpicyLabel(level: number) {
    const option = SPICY_OPTIONS.filter((item) => item.level === level)[0]
    return option ? option.label : '微辣'
  },

  preferenceKey(input: { spicyLevel: number; dislikes: string[]; allergies: string[] }) {
    return JSON.stringify({
      spicy: input.spicyLevel,
      dislikes: input.dislikes.slice().sort(),
      allergies: input.allergies.slice().sort(),
    })
  },

  /** 选项勾选态、下拉摘要、保存按钮是否可点，全部由这一处派生；草稿一变，旧的保存错误就不再适用。 */
  syncView() {
    const dislikes = this.data.dislikes
    const allergies = this.data.allergies
    const dirty = this.preferenceKey({ spicyLevel: this.data.spicyLevel, dislikes, allergies }) !== this.savedKey
    this.setData({
      dislikeOptions: DISLIKE_OPTIONS.map((name) => ({ name, checked: dislikes.indexOf(name) > -1 })),
      allergenOptions: ALLERGEN_OPTIONS.map((name) => ({ name, checked: allergies.indexOf(name) > -1 })),
      spicyOptions: SPICY_OPTIONS.map((item) => ({
        level: item.level, label: item.label, heat: item.heat,
        dots: Array.from({ length: item.heat }, (_, index) => index),
      })),
      spicyLabel: this.getSpicyLabel(this.data.spicyLevel),
      dirty,
      canSave: dirty || this.data.preferencePending,
      preferenceSaveError: '',
    })
  },

  /** 读取失败、正在读写、上次保存结果未确认时，都不允许改草稿。保存被拒绝不算，用户可以改完再存。 */
  canEditPreference() {
    return !(this.data.preferenceLoading || this.data.preferenceSaving || this.data.preferencePending || this.data.preferenceError)
  },

  togglePicker(event: any) {
    if (this.data.preferenceLoading || this.data.preferenceSaving) return
    const key = event.currentTarget.dataset.key
    this.setData({ openPicker: this.data.openPicker === key ? '' : key })
  },

  closePicker() { this.setData({ openPicker: '' }) },

  onDraftInput(event: any) {
    if (!this.canEditPreference()) return
    const key = event.currentTarget.dataset.key
    this.setData(key === 'allergen' ? { allergenDraft: event.detail.value } : { dislikeDraft: event.detail.value })
  },

  toggleOption(event: any) {
    if (!this.canEditPreference()) return
    const { key, value } = event.currentTarget.dataset
    const field = key === 'allergen' ? 'allergies' : 'dislikes'
    const list = (this.data[field] as string[]).slice()
    const index = list.indexOf(value)
    if (index > -1) list.splice(index, 1)
    else if (list.length >= MAX_PREFERENCE_ITEMS) {
      wx.showToast({ title: `最多 ${MAX_PREFERENCE_ITEMS} 项`, icon: 'none' })
      return
    } else list.push(value)
    this.setData({ [field]: list } as any)
    this.syncView()
  },

  removeTag(event: any) {
    if (!this.canEditPreference()) return
    const { key, value } = event.currentTarget.dataset
    const field = key === 'allergen' ? 'allergies' : 'dislikes'
    const list = (this.data[field] as string[]).filter((item) => item !== value)
    this.setData({ [field]: list } as any)
    this.syncView()
  },

  addCustom(event: any) {
    if (!this.canEditPreference()) return
    const isAllergen = event.currentTarget.dataset.key === 'allergen'
    const draftKey = isAllergen ? 'allergenDraft' : 'dislikeDraft'
    const field = isAllergen ? 'allergies' : 'dislikes'
    const value = String(this.data[draftKey] || '').trim()

    if (!value) {
      wx.showToast({ title: '先填写内容', icon: 'none' })
      return
    }
    const list = (this.data[field] as string[]).slice()
    if (list.indexOf(value) > -1) {
      this.setData({ [draftKey]: '' } as any)
      wx.showToast({ title: '已经在里面了', icon: 'none' })
      return
    }
    if (list.length >= MAX_PREFERENCE_ITEMS) {
      wx.showToast({ title: `最多 ${MAX_PREFERENCE_ITEMS} 项`, icon: 'none' })
      return
    }
    list.push(value)
    this.setData({ [field]: list, [draftKey]: '' } as any)
    this.syncView()
  },

  pickSpicy(event: any) {
    if (!this.canEditPreference()) return
    const level = Number(event.currentTarget.dataset.level)
    if (level === this.data.spicyLevel) {
      this.setData({ openPicker: '' })
      return
    }
    this.setData({ spicyLevel: level, openPicker: '' })
    this.syncView()
  },

  async onSave() {
    if (this.data.preferenceLoading || this.data.preferenceSaving) return
    // 读取失败时表单内容不可信，要求先重新加载；保存失败不拦，草稿还在，可以直接再存。
    if (this.data.preferenceError) return
    if (!this.data.dirty && !this.data.preferencePending) return

    // 上次结果未确认时，原样重放冻结的那次输入（同一个 requestId）；否则按当前草稿新建。
    const pending = this.preferenceWriter.pending
    const payload: any = pending ? pending.input : {
      spicyLevel: this.data.spicyLevel,
      avoidFoods: this.data.dislikes.slice(),
      notes: this.data.preferenceNotes,
    }
    // 过敏原是新增字段，未更新的 preference 云函数会以「请求包含不支持的字段」拒绝；
    // 空数组时不下发，没有过敏原的用户在旧环境里仍能保存。服务端缺省按空数组处理。
    if (!pending && this.data.allergies.length) payload.allergies = this.data.allergies.slice()

    this.setData({ preferenceSaving: true, preferenceSaveError: '' })
    try {
      await this.preferenceWriter.run('updateMine', payload, (requestId) => preferenceModule.updateMine(payload as any, requestId))
      const saved = {
        spicyLevel: payload.spicyLevel,
        dislikes: payload.avoidFoods || [],
        allergies: payload.allergies || [],
      }
      this.savedKey = this.preferenceKey(saved)
      this.setData({
        spicyLevel: saved.spicyLevel, dislikes: saved.dislikes, allergies: saved.allergies,
        preferencePending: false, openPicker: '',
      })
      this.syncView()
      wx.showToast({ title: '口味已保存', icon: 'success' })
    } catch (error) {
      const pendingNow = Boolean(this.preferenceWriter.pending)
      this.setData({ preferencePending: pendingNow, canSave: this.data.dirty || pendingNow, preferenceSaveError: toAppError(error).message })
    } finally {
      this.setData({ preferenceSaving: false })
    }
  },

  /* ---------- 设置 ---------- */

  openSettings() { wx.navigateTo({ url: '/pages/settings/index' }) },

  /* ---------- 邀请 ---------- */

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

})
