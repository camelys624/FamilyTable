"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionModule = void 0;
exports.getSession = getSession;
exports.ensureSession = ensureSession;
exports.completeOnboarding = completeOnboarding;
exports.clearSession = clearSession;
const runtime_1 = require("../../config/runtime");
const cloud_client_1 = require("../../repositories/cloud-client");
const cloud_session_adapter_1 = require("./cloud-session-adapter");
const local_session_adapter_1 = require("./local-session-adapter");
function createSessionModule() {
    if (runtime_1.runtimeConfig.repositoryMode === 'cloud') {
        return new cloud_session_adapter_1.CloudSessionAdapter((0, cloud_client_1.createWxCloudClient)());
    }
    return new local_session_adapter_1.LocalSessionAdapter();
}
exports.sessionModule = createSessionModule();
// 会话是页面守卫的唯一真相源。云端模式下本地缓存不再代表登录状态，
// 页面若各自判断是否已加入家庭，就会出现互相跳转的死循环。
let snapshot = null;
let pending = null;
function getSession() {
    return snapshot;
}
function ensureSession() {
    if (snapshot)
        return Promise.resolve(snapshot);
    if (!pending) {
        pending = exports.sessionModule
            .bootstrap()
            .then((result) => {
            snapshot = result;
            return result;
        })
            .finally(() => {
            pending = null;
        });
    }
    return pending;
}
async function completeOnboarding(input) {
    snapshot = await exports.sessionModule.completeOnboarding(input);
    return snapshot;
}
function clearSession() {
    snapshot = null;
    pending = null;
}
__exportStar(require("./interface"), exports);
