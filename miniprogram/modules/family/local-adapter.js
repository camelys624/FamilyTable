"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalFamilyAdapter = void 0;
const store_1 = require("../../services/store");
class LocalFamilyAdapter {
    async getCurrentFamily() {
        const state = (0, store_1.getState)();
        const members = state.members.map((name, index) => ({
            id: `local-${index}`, displayName: name, role: index === 0 ? 'owner' : 'member',
        }));
        return {
            family: { id: 'local-family', name: state.familyName },
            currentMember: members.find((member) => member.displayName === state.userName) || members[0],
            members, invitation: { active: false, expiresAt: '' },
        };
    }
    async createInvitation() {
        return { familyId: 'local-family', inviteCode: store_1.DEMO_INVITE_CODE, expiresAt: new Date(Date.now() + 72 * 3600000).toISOString() };
    }
}
exports.LocalFamilyAdapter = LocalFamilyAdapter;
