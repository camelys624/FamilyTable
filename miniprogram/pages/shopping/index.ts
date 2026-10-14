import { ShoppingItem } from '../../models/types'
import { shoppingModule, ShoppingList } from '../../modules/shopping/index'
import { ensureSession } from '../../modules/session/index'
import { getCurrentWeekKey } from '../../utils/date'
import { toAppError } from '../../utils/app-error'
import { WriteIntent } from '../../utils/write-intent'

Page({
  data: { groups: [] as Array<{ name: string; items: ShoppingItem[] }>, total: 0, checkedCount: 0, progress: 0, newItem: '', stale: false, loading: false, saving: false, loadError: '', writeError: '', pending: false, listId: '', version: 0, weekStart: '' },
  writer: new WriteIntent(),
  items: [] as ShoppingItem[],
  async onShow() { await this.loadData() },
  async onPullDownRefresh() { await this.loadData(); wx.stopPullDownRefresh() },
  async loadData() {
    if (this.data.loading || this.data.saving) return
    this.setData({ loading: true, loadError: '' })
    try {
      const session = await ensureSession()
      if (!session.onboarded) { wx.reLaunch({ url: '/pages/onboarding/index' }); return }
      this.renderItems(await shoppingModule.getList(this.data.weekStart || getCurrentWeekKey()))
    } catch (error) { this.setData({ loadError: toAppError(error).message }) }
    finally { this.setData({ loading: false }) }
  },
  renderItems(list: ShoppingList) {
    this.items = list.items
    const names = ['蔬菜鲜食', '肉禽水产', '粮油调味', '手动添加']
    const groups = names.map((name) => ({ name, items: list.items.filter((item) => item.category === name) })).filter((group) => group.items.length)
    const checkedCount = list.items.filter((item) => item.checked).length
    this.setData({ groups, total: list.items.length, checkedCount, progress: list.items.length ? Math.round(checkedCount / list.items.length * 100) : 0, stale: list.stale, listId: list.id, weekStart: list.weekStart, version: list.version })
  },
  mutation() { return { listId: this.data.listId, weekStart: this.data.weekStart, expectedVersion: this.data.version } },
  blocked() { return this.data.loading || this.data.saving || this.data.pending || Boolean(this.data.loadError) },
  onNewItem(event: any) { if (!this.blocked()) this.setData({ newItem: event.detail.value }) },
  async toggleItem(event: any) {
    if (this.blocked()) return
    const item = this.items.find((entry) => entry.id === event.currentTarget.dataset.id)
    if (item) await this.write('checkItem', { ...this.mutation(), itemId: item.id, checked: !item.checked })
  },
  async addItem() { if (!this.blocked() && this.data.newItem.trim()) await this.write('addItem', { ...this.mutation(), name: this.data.newItem.trim() }) },
  regenerate() {
    if (this.blocked()) return
    wx.showModal({ title: '重新汇总采购单？', content: '按当前云端周菜单汇总。菜单来源食材的勾选会重置，手动添加项会保留。', confirmText: '重新汇总', success: (result: any) => { if (result.confirm && !this.blocked()) void this.write('generate', { weekStart: this.data.weekStart, replaceExisting: true }) } })
  },
  clearChecked() {
    if (this.blocked() || !this.data.checkedCount) return
    wx.showModal({ title: `清除 ${this.data.checkedCount} 项已购食材？`, content: '未购买的食材会继续保留。', confirmText: '清除已购', success: (result: any) => { if (result.confirm && !this.blocked()) void this.write('clearChecked', this.mutation()) } })
  },
  async invoke(action: string, input: any, requestId: string) {
    if (action === 'generate') return shoppingModule.generate(input.weekStart, input.replaceExisting, requestId)
    if (action === 'addItem') return shoppingModule.addItem(input, requestId)
    if (action === 'checkItem') return shoppingModule.checkItem(input, requestId)
    return shoppingModule.clearChecked(input, requestId)
  },
  async write(action: string, input: Record<string, unknown>) {
    if (this.data.saving || this.data.loading) return
    this.setData({ saving: true, writeError: '' })
    try {
      const list = await this.writer.run(action, input, (requestId) => this.invoke(action, input, requestId))
      this.renderItems(list)
      this.setData({ pending: false, ...(action === 'addItem' ? { newItem: '' } : {}) })
      wx.showToast({ title: '采购单已更新', icon: 'success' })
      this.setData({ saving: false })
      await this.loadData()
    } catch (error) {
      const failure = toAppError(error)
      this.setData({ writeError: failure.message, pending: Boolean(this.writer.pending) })
      if (failure.code === 'VERSION_CONFLICT') { this.setData({ saving: false }); await this.loadData() }
    } finally { this.setData({ saving: false }) }
  },
  async retryPending() { const pending = this.writer.pending; if (pending) await this.write(pending.action, pending.input) },
})
