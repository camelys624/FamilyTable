import { ShoppingItem } from '../../models/types'
import {
  addShoppingItem,
  clearCheckedItems,
  generateShoppingList,
  getState,
  isShoppingListStale,
  toggleShoppingItem,
} from '../../services/store'

Page({
  data: {
    groups: [] as Array<{ name: string; items: ShoppingItem[] }>,
    total: 0,
    checkedCount: 0,
    progress: 0,
    newItem: '',
    stale: false,
  },

  onShow() {
    let items = getState().shoppingItems
    if (!items.length) items = generateShoppingList()
    this.renderItems(items)
  },

  renderItems(items: ShoppingItem[]) {
    const groupNames = ['蔬菜鲜食', '肉禽水产', '粮油调味', '手动添加']
    const groups = groupNames
      .map((name) => ({ name, items: items.filter((item) => item.category === name) }))
      .filter((group) => group.items.length)
    const checkedCount = items.filter((item) => item.checked).length
    this.setData({
      groups,
      total: items.length,
      checkedCount,
      progress: items.length ? Math.round((checkedCount / items.length) * 100) : 0,
      stale: isShoppingListStale(),
    })
  },

  toggleItem(event: any) {
    toggleShoppingItem(event.currentTarget.dataset.id)
    this.renderItems(getState().shoppingItems)
  },

  onNewItem(event: any) {
    this.setData({ newItem: event.detail.value })
  },

  addItem() {
    const name = this.data.newItem.trim()
    if (!name) return
    addShoppingItem(name)
    this.setData({ newItem: '' })
    this.renderItems(getState().shoppingItems)
  },

  regenerate() {
    wx.showModal({
      title: '重新生成采购单？',
      content: '会按当前周菜单重新汇总，菜单食材的勾选状态将重置，手动添加项会保留。',
      confirmText: '重新生成',
      success: (result: any) => {
        if (result.confirm) {
          this.renderItems(generateShoppingList())
          wx.showToast({ title: '已按菜单汇总', icon: 'success' })
        }
      },
    })
  },

  clearChecked() {
    if (!this.data.checkedCount) {
      wx.showToast({ title: '还没有已购食材', icon: 'none' })
      return
    }
    wx.showModal({
      title: `清除 ${this.data.checkedCount} 项已购食材？`,
      content: '未购买的食材会继续保留。',
      confirmText: '清除已购',
      success: (result: any) => {
        if (result.confirm) {
          clearCheckedItems()
          this.renderItems(getState().shoppingItems)
        }
      },
    })
  },
})
