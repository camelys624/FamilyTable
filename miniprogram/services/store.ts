import { AppState, MealType, Recipe, ShoppingItem } from '../models/types'
import { getCurrentWeekKey, getWeekDates } from '../utils/date'

const STORAGE_KEY = 'family-menu-state-v1'
export const DEMO_INVITE_CODE = 'JCFAN725'

const seedRecipes: Recipe[] = [
  {
    id: 'recipe-tomato-egg',
    name: '番茄炒蛋',
    initial: '番',
    category: '快手菜',
    duration: 15,
    difficulty: '简单',
    tone: 'tomato',
    note: '鸡蛋嫩一点，汤汁留着拌饭。',
    ingredients: [
      { name: '番茄', amount: 2, unit: '个' },
      { name: '鸡蛋', amount: 3, unit: '个' },
      { name: '小葱', amount: 1, unit: '把' },
    ],
    steps: [
      '番茄切块，鸡蛋打散备用。',
      '热锅倒油，把鸡蛋炒至刚凝固后盛出。',
      '番茄炒出汤汁，倒回鸡蛋翻匀调味。',
    ],
  },
  {
    id: 'recipe-ribs',
    name: '山楂小排',
    initial: '排',
    category: '拿手菜',
    duration: 45,
    difficulty: '适中',
    tone: 'berry',
    note: '酸甜收汁，孩子也能吃。',
    ingredients: [
      { name: '猪肋排', amount: 600, unit: '克' },
      { name: '山楂', amount: 8, unit: '颗' },
      { name: '冰糖', amount: 30, unit: '克' },
    ],
    steps: [
      '小排焯水洗净，山楂去核。',
      '小排煎至表面微黄，加入冰糖和山楂翻炒。',
      '加水焖煮至软烂，开盖收浓汤汁。',
    ],
  },
  {
    id: 'recipe-greens',
    name: '蒜蓉菜心',
    initial: '菜',
    category: '素菜',
    duration: 10,
    difficulty: '简单',
    tone: 'green',
    note: '大火快炒，菜梗先下锅。',
    ingredients: [
      { name: '菜心', amount: 400, unit: '克' },
      { name: '大蒜', amount: 4, unit: '瓣' },
    ],
    steps: [
      '菜心洗净，菜梗和菜叶分开。',
      '热油爆香蒜末，先下菜梗再下菜叶。',
      '大火快速翻炒，调味后立即出锅。',
    ],
  },
  {
    id: 'recipe-congee',
    name: '香菇鸡丝粥',
    initial: '粥',
    category: '早餐',
    duration: 35,
    difficulty: '简单',
    tone: 'grain',
    note: '前一晚预约煮粥，早上拌入鸡丝。',
    ingredients: [
      { name: '大米', amount: 150, unit: '克' },
      { name: '鸡胸肉', amount: 180, unit: '克' },
      { name: '香菇', amount: 4, unit: '朵' },
    ],
    steps: [
      '大米洗净后煮成稠粥。',
      '鸡胸肉煮熟撕丝，香菇切片。',
      '把鸡丝和香菇加入粥中煮熟，最后调味。',
    ],
  },
  {
    id: 'recipe-fish',
    name: '清蒸鲈鱼',
    initial: '鱼',
    category: '家常菜',
    duration: 25,
    difficulty: '适中',
    tone: 'ocean',
    note: '水开后上锅，关火再焖两分钟。',
    ingredients: [
      { name: '鲈鱼', amount: 1, unit: '条' },
      { name: '生姜', amount: 1, unit: '块' },
      { name: '小葱', amount: 1, unit: '把' },
    ],
    steps: [
      '鲈鱼处理干净，在鱼身两侧划刀。',
      '铺上姜片，水开后上锅蒸熟。',
      '倒掉盘中汤汁，放葱丝并淋上热油。',
    ],
  },
]

function createInitialState(): AppState {
  const days = getWeekDates().map((day, index) => ({
    ...day,
    breakfast: index === 0 ? ['recipe-congee'] : [],
    lunch: index === 0 ? ['recipe-tomato-egg', 'recipe-greens'] : [],
    dinner: index === 0 ? ['recipe-ribs', 'recipe-greens'] : [],
  }))

  return {
    onboarded: false,
    userName: '小满',
    familyName: '林家小饭桌',
    members: ['小满', '阿哲', '团团'],
    recipes: seedRecipes,
    weekKey: getCurrentWeekKey(),
    weekMenu: days,
    shoppingItems: [],
    shoppingMenuSignature: '',
    votedRecipeId: '',
    spicyLevel: 1,
    avoidFood: '香菜',
  }
}

export function ensureState(): AppState {
  const state = wx.getStorageSync(STORAGE_KEY) as AppState | undefined
  if (state && Array.isArray(state.recipes) && Array.isArray(state.weekMenu)) {
    let changed = false
    const currentWeekKey = getCurrentWeekKey()
    const storedMenuWeekKey = (state.weekMenu[0]?.key || '')
      .split('-')
      .map((part) => part.padStart(2, '0'))
      .join('-')
    const storedWeekKey = state.weekKey || storedMenuWeekKey
    if (storedWeekKey !== currentWeekKey) {
      state.weekKey = currentWeekKey
      state.weekMenu = getWeekDates().map((day) => ({ ...day, breakfast: [], lunch: [], dinner: [] }))
      state.votedRecipeId = ''
      state.shoppingMenuSignature = ''
      changed = true
    } else if (state.weekKey !== currentWeekKey) {
      state.weekKey = currentWeekKey
      changed = true
    }
    state.recipes.forEach((recipe) => {
      if (!Array.isArray(recipe.steps)) {
        recipe.steps = []
        changed = true
      }
    })
    if (typeof state.shoppingMenuSignature !== 'string') {
      state.shoppingMenuSignature = ''
      changed = true
    }
    if (changed) saveState(state)
    return state
  }
  const initial = createInitialState()
  wx.setStorageSync(STORAGE_KEY, initial)
  return initial
}

export function getState(): AppState {
  return ensureState()
}

export function saveState(state: AppState) {
  wx.setStorageSync(STORAGE_KEY, state)
}

export function finishOnboarding(familyName: string, userName: string) {
  const state = getState()
  state.onboarded = true
  state.familyName = familyName.trim() || state.familyName
  state.userName = userName.trim() || state.userName
  state.members[0] = state.userName
  saveState(state)
}

export function findRecipe(recipeId: string): Recipe | undefined {
  return getState().recipes.find((recipe) => recipe.id === recipeId)
}

export function addRecipe(recipe: Recipe) {
  const state = getState()
  state.recipes.unshift(recipe)
  saveState(state)
}

export function updateRecipe(recipe: Recipe) {
  const state = getState()
  const index = state.recipes.findIndex((item) => item.id === recipe.id)
  if (index < 0) return false
  state.recipes[index] = recipe
  state.shoppingMenuSignature = ''
  saveState(state)
  return true
}

export function deleteRecipe(recipeId: string) {
  const state = getState()
  const before = state.recipes.length
  state.recipes = state.recipes.filter((recipe) => recipe.id !== recipeId)
  state.weekMenu.forEach((day) => {
    ;(['breakfast', 'lunch', 'dinner'] as MealType[]).forEach((mealType) => {
      day[mealType] = day[mealType].filter((id) => id !== recipeId)
    })
  })
  if (state.votedRecipeId === recipeId) state.votedRecipeId = ''
  state.shoppingMenuSignature = ''
  saveState(state)
  return state.recipes.length < before
}

export function getRecipeUsageCount(recipeId: string) {
  const state = getState()
  return state.weekMenu.reduce((total, day) => {
    return total + (['breakfast', 'lunch', 'dinner'] as MealType[]).reduce((dayTotal, mealType) => {
      return dayTotal + day[mealType].filter((id) => id === recipeId).length
    }, 0)
  }, 0)
}

export function addRecipeToMenu(dayIndex: number, mealType: MealType, recipeId: string) {
  const state = getState()
  const recipes = state.weekMenu[dayIndex][mealType]
  if (!recipes.includes(recipeId)) recipes.push(recipeId)
  state.shoppingMenuSignature = ''
  saveState(state)
}

export function removeRecipeFromMenu(dayIndex: number, mealType: MealType, recipeId: string) {
  const state = getState()
  state.weekMenu[dayIndex][mealType] = state.weekMenu[dayIndex][mealType].filter((id) => id !== recipeId)
  state.shoppingMenuSignature = ''
  saveState(state)
}

export function castVote(recipeId: string) {
  const state = getState()
  state.votedRecipeId = recipeId
  saveState(state)
}

export function generateShoppingList(): ShoppingItem[] {
  const state = getState()
  const merged = new Map<string, ShoppingItem>()
  const manualItems = state.shoppingItems.filter((item) => item.category === '手动添加')
  state.weekMenu.forEach((day) => {
    ;(['breakfast', 'lunch', 'dinner'] as MealType[]).forEach((mealType) => {
      day[mealType].forEach((recipeId) => {
        const recipe = state.recipes.find((item) => item.id === recipeId)
        recipe?.ingredients.forEach((ingredient) => {
          const key = `${ingredient.name}-${ingredient.unit}`
          const current = merged.get(key)
          if (current) current.amount += ingredient.amount
          else {
            merged.set(key, {
              ...ingredient,
              id: `item-${Date.now()}-${merged.size}`,
              checked: false,
              category: getIngredientCategory(ingredient.name),
            })
          }
        })
      })
    })
  })
  state.shoppingItems = [...Array.from(merged.values()), ...manualItems]
  state.shoppingMenuSignature = getMenuSignature(state)
  saveState(state)
  return state.shoppingItems
}

function getMenuSignature(state: AppState) {
  return state.weekMenu
    .map((day) => `${day.key}:${day.breakfast.join(',')}|${day.lunch.join(',')}|${day.dinner.join(',')}`)
    .join(';')
}

export function isShoppingListStale() {
  const state = getState()
  return Boolean(state.shoppingItems.length && state.shoppingMenuSignature !== getMenuSignature(state))
}

function getIngredientCategory(name: string) {
  if (/肉|排|鸡|鱼/.test(name)) return '肉禽水产'
  if (/米|糖/.test(name)) return '粮油调味'
  return '蔬菜鲜食'
}

export function toggleShoppingItem(itemId: string) {
  const state = getState()
  const item = state.shoppingItems.find((entry) => entry.id === itemId)
  if (item) item.checked = !item.checked
  saveState(state)
}

export function addShoppingItem(name: string) {
  const state = getState()
  state.shoppingItems.push({
    id: `manual-${Date.now()}`,
    name,
    amount: 1,
    unit: '份',
    checked: false,
    category: '手动添加',
  })
  saveState(state)
}

export function clearCheckedItems() {
  const state = getState()
  state.shoppingItems = state.shoppingItems.filter((item) => !item.checked)
  saveState(state)
}

export function updatePreferences(spicyLevel: number, avoidFood: string) {
  const state = getState()
  state.spicyLevel = spicyLevel
  state.avoidFood = avoidFood
  saveState(state)
}

export function resetDemo() {
  wx.removeStorageSync(STORAGE_KEY)
  return ensureState()
}
