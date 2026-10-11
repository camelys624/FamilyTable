import { Ingredient, MealType } from '../../models/types'
import { fridgeModule } from '../../modules/fridge/index'
import { CookInput, FridgeBatch } from '../../modules/fridge/interface'
import { menuModule } from '../../modules/menu/index'
import { toAppError } from '../../utils/app-error'
import { createRequestId } from '../../utils/request-id'

interface BatchChoice extends FridgeBatch {
  selected: boolean
  usedUp: boolean
}

interface IngredientChoice {
  name: string
  batches: BatchChoice[]
}

interface CookOptions {
  weekStart: string
  date: string
  mealType: MealType
  itemId: string
  menuId: string
}

interface CheckboxEvent {
  currentTarget: { dataset: { id?: unknown } }
  detail: { value?: unknown }
}

// Match the existing recipe backend's canonical ingredient names.
function normalizeName(name: string) {
  return name.trim().toLocaleLowerCase().replace(/\s+/g, '')
}

function parseOptions(raw: unknown): CookOptions | null {
  if (!raw || typeof raw !== 'object') return null
  const options = raw as Record<string, unknown>
  const { weekStart, date, mealType, itemId, menuId } = options
  if (typeof weekStart !== 'string' || !isDate(weekStart)
    || typeof date !== 'string' || !isDate(date)
    || (mealType !== 'breakfast' && mealType !== 'lunch' && mealType !== 'dinner')
    || typeof itemId !== 'string' || !itemId.trim()
    || typeof menuId !== 'string' || !menuId.trim()) return null
  return { weekStart, date, mealType, itemId, menuId }
}

function isDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function buildChoices(snapshot: Ingredient[], batches: FridgeBatch[], previous: IngredientChoice[]) {
  const seen = new Set<string>()
  return snapshot.filter((ingredient) => {
    const name = normalizeName(ingredient.name)
    if (!name || seen.has(name)) return false
    seen.add(name)
    return true
  }).map((ingredient): IngredientChoice => {
    const name = normalizeName(ingredient.name)
    const old = previous.find((row) => normalizeName(row.name) === name)
    const matching = batches
      .filter((batch) => batch.usable && batch.remaining && !batch.expired && normalizeName(batch.name) === name)
      .sort((left, right) => (left.expiresOn || '9999-12-31').localeCompare(right.expiresOn || '9999-12-31') || left.id.localeCompare(right.id))
    return {
      name: ingredient.name,
      batches: matching.map((batch, index) => {
        const oldBatch = old?.batches.find((choice) => choice.id === batch.id)
        return {
          ...batch,
          selected: old ? Boolean(oldBatch?.selected) : index === 0,
          usedUp: oldBatch?.usedUp ?? ingredient.usedUp,
        }
      }),
    }
  })
}

Page({
  data: {
    recipeName: '',
    ingredients: [] as IngredientChoice[],
    results: [] as FridgeBatch[],
    loading: false,
    loadError: '',
    submitting: false,
    submitted: false,
    submitError: '',
    canSubmit: false,
    outcomeUncertain: false,
    reconfirmRequired: false,
  },
  _options: null as CookOptions | null,
  _pendingInput: null as CookInput | null,
  _requestId: '',
  _intentKey: '',

  async onLoad(options: unknown) {
    this._options = parseOptions(options)
    await this.loadData()
  },

  async onShow() {
    if (!this.data.submitted && !this.data.submitting) await this.loadData()
  },

  // Intentionally takes no options: WXML supplies a tap event when retrying.
  async loadData() {
    if (this.data.loading || this.data.submitting || this.data.submitted) return
    const options: CookOptions | null = this._options
    if (!options) {
      this.setData({ loadError: '菜单链接不完整或无效，请返回菜单重新选择这道菜。', canSubmit: false })
      return
    }
    this.setData({ loading: true, loadError: '' })
    try {
      const [menu, batches] = await Promise.all([
        menuModule.getWeekMenu(options.weekStart),
        fridgeModule.listBatches(),
      ])
      // A transport error may have followed a committed write. Keep that exact
      // confirmation until its request receipt is recovered, even if stock changed.
      if (this.data.outcomeUncertain && this._pendingInput) return
      const day = menu.days.find((entry) => entry.key === options.date)
      const item = day?.[options.mealType].find((entry) => entry.id === options.itemId)
      if (menu.id !== options.menuId || menu.weekStart !== options.weekStart || !item) {
        this.setData({ ingredients: [], recipeName: '', canSubmit: false, loadError: '这道菜单菜品找不到了，请返回菜单重新选择。' })
        return
      }
      const ingredients = buildChoices(item.recipe.ingredients, batches, this.data.ingredients)
      this.setData({ recipeName: item.recipe.name, ingredients, canSubmit: ingredients.some((ingredient) => ingredient.batches.some((batch) => batch.selected)) })
    } catch (error) {
      this.setData({ loadError: toAppError(error).message, canSubmit: Boolean(this.data.outcomeUncertain && this._pendingInput) })
    } finally {
      this.setData({ loading: false })
    }
  },

  updateChoice(event: CheckboxEvent, field: 'selected' | 'usedUp', checkboxValue: string) {
    if (this.data.loading || this.data.loadError || this.data.submitting || this.data.submitted || this.data.outcomeUncertain) return
    const id = event.currentTarget.dataset.id
    const values = event.detail.value
    if (typeof id !== 'string' || !Array.isArray(values)) return
    const checked = values.includes(checkboxValue)
    let changed = false
    const ingredients: IngredientChoice[] = this.data.ingredients.map((ingredient: IngredientChoice) => ({
      ...ingredient,
      batches: ingredient.batches.map((batch) => {
        if (batch.id !== id || (field === 'usedUp' && !batch.selected) || batch[field] === checked) return batch
        changed = true
        return { ...batch, [field]: checked }
      }),
    }))
    if (!changed) return
    this._pendingInput = null
    this._requestId = ''
    this._intentKey = ''
    this.setData({ ingredients, canSubmit: ingredients.some((ingredient) => ingredient.batches.some((batch) => batch.selected)), submitError: '' })
  },

  selectBatch(event: CheckboxEvent) {
    this.updateChoice(event, 'selected', 'selected')
  },

  toggleUsedUp(event: CheckboxEvent) {
    this.updateChoice(event, 'usedUp', 'usedUp')
  },

  async submit() {
    if (this.data.loading || (this.data.loadError && !this.data.outcomeUncertain) || this.data.submitting || this.data.submitted || !this.data.canSubmit || !this._options) return
    const options: CookOptions = this._options
    const selected = (this.data.ingredients as IngredientChoice[])
      .flatMap((ingredient) => ingredient.batches)
      .filter((batch) => batch.selected && batch.usable && batch.remaining && !batch.expired)
      .map((batch) => ({ batchId: batch.id, expectedVersion: batch.version, usedUp: batch.usedUp }))
      .sort((left, right) => left.batchId.localeCompare(right.batchId))
    const input: CookInput = this.data.outcomeUncertain && this._pendingInput
      ? this._pendingInput
      : { menuId: options.menuId, itemId: options.itemId, date: options.date, mealType: options.mealType, batches: selected }
    if (!input.batches.length) return
    const intentKey = JSON.stringify(input)
    if (!this._requestId || this._intentKey !== intentKey) {
      this._requestId = createRequestId()
      this._intentKey = intentKey
    }
    this._pendingInput = input
    this.setData({ submitting: true, submitError: '' })
    let reloadForConflict = false
    try {
      const results = await fridgeModule.cook(input, this._requestId)
      this.setData({ submitted: true, results, canSubmit: false, outcomeUncertain: false, reconfirmRequired: false })
    } catch (error) {
      const failure = toAppError(error)
      if (failure.code === 'VERSION_CONFLICT') {
        this._pendingInput = null
        this._requestId = ''
        this._intentKey = ''
        reloadForConflict = true
        this.setData({ outcomeUncertain: false, reconfirmRequired: true, canSubmit: false, submitError: `${failure.message}。请核对更新后的实际批次，再重新确认。` })
      } else {
        const outcomeUncertain = ['NETWORK_ERROR', 'INVALID_RESPONSE', 'INTERNAL_ERROR', 'REQUEST_IN_PROGRESS'].includes(failure.code)
        this.setData({ outcomeUncertain, submitError: outcomeUncertain
          ? `${failure.message}。记录结果尚未确认，不代表未记录；请用原选择重试查询结果，不要另记一次。`
          : failure.message })
      }
    } finally {
      this.setData({ submitting: false })
    }
    if (reloadForConflict) await this.loadData()
  },

  cancel() {
    if (!this.data.submitting) wx.navigateBack()
  },

  openFridge() {
    if (!this.data.submitting) wx.navigateTo({ url: '/pages/fridge/index' })
  },
})
