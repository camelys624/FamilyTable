import { MealType, Recipe } from '../../models/types'
import { AppError } from '../../utils/app-error'
import { addRecipeToMenu, getState, removeRecipeFromMenu } from '../../services/store'
import { AddMenuItemInput, MenuDayView, MenuItemView, MenuModule, RemoveMenuItemInput, WeekMenuView } from './interface'

const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner']

function dayMeta(weekStart: string, index: number) {
  const date = new Date(`${weekStart}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + index)
  return {
    key: date.toISOString().slice(0, 10),
    weekday: ['日', '一', '二', '三', '四', '五', '六'][date.getUTCDay()],
    dateLabel: `${date.getUTCMonth() + 1}/${date.getUTCDate()}`,
  }
}

function localItemId(date: string, mealType: MealType, index: number) {
  return `local|${date}|${mealType}|${index}`
}

function itemView(recipe: Recipe, date: string, mealType: MealType, index: number): MenuItemView {
  return {
    id: localItemId(date, mealType, index),
    recipeId: recipe.id,
    recipe,
    source: 'manual',
  }
}

export class LocalMenuAdapter implements MenuModule {
  async getWeekMenu(weekStart: string) {
    const state = getState()
    const storedDays = new Map(state.weekMenu.map((day) => [day.key, day]))
    const days: MenuDayView[] = Array.from({ length: 7 }, (_, index) => {
      const meta = dayMeta(weekStart, index)
      const stored = storedDays.get(meta.key)
      const day = stored || { key: meta.key, breakfast: [], lunch: [], dinner: [] }
      return {
        ...meta,
        breakfast: this.mapItems(state.recipes, day.key, 'breakfast', day.breakfast),
        lunch: this.mapItems(state.recipes, day.key, 'lunch', day.lunch),
        dinner: this.mapItems(state.recipes, day.key, 'dinner', day.dinner),
      }
    })
    return {
      id: `local|${weekStart}`,
      weekStart,
      timezone: 'Asia/Shanghai',
      version: 0,
      days,
    }
  }

  async addRecipe(input: AddMenuItemInput) {
    const state = getState()
    const dayIndex = state.weekMenu.findIndex((day) => day.key === input.date)
    if (dayIndex < 0) throw new AppError('NOT_FOUND', '菜单日期不存在')
    if (!state.recipes.some((recipe) => recipe.id === input.recipeId)) {
      throw new AppError('NOT_FOUND', '这道菜已经不在菜谱簿里了')
    }
    addRecipeToMenu(dayIndex, input.mealType, input.recipeId)
    return this.getWeekMenu(input.weekStart)
  }

  async removeRecipe(input: RemoveMenuItemInput) {
    const state = getState()
    for (let dayIndex = 0; dayIndex < state.weekMenu.length; dayIndex += 1) {
      const day = state.weekMenu[dayIndex]
      for (const mealType of MEAL_TYPES) {
        const recipeIndex = day[mealType].findIndex((recipeId, index) => localItemId(day.key, mealType, index) === input.itemId)
        if (recipeIndex >= 0) {
          removeRecipeFromMenu(dayIndex, mealType, day[mealType][recipeIndex])
          return this.getWeekMenu(input.menuId.split('|')[1] || day.key)
        }
      }
    }
    throw new AppError('NOT_FOUND', '这道菜已经从菜单移除了')
  }

  private mapItems(recipes: Recipe[], date: string, mealType: MealType, recipeIds: string[]) {
    return recipeIds
      .map((recipeId, index) => {
        const recipe = recipes.find((item) => item.id === recipeId)
        return recipe ? itemView(recipe, date, mealType, index) : null
      })
      .filter(Boolean) as MenuItemView[]
  }
}

