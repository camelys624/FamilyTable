"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalSessionAdapter = void 0;
const store_1 = require("../../services/store");
const app_error_1 = require("../../utils/app-error");
const validate_1 = require("./validate");
function toSnapshot() {
    const state = (0, store_1.ensureState)();
    return {
        onboarded: state.onboarded,
        userName: state.userName,
        avatarUrl: '',
        familyName: state.familyName,
        members: [...state.members],
        source: 'local',
    };
}
class LocalSessionAdapter {
    async bootstrap() {
        return toSnapshot();
    }
    async completeOnboarding(input) {
        const normalized = (0, validate_1.validateOnboardingInput)(input);
        if (normalized.mode === 'join' && normalized.inviteCode !== store_1.DEMO_INVITE_CODE) {
            throw new app_error_1.AppError('VALIDATION_ERROR', `本地体验版请使用 ${store_1.DEMO_INVITE_CODE}`);
        }
        const familyName = normalized.mode === 'join' ? '团团家的饭桌' : normalized.familyName;
        (0, store_1.finishOnboarding)(familyName, normalized.userName);
        return toSnapshot();
    }
}
exports.LocalSessionAdapter = LocalSessionAdapter;
