"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const legal_1 = require("../../config/legal");
Page({
    data: { ...legal_1.legalConfig, type: 'privacy' },
    onLoad(options) { this.setData({ type: options.type === 'terms' ? 'terms' : 'privacy' }); },
    showPrivacy() { this.setData({ type: 'privacy' }); },
    showTerms() { this.setData({ type: 'terms' }); },
    copyContact() { wx.setClipboardData({ data: legal_1.legalConfig.contactEmail }); },
    openWechatPrivacy() {
        if (typeof wx.openPrivacyContract !== 'function') {
            wx.showToast({ title: '请使用较新版本微信查看', icon: 'none' });
            return;
        }
        wx.openPrivacyContract({ fail: () => wx.showToast({ title: '暂时无法打开，请稍后再试', icon: 'none' }) });
    },
});
