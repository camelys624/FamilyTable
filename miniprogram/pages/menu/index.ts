import { MealType, Recipe } from '../../models/types'
import { menuModule, MenuDayView, MenuItemView } from '../../modules/menu/index'
import { recipeModule } from '../../modules/recipe/index'
import { getCurrentWeekKey, getWeekNumber } from '../../utils/date'
import { toAppError } from '../../utils/app-error'

interface MealView {
  key: MealType
  label: string
  hint: string
  items: MenuItemView[]
}

const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner']

Page({
  data: {
    days: [] as MenuDayView[],
    selectedIndex: 0,
    selectedDate: '',
    meals: [] as MealView[],
    recipes: [] as Recipe[],
    pickerVisible: false,
    pickerMeal: 'dinner' as MealType,
    pickerMealLabel: '晚餐',
    weekNumber: getWeekNumber(),
    weekStart: '',
    menuId: '',
    menuVersion: 0,
    repeatName: '',
    repeatCount: 0,
    loadError: '',
  },

  async onShow() {
    const todayIndex = (new Date().getDay() || 7) - 1
    const weekStart = getCurrentWeekKey()
    this.setData({ selectedIndex: todayIndex, weekStart, loadError: '' })
    await this.loadData(todayIndex)
  },

  async loadData(selectedIndex?: number) {
    const currentIndex = selectedIndex ?? this.data.selectedIndex
    const weekStart = this.data.weekStart || getCurrentWeekKey()
    try {
      const [menu, recipes] = await Promise.all([
        menuModule.getWeekMenu(weekStart),
        recipeModule.listRecipes(),
      ])
      const day = menu.days[currentIndex] || menu.days[0]
      if (!day) return
      const meals: MealView[] = [
        { key: 'breakfast', label: '早餐', hint: '轻一点，慢慢醒', items: day.breakfast },
        { key: 'lunch', label: '午餐', hint: '吃饱才有力气', items: day.lunch },
        { key: 'dinner', label: '晚餐', hint: '全家坐下来吃', items: day.dinner },
      ]
      const allItems = menu.days.flatMap((menuDay) => MEAL_TYPES.flatMap((mealType) => menuDay[mealType]))
      const recipeCounts = new Map<string, number>()
      allItems.forEach((item) => recipeCounts.set(item.recipeId, (recipeCounts.get(item.recipeId) || 0) + 1))
      const repeated = Array.from(recipeCounts.entries()).sort((left, right) => right[1] - left[1]).find((entry) => entry[1] > 1)
      const repeatedItem = repeated ? allItems.find((item) => item.recipeId === repeated[0]) : undefined
      this.setData({
        days: menu.days,
        selectedDate: day.dateLabel,
        meals,
        recipes,
        menuId: menu.id,
        menuVersion: menu.version,
        weekStart: menu.weekStart,
        repeatName: repeatedItem?.recipe.name || '',
        repeatCount: repeated?.[1] || 0,
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

  async selectDay(event: any) {
    const selectedIndex = Number(event.currentTarget.dataset.index)
    this.setData({ selectedIndex })
    await this.loadData(selectedIndex)
  },

  openPicker(event: any) {
    const meal = event.currentTarget.dataset.meal as MealType
    const mealView = this.data.meals.find((item) => item.key === meal)
    this.setData({
      pickerVisible: true,
      pickerMeal: meal,
      pickerMealLabel: mealView?.label || '菜单',
    })
  },

  closePicker() {
    this.setData({ pickerVisible: false })
  },

  async chooseRecipe(event: any) {
    const recipeId = event.currentTarget.dataset.id
    const selectedMeal = this.data.meals.find((item) => item.key === this.data.pickerMeal)
    if (selectedMeal?.items.some((item) => item.recipeId === recipeId)) {
      wx.showToast({ title: '这一餐已经有这道菜了', icon: 'none' })
      return
    }
    const day = this.data.days[this.data.selectedIndex]
    if (!day) return
    try {
      await menuModule.addRecipe({
        weekStart: this.data.weekStart || getCurrentWeekKey(),
        date: day.key,
        mealType: this.data.pickerMeal,
        recipeId,
        expectedVersion: this.data.menuVersion,
      })
      this.setData({ pickerVisible: false })
      await this.loadData()
      wx.showToast({ title: '已放上餐桌', icon: 'success' })
    } catch (error) {
      await this.loadData()
      wx.showToast({ title: error instanceof Error ? error.message : '添加菜单失败，请重试', icon: 'none' })
    }
  },

  removeRecipe(event: any) {
    const itemId = event.currentTarget.dataset.id
    const recipe = this.data.meals
      .flatMap((meal) => meal.items)
      .find((item) => item.id === itemId)?.recipe
    wx.showModal({
      title: `移除“${recipe?.name || '这道菜'}”？`,
      content: '只会从这一餐移除，菜谱仍会留在家庭菜谱簿里。',
      confirmText: '移除',
      success: async (result: any) => {
        if (!result.confirm) return
        try {
          await menuModule.removeRecipe({
            menuId: this.data.menuId,
            itemId,
            expectedVersion: this.data.menuVersion,
          })
          await this.loadData()
        } catch (error) {
          await this.loadData()
          wx.showToast({ title: error instanceof Error ? error.message : '移除菜单失败，请重试', icon: 'none' })
        }
      },
    })
  },
})
