"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CloudSessionAdapter = void 0;
const request_id_1 = require("../../utils/request-id");
const legal_1 = require("../../config/legal");
const validate_1 = require("./validate");
class CloudSessionAdapter {
    constructor(client) {
        this.client = client;
        this.onboardingRequest = null;
    }
    async bootstrap() {
        const login = await this.client.call('auth', 'auth.login');
        if (!login.family || login.onboardingRequired) {
            return {
                onboarded: false,
                userName: login.user.displayName,
                avatarUrl: login.user.avatarUrl || '',
                familyName: '',
                members: [],
                source: 'cloud',
            };
        }
        const current = await this.client.call('family', 'family.current');
        return {
            onboarded: true,
            userName: current.currentMember?.displayName || login.user.displayName,
            avatarUrl: login.user.avatarUrl || '',
            familyName: current.family.name,
            members: current.members.map((member) => member.displayName),
            source: 'cloud',
        };
    }
    async completeOnboarding(input) {
        const normalized = (0, validate_1.validateOnboardingInput)(input);
        const key = JSON.stringify(normalized);
        if (this.onboardingRequest?.key !== key)
            this.onboardingRequest = { key, requestId: (0, request_id_1.createRequestId)() };
        const requestId = this.onboardingRequest.requestId;
        await this.client.call('auth', 'auth.acceptTerms', { version: legal_1.legalConfig.version }, `${requestId}_terms`);
        if (input.avatarUrl) {
            await this.client.call('auth', 'auth.updateProfile', {
                displayName: normalized.userName,
                avatarUrl: input.avatarUrl,
            });
        }
        if (normalized.mode === 'join') {
            await this.client.call('family', 'family.join', {
                inviteCode: normalized.inviteCode, displayName: normalized.userName,
            }, requestId);
        }
        else {
            await this.client.call('family', 'family.create', {
                name: normalized.familyName, displayName: normalized.userName, timezone: 'Asia/Shanghai',
            }, requestId);
        }
        const snapshot = await this.bootstrap();
        this.onboardingRequest = null;
        return snapshot;
    }
}
exports.CloudSessionAdapter = CloudSessionAdapter;
