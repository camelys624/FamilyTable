import { CloudClient } from '../../repositories/cloud-client'
import { ShoppingList, ShoppingModule, ShoppingMutation } from './interface'
export class CloudShoppingAdapter implements ShoppingModule {
  constructor(private readonly client: CloudClient) {}
  private async call(action: string, input: Record<string, unknown>, requestId?: string) { return (await this.client.call<{ shoppingList: ShoppingList }>('shopping', action, input, requestId)).shoppingList }
  getList(weekStart: string) { return this.call('shopping.get', { weekStart }) }
  generate(weekStart: string, replaceExisting: boolean, requestId: string) { return this.call('shopping.generate', { weekStart, replaceExisting }, requestId) }
  addItem(input: ShoppingMutation & { name: string }, requestId: string) { return this.call('shopping.addItem', { ...input }, requestId) }
  checkItem(input: ShoppingMutation & { itemId: string; checked: boolean }, requestId: string) { return this.call('shopping.checkItem', { ...input }, requestId) }
  clearChecked(input: ShoppingMutation, requestId: string) { return this.call('shopping.clearChecked', { ...input }, requestId) }
}
