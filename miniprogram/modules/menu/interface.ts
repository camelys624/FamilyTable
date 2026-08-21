import { MealType, Recipe } from '../../models/types'

export interface MenuItemView {
  id: string
  recipeId: string
  recipe: Recipe
  source: 'manual' | 'poll'
  addedAt?: string
}

export interface MenuDayView {
  key: string
  weekday: string
  dateLabel: string
  breakfast: MenuItemView[]
  lunch: MenuItemView[]
  dinner: MenuItemView[]
}

export interface WeekMenuView {
  id: string
  weekStart: string
  timezone: string
  version: number
  days: MenuDayView[]
}

export interface AddMenuItemInput {
  weekStart: string
  date: string
  mealType: MealType
  recipeId: string
  expectedVersion: number
}

export interface RemoveMenuItemInput {
  menuId: string
  itemId: string
  expectedVersion: number
}

export interface MenuModule {
  getWeekMenu(weekStart: string): Promise<WeekMenuView>
  addRecipe(input: AddMenuItemInput): Promise<WeekMenuView>
  removeRecipe(input: RemoveMenuItemInput): Promise<WeekMenuView>
}
