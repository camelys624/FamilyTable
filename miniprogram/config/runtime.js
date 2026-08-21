"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runtimeConfig = void 0;
exports.initializeCloudRuntime = initializeCloudRuntime;
const environments_1 = require("./environments");
// 构建时由环境 profile 注入；当前默认保持本地演示模式。
exports.runtimeConfig = (0, environments_1.getEnvironmentProfile)(environments_1.activeStage);
function getMiniProgramAppId() {
    if (typeof wx.getAccountInfoSync !== 'function')
        return '';
    return wx.getAccountInfoSync()?.miniProgram?.appId || '';
}
function initializeCloudRuntime() {
    if (exports.runtimeConfig.stage === 'prod' && exports.runtimeConfig.repositoryMode !== 'cloud') {
        throw new Error('prod 环境禁止使用 local repository');
    }
    if (exports.runtimeConfig.repositoryMode !== 'cloud')
        return;
    if (!exports.runtimeConfig.cloudEnvId)
        throw new Error('cloud 模式缺少 cloudEnvId');
    if (exports.runtimeConfig.cloudEnvId.startsWith('__'))
        throw new Error('cloudEnvId 仍是占位符');
    const appId = getMiniProgramAppId();
    if (appId === 'touristappid')
        throw new Error('正式 CloudBase 模式不能使用 touristappid');
    if (!wx.cloud)
        throw new Error('当前微信基础库不支持 CloudBase');
    wx.cloud.init({ env: exports.runtimeConfig.cloudEnvId, traceUser: true });
}
