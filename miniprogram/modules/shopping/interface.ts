import { ShoppingItem } from '../../models/types'
export interface ShoppingList { id: string; weekStart: string; version: number; sourceMenuVersion: number; stale: boolean; items: ShoppingItem[] }
export interface ShoppingMutation { listId: string; weekStart: string; expectedVersion: number }
export interface ShoppingModule {
  getList(weekStart: string): Promise<ShoppingList>
  generate(weekStart: string, replaceExisting: boolean, requestId: string): Promise<ShoppingList>
  addItem(input: ShoppingMutation & { name: string }, requestId: string): Promise<ShoppingList>
  checkItem(input: ShoppingMutation & { itemId: string; checked: boolean }, requestId: string): Promise<ShoppingList>
  clearChecked(input: ShoppingMutation, requestId: string): Promise<ShoppingList>
}
