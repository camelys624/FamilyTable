import { addShoppingItem, clearCheckedItems, generateShoppingList, getState, isShoppingListStale, toggleShoppingItem } from '../../services/store'
import { ShoppingList, ShoppingModule, ShoppingMutation } from './interface'
export class LocalShoppingAdapter implements ShoppingModule {
  private version = 0
  async getList(weekStart: string): Promise<ShoppingList> { return { id: 'local-shopping', weekStart, version: this.version, sourceMenuVersion: 0, stale: isShoppingListStale(), items: getState().shoppingItems } }
  async generate(weekStart: string) { generateShoppingList(); this.version++; return this.getList(weekStart) }
  async addItem(input: ShoppingMutation & { name: string }) { addShoppingItem(input.name); this.version++; return this.getList(input.weekStart) }
  async checkItem(input: ShoppingMutation & { itemId: string; checked: boolean }) { const item = getState().shoppingItems.find((entry) => entry.id === input.itemId); if (item && item.checked !== input.checked) toggleShoppingItem(input.itemId); this.version++; return this.getList(input.weekStart) }
  async clearChecked(input: ShoppingMutation) { clearCheckedItems(); this.version++; return this.getList(input.weekStart) }
}
