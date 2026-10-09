export type MealType = 'breakfast' | 'lunch' | 'dinner'

/** 家常做法不记用量：只记这道菜做完后这样食材会不会用完，用完的下次做要再买。 */
export interface Ingredient {
  name: string
  usedUp: boolean
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

export interface ShoppingItem {
  id: string
  name: string
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
