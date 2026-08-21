"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CloudSessionAdapter = void 0;
const app_error_1 = require("../../utils/app-error");
const validate_1 = require("./validate");
class CloudSessionAdapter {
    constructor(client) {
        this.client = client;
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
            userName: login.user.displayName,
            avatarUrl: login.user.avatarUrl || '',
            familyName: current.family.name,
            members: current.members.map((member) => member.displayName),
            source: 'cloud',
        };
    }
    async completeOnboarding(input) {
        const normalized = (0, validate_1.validateOnboardingInput)(input);
        if (normalized.mode === 'join') {
            throw new app_error_1.AppError('FEATURE_UNAVAILABLE', '云端加入家庭将在成员邀请阶段开放');
        }
        if (input.avatarUrl) {
            await this.client.call('auth', 'auth.updateProfile', {
                displayName: normalized.userName,
                avatarUrl: input.avatarUrl,
            });
        }
        await this.client.call('family', 'family.create', {
            name: normalized.familyName,
            displayName: normalized.userName,
            timezone: 'Asia/Shanghai',
        });
        return this.bootstrap();
    }
}
exports.CloudSessionAdapter = CloudSessionAdapter;
