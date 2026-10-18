"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_PREFERENCE_ITEMS = exports.SPICY_OPTIONS = exports.ALLERGEN_OPTIONS = exports.DISLIKE_OPTIONS = void 0;
exports.DISLIKE_OPTIONS = [
    '香菜', '葱', '姜', '蒜', '花生', '海鲜',
    '内脏', '羊肉', '香菇', '芹菜', '胡萝卜', '苦瓜',
];
exports.ALLERGEN_OPTIONS = [
    '花生', '坚果', '海鲜', '虾蟹', '牛奶', '鸡蛋',
    '大豆', '麸质', '芒果', '芝麻', '酒精',
];
exports.SPICY_OPTIONS = [
    { level: 0, label: '不辣', heat: 0 },
    { level: 1, label: '微辣', heat: 1 },
    { level: 2, label: '中辣', heat: 2 },
    { level: 3, label: '很辣', heat: 3 },
];
/** 单项列表（忌口 / 过敏原）最多保留的条数，与服务端 50 项上限留足余量。 */
exports.MAX_PREFERENCE_ITEMS = 12;
