import { Ingredient, MealType, Recipe } from '../../models/types'
import { CloudClient } from '../../repositories/cloud-client'
import { AddMenuItemInput, MenuDayView, MenuModule, RemoveMenuItemInput, WeekMenuView } from './interface'

interface RemoteRecipeSnapshot {
  recipeId: string
  name: string
  category: string
  durationMinutes?: number
  difficulty?: string
  note?: string
  ingredients: Ingredient[]
  steps?: string[]
}

interface RemoteMenuItem {
  id: string
  recipeId: string
  recipeSnapshot: RemoteRecipeSnapshot
  source: 'manual' | 'poll'
  addedAt?: string
}

interface RemoteMenuDay {
  date: string
  breakfast: RemoteMenuItem[]
  lunch: RemoteMenuItem[]
  dinner: RemoteMenuItem[]
}

interface RemoteMenu {
  id: string
  weekStart: string
  timezone: string
  version: number
  days: RemoteMenuDay[]
}

interface MenuResult {
  menu: RemoteMenu
}

function toneForRecipe(id: string) {
  const tones = ['green', 'tomato', 'ocean', 'grain', 'berry']
  let value = 0
  for (const character of id) value = (value * 31 + character.charCodeAt(0)) >>> 0
  return tones[value % tones.length]
}

function toRecipe(snapshot: RemoteRecipeSnapshot): Recipe {
  return {
    id: snapshot.recipeId,
    name: snapshot.name,
    initial: snapshot.name.slice(0, 1),
    category: snapshot.category,
    duration: snapshot.durationMinutes || 20,
    difficulty: snapshot.difficulty === 'medium' ? '适中' : snapshot.difficulty === 'hard' ? '困难' : '简单',
    tone: toneForRecipe(snapshot.recipeId),
    note: snapshot.note || '',
    ingredients: (snapshot.ingredients || []).map((ingredient) => ({
      name: ingredient.name,
      usedUp: ingredient.usedUp,
    })),
    steps: snapshot.steps || [],
  }
}

function dayView(day: RemoteMenuDay): MenuDayView {
  const date = new Date(`${day.date}T12:00:00`)
  const meta = {
    key: day.date,
    weekday: ['日', '一', '二', '三', '四', '五', '六'][date.getDay()],
    dateLabel: `${date.getMonth() + 1}/${date.getDate()}`,
  }
  const mapItems = (items: RemoteMenuItem[]) => items.map((item) => ({
    id: item.id,
    recipeId: item.recipeId,
    recipe: toRecipe(item.recipeSnapshot),
    source: item.source,
    addedAt: item.addedAt,
  }))
  return {
    ...meta,
    breakfast: mapItems(day.breakfast || []),
    lunch: mapItems(day.lunch || []),
    dinner: mapItems(day.dinner || []),
  }
}

export class CloudMenuAdapter implements MenuModule {
  constructor(private readonly client: CloudClient) {}

  async getWeekMenu(weekStart: string) {
    const result = await this.client.call<MenuResult>('menu', 'menu.week', { weekStart })
    return this.mapMenu(result.menu)
  }

  async addRecipe(input: AddMenuItemInput) {
    const result = await this.client.call<MenuResult>('menu', 'menu.addRecipe', { ...input })
    return this.mapMenu(result.menu)
  }

  async removeRecipe(input: RemoveMenuItemInput) {
    const result = await this.client.call<MenuResult>('menu', 'menu.removeRecipe', { ...input })
    return this.mapMenu(result.menu)
  }

  private mapMenu(menu: RemoteMenu): WeekMenuView {
    return {
      id: menu.id,
      weekStart: menu.weekStart,
      timezone: menu.timezone,
      version: menu.version,
      days: menu.days.map(dayView),
    }
  }
}

export { dayView, toRecipe, toneForRecipe }
