import { AppState, Recipe } from '../../models/types'
import { menuModule } from '../../modules/menu/index'
import { recipeModule } from '../../modules/recipe/index'
import { formatToday, getCurrentWeekKey } from '../../utils/date'
import { getState, generateShoppingList, isShoppingListStale } from '../../services/store'
import { ensureSession } from '../../modules/session/index'
import { toAppError } from '../../utils/app-error'

interface DishView extends Recipe {
  mealLabel: string
  foodEmoji: string
}

Page({
  data: {
    familyName: '',
    userName: '',
    todayText: '',
    todayDishes: [] as DishView[],
    pollCandidates: [] as Recipe[],
    votedRecipeId: '',
    remainingShopping: 0,
    shoppingStale: false,
    loadError: '',
  },
  async onShow() {
    await this.loadData()
  },

  async onPullDownRefresh() {
    await this.loadData()
    wx.stopPullDownRefresh()
  },

  async loadData() {
    const session = await ensureSession().catch((error: unknown) => {
      const message = toAppError(error).message
      this.setData({ loadError: message })
      wx.showToast({ title: message, icon: 'none' })
      return null
    })
    if (!session) return
    if (!session.onboarded) {
      wx.reLaunch({ url: '/pages/onboarding/index' })
      return
    }
    const state: AppState = getState()
    const userName = session.userName || state.userName
    try {
      const [menu, recipes] = await Promise.all([
        menuModule.getWeekMenu(getCurrentWeekKey()),
        recipeModule.listRecipes(),
      ])
      const todayIndex = (new Date().getDay() || 7) - 1
      const day = menu.days[todayIndex] || menu.days[0]
      if (!day) return
      const emojiByTone: Record<string, string> = {
        tomato: '🍅',
        berry: '🍖',
        green: '🥬',
        grain: '🥣',
        ocean: '🐟',
      }
      const makeDishes = (items: typeof day.breakfast, mealLabel: string) => items.map((item) => ({
        ...item.recipe,
        mealLabel,
        foodEmoji: emojiByTone[item.recipe.tone] || '🍲',
      }))

      const breakfast = makeDishes(day.breakfast, '早')[0] || null
      const lunch = makeDishes(day.lunch, '午')
      const dinner = makeDishes(day.dinner, '晚')
      const plannedDishes = [
        breakfast,
        lunch[0],
        dinner[0],
        lunch[1] || dinner[1],
      ].filter(Boolean) as DishView[]
      const todayDishes = plannedDishes.slice(0, 4)
      if (todayDishes.length < 4) {
        const plannedIds = new Set(todayDishes.map((dish) => dish.id))
        recipes.forEach((recipe) => {
          if (todayDishes.length < 4 && !plannedIds.has(recipe.id)) {
            todayDishes.push({
              ...recipe,
              mealLabel: '荐',
              foodEmoji: emojiByTone[recipe.tone] || '🍲',
            })
            plannedIds.add(recipe.id)
          }
        })
      }
      this.setData({
        familyName: session.familyName || state.familyName,
        userName,
        todayText: formatToday(),
        todayDishes,
        pollCandidates: recipes.slice(0, 3),
        votedRecipeId: state.votedRecipeId,
        remainingShopping: state.shoppingItems.filter((item) => !item.checked).length,
        shoppingStale: isShoppingListStale(),
        loadError: '',
      })
    } catch (error) {
      const message = toAppError(error).message
      this.setData({ loadError: message })
      wx.showToast({ title: message, icon: 'none' })
    }
  },

  async retryLoad() {
    await this.loadData()
  },

  openWeekMenu() {
    wx.switchTab({ url: '/pages/menu/index' })
  },

  openFridge() {
    wx.navigateTo({ url: '/pages/fridge/index' })
  },

  openVote() {
    wx.navigateTo({ url: '/pages/vote/index' })
  },

  openShopping() {
    const state = getState()
    if (!state.shoppingItems.length) generateShoppingList()
    wx.switchTab({ url: '/pages/shopping/index' })
  },
})
