"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../../modules/shopping/index");
const index_2 = require("../../modules/session/index");
const date_1 = require("../../utils/date");
const app_error_1 = require("../../utils/app-error");
const write_intent_1 = require("../../utils/write-intent");
Page({
    data: { groups: [], total: 0, checkedCount: 0, progress: 0, newItem: '', stale: false, loading: false, saving: false, loadError: '', writeError: '', pending: false, listId: '', version: 0, weekStart: '' },
    writer: new write_intent_1.WriteIntent(),
    items: [],
    async onShow() { await this.loadData(); },
    async onPullDownRefresh() { await this.loadData(); wx.stopPullDownRefresh(); },
    async loadData() {
        if (this.data.loading || this.data.saving)
            return;
        this.setData({ loading: true, loadError: '' });
        try {
            const session = await (0, index_2.ensureSession)();
            if (!session.onboarded) {
                wx.reLaunch({ url: '/pages/onboarding/index' });
                return;
            }
            this.renderItems(await index_1.shoppingModule.getList(this.data.weekStart || (0, date_1.getCurrentWeekKey)()));
        }
        catch (error) {
            this.setData({ loadError: (0, app_error_1.toAppError)(error).message });
        }
        finally {
            this.setData({ loading: false });
        }
    },
    renderItems(list) {
        this.items = list.items;
        const names = ['蔬菜鲜食', '肉禽水产', '粮油调味', '手动添加'];
        const groups = names.map((name) => ({ name, items: list.items.filter((item) => item.category === name) })).filter((group) => group.items.length);
        const checkedCount = list.items.filter((item) => item.checked).length;
        this.setData({ groups, total: list.items.length, checkedCount, progress: list.items.length ? Math.round(checkedCount / list.items.length * 100) : 0, stale: list.stale, listId: list.id, weekStart: list.weekStart, version: list.version });
    },
    mutation() { return { listId: this.data.listId, weekStart: this.data.weekStart, expectedVersion: this.data.version }; },
    blocked() { return this.data.loading || this.data.saving || this.data.pending || Boolean(this.data.loadError); },
    onNewItem(event) { if (!this.blocked())
        this.setData({ newItem: event.detail.value }); },
    async toggleItem(event) {
        if (this.blocked())
            return;
        const item = this.items.find((entry) => entry.id === event.currentTarget.dataset.id);
        if (item)
            await this.write('checkItem', { ...this.mutation(), itemId: item.id, checked: !item.checked });
    },
    async addItem() { if (!this.blocked() && this.data.newItem.trim())
        await this.write('addItem', { ...this.mutation(), name: this.data.newItem.trim() }); },
    regenerate() {
        if (this.blocked())
            return;
        wx.showModal({ title: '重新汇总采购单？', content: '按当前云端周菜单汇总。菜单来源食材的勾选会重置，手动添加项会保留。', confirmText: '重新汇总', success: (result) => { if (result.confirm && !this.blocked())
                void this.write('generate', { weekStart: this.data.weekStart, replaceExisting: true }); } });
    },
    clearChecked() {
        if (this.blocked() || !this.data.checkedCount)
            return;
        wx.showModal({ title: `清除 ${this.data.checkedCount} 项已购食材？`, content: '未购买的食材会继续保留。', confirmText: '清除已购', success: (result) => { if (result.confirm && !this.blocked())
                void this.write('clearChecked', this.mutation()); } });
    },
    async invoke(action, input, requestId) {
        if (action === 'generate')
            return index_1.shoppingModule.generate(input.weekStart, input.replaceExisting, requestId);
        if (action === 'addItem')
            return index_1.shoppingModule.addItem(input, requestId);
        if (action === 'checkItem')
            return index_1.shoppingModule.checkItem(input, requestId);
        return index_1.shoppingModule.clearChecked(input, requestId);
    },
    async write(action, input) {
        if (this.data.saving || this.data.loading)
            return;
        this.setData({ saving: true, writeError: '' });
        try {
            const list = await this.writer.run(action, input, (requestId) => this.invoke(action, input, requestId));
            this.renderItems(list);
            this.setData({ pending: false, ...(action === 'addItem' ? { newItem: '' } : {}) });
            wx.showToast({ title: '采购单已更新', icon: 'success' });
            this.setData({ saving: false });
            await this.loadData();
        }
        catch (error) {
            const failure = (0, app_error_1.toAppError)(error);
            this.setData({ writeError: failure.message, pending: Boolean(this.writer.pending) });
            if (failure.code === 'VERSION_CONFLICT') {
                this.setData({ saving: false });
                await this.loadData();
            }
        }
        finally {
            this.setData({ saving: false });
        }
    },
    async retryPending() { const pending = this.writer.pending; if (pending)
        await this.write(pending.action, pending.input); },
});
