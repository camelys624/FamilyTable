"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const store_1 = require("../../services/store");
Page({
    data: {
        groups: [],
        total: 0,
        checkedCount: 0,
        progress: 0,
        newItem: '',
        stale: false,
    },
    onShow() {
        let items = (0, store_1.getState)().shoppingItems;
        if (!items.length)
            items = (0, store_1.generateShoppingList)();
        this.renderItems(items);
    },
    renderItems(items) {
        const groupNames = ['蔬菜鲜食', '肉禽水产', '粮油调味', '手动添加'];
        const groups = groupNames
            .map((name) => ({ name, items: items.filter((item) => item.category === name) }))
            .filter((group) => group.items.length);
        const checkedCount = items.filter((item) => item.checked).length;
        this.setData({
            groups,
            total: items.length,
            checkedCount,
            progress: items.length ? Math.round((checkedCount / items.length) * 100) : 0,
            stale: (0, store_1.isShoppingListStale)(),
        });
    },
    toggleItem(event) {
        (0, store_1.toggleShoppingItem)(event.currentTarget.dataset.id);
        this.renderItems((0, store_1.getState)().shoppingItems);
    },
    onNewItem(event) {
        this.setData({ newItem: event.detail.value });
    },
    addItem() {
        const name = this.data.newItem.trim();
        if (!name)
            return;
        (0, store_1.addShoppingItem)(name);
        this.setData({ newItem: '' });
        this.renderItems((0, store_1.getState)().shoppingItems);
    },
    regenerate() {
        wx.showModal({
            title: '重新生成采购单？',
            content: '会按当前周菜单重新汇总，菜单食材的勾选状态将重置，手动添加项会保留。',
            confirmText: '重新生成',
            success: (result) => {
                if (result.confirm) {
                    this.renderItems((0, store_1.generateShoppingList)());
                    wx.showToast({ title: '已按菜单汇总', icon: 'success' });
                }
            },
        });
    },
    clearChecked() {
        if (!this.data.checkedCount) {
            wx.showToast({ title: '还没有已购食材', icon: 'none' });
            return;
        }
        wx.showModal({
            title: `清除 ${this.data.checkedCount} 项已购食材？`,
            content: '未购买的食材会继续保留。',
            confirmText: '清除已购',
            success: (result) => {
                if (result.confirm) {
                    (0, store_1.clearCheckedItems)();
                    this.renderItems((0, store_1.getState)().shoppingItems);
                }
            },
        });
    },
});
