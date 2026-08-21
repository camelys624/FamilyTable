export type MealType = 'breakfast' | 'lunch' | 'dinner'

export interface Ingredient {
  name: string
  amount: number
  unit: string
}

export interface Recipe {
  id: string
  name: string
  initial: string
  imagePath?: string
  category: string
  duration: number
  difficulty: string
  tone: string
  note: string
  ingredients: Ingredient[]
  steps: string[]
}

export interface MenuDay {
  key: string
  weekday: string
  dateLabel: string
  breakfast: string[]
  lunch: string[]
  dinner: string[]
}

export interface ShoppingItem extends Ingredient {
  id: string
  checked: boolean
  category: string
}

export interface AppState {
  onboarded: boolean
  userName: string
  familyName: string
  members: string[]
  recipes: Recipe[]
  weekKey: string
  weekMenu: MenuDay[]
  shoppingItems: ShoppingItem[]
  shoppingMenuSignature: string
  votedRecipeId: string
  spicyLevel: number
  avoidFood: string
}
