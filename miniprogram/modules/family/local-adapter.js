"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalFamilyAdapter = void 0;
const store_1 = require("../../services/store");
const app_error_1 = require("../../utils/app-error");
class LocalFamilyAdapter {
    constructor() {
        this.infoVersion = 0;
    }
    async getCurrentFamily() {
        const state = (0, store_1.getState)();
        const members = state.members.map((name, index) => ({
            id: `local-${index}`, displayName: name, role: index === 0 ? 'owner' : 'member',
        }));
        return {
            family: { id: 'local-family', name: state.familyName, infoVersion: this.infoVersion },
            currentMember: members.find((member) => member.displayName === state.userName) || members[0],
            members, invitation: { active: false, expiresAt: '' },
        };
    }
    async createInvitation() {
        return { familyId: 'local-family', inviteCode: store_1.DEMO_INVITE_CODE, expiresAt: new Date(Date.now() + 72 * 3600000).toISOString() };
    }
    async updateFamily(name, expectedVersion) {
        const current = await this.getCurrentFamily();
        if (current.currentMember.role !== 'owner')
            throw new app_error_1.AppError('FORBIDDEN', '只有饭桌家长可以修改饭桌信息');
        const trimmed = name.trim();
        if (!trimmed || trimmed.length > 40)
            throw new app_error_1.AppError('VALIDATION_ERROR', '饭桌名称需填写 1～40 个字');
        if (expectedVersion !== this.infoVersion)
            throw new app_error_1.AppError('VERSION_CONFLICT', '饭桌信息已更新，请重新加载后修改');
        const state = (0, store_1.getState)();
        state.familyName = trimmed;
        (0, store_1.saveState)(state);
        this.infoVersion++;
        return { family: { id: 'local-family', name: trimmed, infoVersion: this.infoVersion } };
    }
}
exports.LocalFamilyAdapter = LocalFamilyAdapter;
