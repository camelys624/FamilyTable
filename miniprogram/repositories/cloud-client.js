"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CloudClient = void 0;
exports.createWxCloudClient = createWxCloudClient;
const app_error_1 = require("../utils/app-error");
const request_id_1 = require("../utils/request-id");
class CloudClient {
    constructor(transport) {
        this.transport = transport;
    }
    async call(functionName, action, payload = {}) {
        const requestId = (0, request_id_1.createRequestId)();
        try {
            const response = await this.transport.callFunction({
                name: functionName,
                data: { action, payload, requestId },
            });
            const result = response.result;
            if (!result || typeof result.ok !== 'boolean') {
                throw new app_error_1.AppError('INVALID_RESPONSE', '服务返回了无法识别的数据', requestId);
            }
            if (!result.ok) {
                throw new app_error_1.AppError(result.error?.code || 'INTERNAL_ERROR', result.error?.message || '服务暂时不可用，请稍后重试', result.requestId || requestId, result.error?.details || {});
            }
            if (result.data === undefined) {
                throw new app_error_1.AppError('INVALID_RESPONSE', '服务没有返回所需数据', result.requestId || requestId);
            }
            return result.data;
        }
        catch (error) {
            throw (0, app_error_1.toAppError)(error);
        }
    }
}
exports.CloudClient = CloudClient;
function createWxCloudClient() {
    return new CloudClient({
        callFunction: (options) => wx.cloud.callFunction(options),
    });
}
