"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CloudPreferenceAdapter = void 0;
class CloudPreferenceAdapter {
    constructor(client) {
        this.client = client;
    }
    async getMine() { return (await this.client.call('preference', 'preference.getMine')).preference; }
    async updateMine(input, requestId) { return (await this.client.call('preference', 'preference.updateMine', { ...input }, requestId)).preference; }
}
exports.CloudPreferenceAdapter = CloudPreferenceAdapter;
