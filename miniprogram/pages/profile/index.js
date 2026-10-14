"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const runtime_1 = require("../../config/runtime");
const index_1 = require("../../modules/family/index");
const index_2 = require("../../modules/session/index");
const app_error_1 = require("../../utils/app-error");
const request_id_1 = require("../../utils/request-id");
const index_3 = require("../../modules/preference/index");
const write_intent_1 = require("../../utils/write-intent");
Page({
    data: {
        familyName: '',
        userName: '',
        members: [],
        spicyLevel: 1,
        spicyLabel: '微辣',
        avoidFood: '',
        preferenceNotes: '',
        inviteCode: '',
        inviteExpiresAt: '',
        inviteExpiryLabel: '',
        invitationActive: false,
        canInvite: false,
        isLocal: runtime_1.runtimeConfig.repositoryMode === 'local',
        loading: false,
        inviting: false,
        familyError: '',
        familyMeta: '',
        preferenceLoading: false,
        preferenceSaving: false,
        preferenceError: '',
        preferencePending: false,
    },
    inviteRequestId: '',
    preferenceWriter: new write_intent_1.WriteIntent(),
    async onShow() {
        await this.loadFamily();
        if (!this.data.familyError)
            await this.loadPreferences();
    },
    async loadPreferences() {
        if (this.data.preferenceSaving || this.data.preferencePending || this.data.preferenceLoading)
            return;
        this.setData({ preferenceLoading: true, preferenceError: '' });
        try {
            const preference = await index_3.preferenceModule.getMine();
            this.setData({ spicyLevel: preference.spicyLevel, spicyLabel: this.getSpicyLabel(preference.spicyLevel), avoidFood: preference.avoidFoods.join('、'), preferenceNotes: preference.notes || '' });
        }
        catch (error) {
            this.setData({ preferenceError: (0, app_error_1.toAppError)(error).message });
        }
        finally {
            this.setData({ preferenceLoading: false });
        }
    },
    async loadFamily() {
        if (this.data.loading || this.data.inviting)
            return;
        this.setData({ loading: true, familyError: '' });
        try {
            const session = await (0, index_2.ensureSession)();
            if (!session.onboarded) {
                wx.reLaunch({ url: '/pages/onboarding/index' });
                return;
            }
            const current = await index_1.familyModule.getCurrentFamily();
            const tones = ['member-red', 'member-blue', 'member-green'];
            const members = current.members.map((member, index) => ({
                id: member.id, name: member.displayName, initial: Array.from(member.displayName)[0] || '家',
                role: member.role === 'owner' ? '家长' : '家庭成员',
                tone: tones[index % tones.length], isMe: member.id === current.currentMember.id,
            }));
            const keepCode = this.data.inviteExpiresAt === current.invitation.expiresAt && current.invitation.active;
            this.setData({
                familyName: current.family.name, userName: current.currentMember.displayName,
                members, familyMeta: `${members.length} 位家人 · 一起好好吃饭`,
                canInvite: current.currentMember.role === 'owner', invitationActive: current.invitation.active,
                ...(!keepCode && !this.data.isLocal ? { inviteCode: '', inviteExpiresAt: '', inviteExpiryLabel: '' } : {}),
            });
        }
        catch (error) {
            const appError = (0, app_error_1.toAppError)(error);
            this.setData({ familyName: '', members: [], familyMeta: '', inviteCode: '', canInvite: false, familyError: appError.message });
            if (['UNAUTHENTICATED', 'FAMILY_REQUIRED', 'NOT_FAMILY_MEMBER'].includes(appError.code)) {
                (0, index_2.clearSession)();
                wx.reLaunch({ url: '/pages/onboarding/index' });
            }
        }
        finally {
            this.setData({ loading: false });
        }
    },
    getSpicyLabel(level) {
        return ['不辣', '微辣', '中辣', '很辣'][level] || '微辣';
    },
    onSpicyChange(event) {
        if (this.data.preferenceLoading || this.data.preferenceSaving || this.data.preferencePending || this.data.preferenceError)
            return;
        const spicyLevel = Number(event.detail.value);
        this.setData({ spicyLevel, spicyLabel: this.getSpicyLabel(spicyLevel) });
    },
    onSpicySelect(event) {
        this.onSpicyChange({ detail: { value: Number(event.currentTarget.dataset.level) } });
    },
    onAvoidInput(event) {
        if (this.data.preferenceLoading || this.data.preferenceSaving || this.data.preferencePending || this.data.preferenceError)
            return;
        this.setData({ avoidFood: event.detail.value });
    },
    async saveAvoidFood() {
        if (this.data.preferenceLoading || this.data.preferenceSaving || (this.data.preferenceError && !this.data.preferencePending))
            return;
        const input = this.preferenceWriter.pending?.input || { spicyLevel: this.data.spicyLevel, avoidFoods: this.data.avoidFood.split(/[、，,\n]/).map((name) => name.trim()).filter(Boolean), notes: this.data.preferenceNotes };
        this.setData({ preferenceSaving: true, preferenceError: '' });
        try {
            await this.preferenceWriter.run('updateMine', input, (requestId) => index_3.preferenceModule.updateMine(input, requestId));
            this.setData({ preferencePending: false });
            wx.showToast({ title: '口味档案已保存', icon: 'success' });
        }
        catch (error) {
            this.setData({ preferencePending: Boolean(this.preferenceWriter.pending), preferenceError: (0, app_error_1.toAppError)(error).message });
        }
        finally {
            this.setData({ preferenceSaving: false });
        }
    },
    openSettings() { wx.navigateTo({ url: '/pages/settings/index' }); },
    copyInviteCode() {
        if (!this.data.inviteCode || Date.parse(this.data.inviteExpiresAt) <= Date.now()) {
            this.setData({ inviteCode: '', invitationActive: false });
            wx.showToast({ title: '请先生成有效邀请码', icon: 'none' });
            return;
        }
        wx.setClipboardData({
            data: this.data.inviteCode,
            success: () => wx.showToast({ title: '邀请码已复制', icon: 'success' }),
        });
    },
    async addMember() {
        if (this.data.loading || this.data.inviting || !this.data.canInvite)
            return;
        if (this.data.inviteCode && Date.parse(this.data.inviteExpiresAt) > Date.now()) {
            this.copyInviteCode();
            return;
        }
        if (this.data.invitationActive && !this.data.isLocal && !this.inviteRequestId) {
            wx.showModal({
                title: '生成新邀请码？', content: '之前的邀请码会立即失效，请把新码发给还没加入的家人。',
                confirmText: '生成新码', confirmColor: '#18332f',
                success: (result) => { if (result.confirm)
                    void this.createInvitation(); },
            });
            return;
        }
        await this.createInvitation();
    },
    async createInvitation() {
        if (this.data.inviting || this.data.loading || !this.data.canInvite)
            return;
        this.inviteRequestId = this.inviteRequestId || (0, request_id_1.createRequestId)();
        this.setData({ inviting: true, inviteCode: '', inviteExpiryLabel: '' });
        try {
            const invitation = await index_1.familyModule.createInvitation(this.inviteRequestId);
            const expires = new Date(invitation.expiresAt);
            // Asia/Shanghai matches the family's fixed timezone, independent of device settings.
            const local = new Date(expires.getTime() + 8 * 3600000);
            const label = `${local.getUTCMonth() + 1}月${local.getUTCDate()}日 ${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')} 前有效`;
            this.setData({ inviteCode: invitation.inviteCode, inviteExpiresAt: invitation.expiresAt,
                inviteExpiryLabel: label, invitationActive: true });
            this.inviteRequestId = '';
        }
        catch (error) {
            const appError = (0, app_error_1.toAppError)(error);
            if (appError.code !== 'NETWORK_ERROR' && appError.code !== 'REQUEST_IN_PROGRESS')
                this.inviteRequestId = '';
            if (appError.code === 'FORBIDDEN')
                this.setData({ canInvite: false });
            wx.showToast({ title: appError.message, icon: 'none' });
        }
        finally {
            this.setData({ inviting: false });
        }
    },
    rotateInvitation() {
        if (this.data.inviting || !this.data.canInvite)
            return;
        wx.showModal({
            title: '更换邀请码？', content: '旧码会立即失效，已加入的家人不受影响。',
            confirmText: '更换', confirmColor: '#18332f',
            success: (result) => { if (result.confirm)
                void this.createInvitation(); },
        });
    },
});
