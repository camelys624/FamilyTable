"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../../modules/session/index");
const app_error_1 = require("../../utils/app-error");
const runtime_1 = require("../../config/runtime");
Page({
    data: {
        mode: 'create',
        familyName: '林家小饭桌',
        userName: '小满',
        inviteCode: '',
        avatarPath: '',
        avatarUrl: '',
        submitting: false,
        isLocal: runtime_1.runtimeConfig.repositoryMode === 'local',
        errorMessage: '',
        termsAccepted: false,
    },
    async onLoad() {
        try {
            const session = await (0, index_1.ensureSession)();
            if (session.onboarded) {
                wx.switchTab({ url: '/pages/home/index' });
                return;
            }
            this.setData({ userName: session.userName || this.data.userName });
        }
        catch (error) {
            const appError = (0, app_error_1.toAppError)(error);
            wx.showToast({ title: appError.message, icon: 'none' });
        }
    },
    setMode(event) {
        if (this.data.submitting)
            return;
        this.setData({ mode: event.currentTarget.dataset.mode, errorMessage: '' });
    },
    onAgreementChange(event) { if (!this.data.submitting)
        this.setData({ termsAccepted: event.detail.value.includes('accepted') }); },
    openLegal(event) { wx.navigateTo({ url: `/pages/legal/index?type=${event.currentTarget.dataset.type === 'terms' ? 'terms' : 'privacy'}` }); },
    onFamilyName(event) {
        if (this.data.submitting)
            return;
        this.setData({ familyName: event.detail.value });
    },
    onUserName(event) {
        if (this.data.submitting)
            return;
        this.setData({ userName: event.detail.value });
    },
    onInviteCode(event) {
        if (this.data.submitting)
            return;
        this.setData({ inviteCode: event.detail.value.trim().toUpperCase(), errorMessage: '' });
    },
    onChooseAvatar(event) {
        if (this.data.submitting)
            return;
        this.setData({ avatarPath: event.detail.avatarUrl, avatarUrl: '' });
    },
    clearAvatar() { if (!this.data.submitting)
        this.setData({ avatarPath: '', avatarUrl: '' }); },
    async uploadAvatar(tempPath) {
        if (typeof wx.cloud?.uploadFile !== 'function')
            return '';
        const ext = tempPath.includes('.') ? tempPath.split('.').pop() : 'jpg';
        const cloudPath = `avatars/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const result = await wx.cloud.uploadFile({ cloudPath, filePath: tempPath });
        return result.fileID;
    },
    async continue() {
        if (this.data.submitting)
            return;
        if (!this.data.termsAccepted) {
            wx.showToast({ title: '请先阅读并同意协议', icon: 'none' });
            return;
        }
        this.setData({ submitting: true, errorMessage: '' });
        try {
            let avatarUrl = this.data.avatarUrl;
            if (this.data.avatarPath && !avatarUrl) {
                try {
                    avatarUrl = await this.uploadAvatar(this.data.avatarPath);
                    this.setData({ avatarUrl });
                }
                catch (error) {
                    wx.showToast({ title: '头像上传失败，可稍后再设置', icon: 'none' });
                }
            }
            await (0, index_1.completeOnboarding)({
                mode: this.data.mode,
                userName: this.data.userName,
                familyName: this.data.familyName,
                inviteCode: this.data.inviteCode,
                avatarUrl,
                termsAccepted: this.data.termsAccepted,
            });
            wx.switchTab({ url: '/pages/home/index' });
        }
        catch (error) {
            const appError = (0, app_error_1.toAppError)(error);
            this.setData({ errorMessage: appError.message });
            wx.showToast({ title: appError.message, icon: 'none' });
        }
        finally {
            this.setData({ submitting: false });
        }
    },
});
