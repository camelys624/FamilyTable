"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CloudFamilyAdapter = void 0;
class CloudFamilyAdapter {
    constructor(client) {
        this.client = client;
    }
    async getCurrentFamily() {
        const current = await this.client.call('family', 'family.current');
        return { ...current, invitation: current.invitation || { active: false, expiresAt: '' } };
    }
    createInvitation(requestId) {
        return this.client.call('family', 'family.invite', { expiresInHours: 72 }, requestId);
    }
}
exports.CloudFamilyAdapter = CloudFamilyAdapter;
