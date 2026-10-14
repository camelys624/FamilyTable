"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CloudShoppingAdapter = void 0;
class CloudShoppingAdapter {
    constructor(client) {
        this.client = client;
    }
    async call(action, input, requestId) { return (await this.client.call('shopping', action, input, requestId)).shoppingList; }
    getList(weekStart) { return this.call('shopping.get', { weekStart }); }
    generate(weekStart, replaceExisting, requestId) { return this.call('shopping.generate', { weekStart, replaceExisting }, requestId); }
    addItem(input, requestId) { return this.call('shopping.addItem', { ...input }, requestId); }
    checkItem(input, requestId) { return this.call('shopping.checkItem', { ...input }, requestId); }
    clearChecked(input, requestId) { return this.call('shopping.clearChecked', { ...input }, requestId); }
}
exports.CloudShoppingAdapter = CloudShoppingAdapter;
