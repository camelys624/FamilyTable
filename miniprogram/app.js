"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const runtime_1 = require("./config/runtime");
const session_1 = require("./modules/session/index");
App({
    globalData: {
        startupError: '',
    },
    async onLaunch() {
        try {
            (0, runtime_1.initializeCloudRuntime)();
            await (0, session_1.ensureSession)();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : '应用初始化失败';
            this.globalData.startupError = message;
            console.error('[startup]', error);
        }
    },
});
