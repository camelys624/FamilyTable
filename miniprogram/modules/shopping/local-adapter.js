"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalShoppingAdapter = void 0;
const store_1 = require("../../services/store");
class LocalShoppingAdapter {
    constructor() {
        this.version = 0;
    }
    async getList(weekStart) { return { id: 'local-shopping', weekStart, version: this.version, sourceMenuVersion: 0, stale: (0, store_1.isShoppingListStale)(), items: (0, store_1.getState)().shoppingItems }; }
    async generate(weekStart) { (0, store_1.generateShoppingList)(); this.version++; return this.getList(weekStart); }
    async addItem(input) { (0, store_1.addShoppingItem)(input.name); this.version++; return this.getList(input.weekStart); }
    async checkItem(input) { const item = (0, store_1.getState)().shoppingItems.find((entry) => entry.id === input.itemId); if (item && item.checked !== input.checked)
        (0, store_1.toggleShoppingItem)(input.itemId); this.version++; return this.getList(input.weekStart); }
    async clearChecked(input) { (0, store_1.clearCheckedItems)(); this.version++; return this.getList(input.weekStart); }
}
exports.LocalShoppingAdapter = LocalShoppingAdapter;
