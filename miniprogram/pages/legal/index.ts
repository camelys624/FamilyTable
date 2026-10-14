import { legalConfig } from '../../config/legal'
Page({
  data: { ...legalConfig, type: 'privacy' },
  onLoad(options: Record<string, string>) { this.setData({ type: options.type === 'terms' ? 'terms' : 'privacy' }) },
  showPrivacy() { this.setData({ type: 'privacy' }) },
  showTerms() { this.setData({ type: 'terms' }) },
  copyContact() { wx.setClipboardData({ data: legalConfig.contactEmail }) },
  openWechatPrivacy() {
    if (typeof wx.openPrivacyContract !== 'function') { wx.showToast({ title: '请使用较新版本微信查看', icon: 'none' }); return }
    wx.openPrivacyContract({ fail: () => wx.showToast({ title: '暂时无法打开，请稍后再试', icon: 'none' }) })
  },
})
