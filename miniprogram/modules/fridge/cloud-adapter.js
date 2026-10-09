"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CloudFridgeAdapter = void 0;
const runtime_1 = require("../../config/runtime");
const app_error_1 = require("../../utils/app-error");
const BATCH_STATUS_LABELS = {
    available: '有剩 · 可用', expired: '已过期 · 有剩', spoiled: '变质 · 不可用',
    usedUp: '已用完', discarded: '已丢弃',
};
const RECORD_FIELD_LABELS = { name: '名称', expiresOn: '保质期' };
const DISCARD_REASON_LABELS = { expired: '过期', spoiled: '变质', other: '其他原因' };
function invalidResponse() {
    throw new app_error_1.AppError('INVALID_RESPONSE', '冰箱服务返回的数据格式不正确，请刷新后重试');
}
function object(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return invalidResponse();
    return value;
}
function text(value) {
    return typeof value === 'string' ? value : invalidResponse();
}
function flag(value) {
    return typeof value === 'boolean' ? value : invalidResponse();
}
function list(value, parse) {
    return Array.isArray(value) ? value.map(parse) : invalidResponse();
}
function parseBatch(value) {
    const batch = object(value);
    const version = batch.version;
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
        return invalidResponse();
    const expiresOn = text(batch.expiresOn);
    const status = text(batch.status);
    return {
        id: text(batch.id), name: text(batch.name), version,
        expiresOn, remaining: flag(batch.remaining),
        usable: flag(batch.usable), expired: flag(batch.expired),
        statusLabel: BATCH_STATUS_LABELS[status] || '状态待核对', expiryLabel: expiresOn || '未填写',
    };
}
function parseRecord(value) {
    const record = object(value);
    const type = text(record.type);
    const timestamp = record.createdAt;
    const time = timestamp instanceof Date
        ? timestamp
        : typeof timestamp === 'string' ? new Date(timestamp) : invalidResponse();
    if (!Number.isFinite(time.getTime()))
        return invalidResponse();
    let typeLabel = '食材变动';
    let detail = '';
    if (type === 'added') {
        typeLabel = '入库';
        detail = '放进冰箱，记为有剩';
    }
    else if (type === 'edited') {
        typeLabel = '修改';
        detail = `调整：${list(record.changes, text).map((field) => RECORD_FIELD_LABELS[field] || field).join('、')}`;
    }
    else if (type === 'cooked') {
        typeLabel = '做菜消耗';
        detail = `${text(record.recipeName)} · ${flag(record.usedUp) ? '已用完' : '仍有剩'}`;
    }
    else if (type === 'discarded') {
        const reason = text(record.reason);
        typeLabel = reason === 'expired' ? '过期报损' : '报损';
        detail = `${DISCARD_REASON_LABELS[reason] || reason} · ${flag(record.usedUp) ? '全部丢弃' : '部分报损，仍有剩'}`;
    }
    return {
        id: text(record.id), name: text(record.name), typeLabel, detail,
        timeLabel: time.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }),
    };
}
function parseSuggestion(value) {
    const suggestion = object(value);
    return {
        name: text(suggestion.name), canCook: flag(suggestion.canCook), reason: text(suggestion.reason),
        availableLabel: list(suggestion.available, text).join('、'),
        missingLabel: list(suggestion.missing, text).join('、'),
        stepsLabel: list(suggestion.steps, text).join(' → '),
    };
}
class CloudFridgeAdapter {
    constructor(client) {
        this.client = client;
    }
    async call(action, payload = {}, requestId) {
        if (runtime_1.runtimeConfig.repositoryMode !== 'cloud') {
            throw new app_error_1.AppError('FEATURE_UNAVAILABLE', '冰箱需要云端家庭共享数据，本地演示模式不支持，请切换云端配置');
        }
        return object(await this.client.call('fridge', action, payload, requestId));
    }
    async listBatches() {
        const result = await this.call('fridge.listBatches');
        return list(result.batches, parseBatch);
    }
    async listRecords(cursor = '') {
        const result = await this.call('fridge.listRecords', { cursor, pageSize: 20 });
        return { records: list(result.records, parseRecord), nextCursor: text(result.nextCursor) };
    }
    async createBatch(input, requestId) {
        await this.call('fridge.createBatch', { ...input }, requestId);
    }
    async updateBatch(input, requestId) {
        await this.call('fridge.updateBatch', { ...input }, requestId);
    }
    async discardBatch(input, requestId) {
        await this.call('fridge.discardBatch', { ...input }, requestId);
    }
    async cook(input, requestId) {
        const result = await this.call('fridge.cook', { ...input }, requestId);
        return list(result.batches, parseBatch);
    }
    async suggest() {
        const result = await this.call('fridge.suggest');
        return list(result.suggestions, parseSuggestion);
    }
}
exports.CloudFridgeAdapter = CloudFridgeAdapter;
