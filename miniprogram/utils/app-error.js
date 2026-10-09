"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppError = void 0;
exports.toAppError = toAppError;
class AppError extends Error {
    constructor(code, message, requestId = '', details = {}) {
        super(message);
        this.code = code;
        this.requestId = requestId;
        this.details = details;
        this.name = 'AppError';
    }
}
exports.AppError = AppError;
function toAppError(error) {
    if (error instanceof AppError)
        return error;
    const cause = error instanceof Error ? error.message : String(error);
    const normalized = cause.toLowerCase();
    if (normalized.includes('environment not found') || normalized.includes('env not exists') || normalized.includes('invalid_env')) {
        return new AppError('CLOUD_ENV_NOT_FOUND', '云开发环境未就绪，请联系管理员', '', { cause });
    }
    if (normalized.includes('functionname parameter could not be found') || normalized.includes('function_not_found')) {
        return new AppError('CLOUD_FUNCTION_NOT_FOUND', '云函数尚未部署，请联系管理员', '', { cause });
    }
    if (/(collection|database|table|namespace)/.test(normalized) &&
        /(not found|not exist|does not exist|不存在|未找到|未创建)/.test(normalized)) {
        return new AppError('DATABASE_NOT_INITIALIZED', '数据库尚未初始化，请联系管理员', '', { cause });
    }
    return new AppError('NETWORK_ERROR', '网络没有连上，请检查后重试', '', { cause });
}
