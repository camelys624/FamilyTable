"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CloudVoteAdapter = void 0;
class CloudVoteAdapter {
    constructor(client) {
        this.client = client;
    }
    getCurrent(targetDate, mealType) { return this.client.call('vote', 'vote.current', { targetDate, mealType }); }
    createPoll(input, requestId) { return this.client.call('vote', 'vote.createPoll', { ...input }, requestId); }
    cast(pollId, candidateRecipeId, requestId) { return this.client.call('vote', 'vote.cast', { pollId, candidateRecipeId }, requestId); }
    close(pollId, requestId) { return this.client.call('vote', 'vote.close', { pollId }, requestId); }
}
exports.CloudVoteAdapter = CloudVoteAdapter;
