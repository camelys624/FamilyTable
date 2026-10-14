"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalVoteAdapter = void 0;
const app_error_1 = require("../../utils/app-error");
class LocalVoteAdapter {
    async getCurrent() { return { poll: null, summary: { totalVotes: 0, candidates: [], currentMemberVoted: false }, currentVote: null, voters: [], canCreate: false }; }
    async createPoll() { throw new app_error_1.AppError('FEATURE_UNAVAILABLE', '家庭投票需要连接云端'); }
    async cast() { throw new app_error_1.AppError('FEATURE_UNAVAILABLE', '家庭投票需要连接云端'); }
    async close() { throw new app_error_1.AppError('FEATURE_UNAVAILABLE', '家庭投票需要连接云端'); }
}
exports.LocalVoteAdapter = LocalVoteAdapter;
