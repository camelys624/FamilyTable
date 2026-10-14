"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WriteIntent = void 0;
const app_error_1 = require("./app-error");
const request_id_1 = require("./request-id");
class WriteIntent {
    constructor() {
        this.pending = null;
    }
    async run(action, input, write) {
        const key = JSON.stringify({ action, input });
        if (this.pending && JSON.stringify({ action: this.pending.action, input: this.pending.input }) !== key) {
            throw new app_error_1.AppError('REQUEST_IN_PROGRESS', '上次操作结果还未确认，请先重试上次操作');
        }
        this.pending = this.pending || { action, input: JSON.parse(JSON.stringify(input)), requestId: (0, request_id_1.createRequestId)() };
        try {
            const result = await write(this.pending.requestId);
            this.pending = null;
            return result;
        }
        catch (error) {
            const failure = (0, app_error_1.toAppError)(error);
            if (!['NETWORK_ERROR', 'REQUEST_IN_PROGRESS'].includes(failure.code))
                this.pending = null;
            throw failure;
        }
    }
}
exports.WriteIntent = WriteIntent;
