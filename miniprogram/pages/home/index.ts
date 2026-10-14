import { Recipe } from '../../models/types'
import { menuModule } from '../../modules/menu/index'
import { recipeModule } from '../../modules/recipe/index'
import { formatToday, getCurrentWeekKey, getFamilyToday } from '../../utils/date'
import { voteModule } from '../../modules/vote/index'
import { shoppingModule } from '../../modules/shopping/index'
import { familyModule } from '../../modules/family/index'
import { toRecipe } from '../../modules/recipe/cloud-adapter'
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
    voteError: '',
    shoppingError: '',
    loadError: '',
    loading: true,
  },
  async onShow() {
    await this.loadData()
  },

  async onPullDownRefresh() {
    await this.loadData()
    wx.stopPullDownRefresh()
  },

  async loadData() {
    this.setData({ loading: true })
    const session = await ensureSession().catch((error: unknown) => {
      const message = toAppError(error).message
      this.setData({ loadError: message })
      wx.showToast({ title: message, icon: 'none' })
      return null
    })
    if (!session) { this.setData({ loading: false }); return }
    if (!session.onboarded) {
      this.setData({ loading: false })
      wx.reLaunch({ url: '/pages/onboarding/index' })
      return
    }
    const userName = session.userName || '家人'
    try {
      const [menu, recipes, currentFamily] = await Promise.all([
        menuModule.getWeekMenu(getCurrentWeekKey()),
        recipeModule.listRecipes(),
        familyModule.getCurrentFamily(),
      ])
      const extras = await Promise.allSettled([voteModule.getCurrent(getFamilyToday(), 'dinner'), shoppingModule.getList(getCurrentWeekKey())])
      const poll = extras[0].status === 'fulfilled' ? extras[0].value : null
      const shopping = extras[1].status === 'fulfilled' ? extras[1].value : null
      const todayIndex = (new Date(`${getFamilyToday()}T12:00:00Z`).getUTCDay() || 7) - 1
      const day = menu.days[todayIndex] || menu.days[0]
      if (!day) { this.setData({ loading: false }); return }
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
        familyName: currentFamily.family.name,
        userName,
        todayText: formatToday(),
        todayDishes,
        pollCandidates: (poll?.poll?.candidates || []).map((entry) => toRecipe({ ...entry.recipeSnapshot, id: entry.recipeId, duration: 20 })),
        votedRecipeId: poll?.currentVote?.candidateRecipeId || '',
        remainingShopping: shopping?.items.filter((item) => !item.checked).length || 0,
        shoppingStale: shopping?.stale || false,
        voteError: extras[0].status === 'rejected' ? toAppError(extras[0].reason).message : '',
        shoppingError: extras[1].status === 'rejected' ? toAppError(extras[1].reason).message : '',
        loadError: '',
      })
    } catch (error) {
      const message = toAppError(error).message
      this.setData({ loadError: message })
      wx.showToast({ title: message, icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  async retryLoad() {
    await this.loadData()
  },

  openWeekMenu() {
    wx.switchTab({ url: '/pages/menu/index' })
  },

  openVote() {
    wx.navigateTo({ url: '/pages/vote/index' })
  },

  openShopping() {
    wx.navigateTo({ url: '/pages/shopping/index' })
  },
})
