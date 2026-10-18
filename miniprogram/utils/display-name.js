"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasMeaningfulName = hasMeaningfulName;
exports.firstGlyph = firstGlyph;
exports.memberNameView = memberNameView;
// 成员昵称兜底：默认微信号、空昵称、纯 emoji 都不适合直接展示成「家人」。
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}]/gu;
const WECHAT_DEFAULT_RE = /^(微信用户|WeChat\s*User)\s*\d*$/i;
const SEPARATOR_RE = /[\s·・.。_\-—|/\\]+/g;
function hasMeaningfulName(name) {
    const raw = String(name || '').trim();
    if (!raw)
        return false;
    if (WECHAT_DEFAULT_RE.test(raw))
        return false;
    return raw.replace(EMOJI_RE, '').replace(SEPARATOR_RE, '').length > 0;
}
/** 取第一个有意义的字符作为头像文字，跳过 emoji 和分隔符。 */
function firstGlyph(name) {
    const chars = Array.from(String(name || ''));
    for (let index = 0; index < chars.length; index += 1) {
        const stripped = chars[index].replace(EMOJI_RE, '').replace(SEPARATOR_RE, '');
        if (stripped)
            return stripped[0].toUpperCase();
    }
    return '';
}
/**
 * 成员展示名：
 * - 有有效昵称 → 用昵称
 * - 否则本人显示「我」，其他人显示「家人 N」
 * - 兜底时 initial 为空字符串，由页面渲染统一默认头像
 */
function memberNameView(displayName, index, isMe) {
    const raw = String(displayName || '').trim();
    if (hasMeaningfulName(raw)) {
        return { name: raw, initial: firstGlyph(raw) || '家', isFallback: false };
    }
    return { name: isMe ? '我' : `家人 ${index + 1}`, initial: '', isFallback: true };
}
