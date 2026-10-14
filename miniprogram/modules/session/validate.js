"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateOnboardingInput = validateOnboardingInput;
const app_error_1 = require("../../utils/app-error");
function validateOnboardingInput(input) {
    if (input.termsAccepted !== true)
        throw new app_error_1.AppError('VALIDATION_ERROR', '请先阅读并同意用户协议和隐私政策');
    const userName = input.userName.trim();
    const familyName = (input.familyName || '').trim();
    const inviteCode = (input.inviteCode || '').trim().toUpperCase();
    if (!userName)
        throw new app_error_1.AppError('VALIDATION_ERROR', '先写下你的称呼');
    if (userName.length > 12)
        throw new app_error_1.AppError('VALIDATION_ERROR', '称呼最多填写 12 个字');
    if (input.mode === 'create' && !familyName)
        throw new app_error_1.AppError('VALIDATION_ERROR', '给小饭桌取个名字');
    if (familyName.length > 20)
        throw new app_error_1.AppError('VALIDATION_ERROR', '家庭名称最多填写 20 个字');
    if (input.mode !== 'create' && input.mode !== 'join')
        throw new app_error_1.AppError('VALIDATION_ERROR', '请选择创建或加入家庭');
    if (input.mode === 'join' && !/^[A-HJ-NP-Z2-9]{8}$/.test(inviteCode))
        throw new app_error_1.AppError('VALIDATION_ERROR', '请填写 8 位家庭邀请码');
    return { mode: input.mode, userName, familyName, inviteCode };
}
