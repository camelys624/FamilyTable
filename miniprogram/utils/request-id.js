"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRequestId = createRequestId;
let requestSequence = 0;
function createRequestId() {
    requestSequence = (requestSequence + 1) % 10000;
    const random = Math.random().toString(36).slice(2, 8);
    return `req_${Date.now().toString(36)}_${requestSequence.toString(36)}_${random}`;
}
