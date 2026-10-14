'use strict'

const { BaseRepository, codedError, get, hash, dataOnly } = require('./common')
const listIdFor = (familyId, weekStart) => `shopping_${hash(`${familyId}:${weekStart}`).slice(0, 40)}`
const menuIdFor = (familyId, weekStart) => `menu_${hash(`${familyId}:${weekStart}`).slice(0, 40)}`
const normalizeName = (name) => name.trim().toLowerCase().replace(/\s+/g, '')
const categoryFor = (name) => /肉|排骨|鸡|鱼|虾|蟹/.test(name) ? '肉禽水产' : /米|面|糖|盐|油|酱|醋|料酒/.test(name) ? '粮油调味' : '蔬菜鲜食'
const view = (list, menuVersion = list.sourceMenuVersion) => ({ id: list._id, weekStart: list.weekStart, version: list.version, sourceMenuVersion: list.sourceMenuVersion, stale: list.sourceMenuVersion < 0 ? menuVersion > 0 : menuVersion !== list.sourceMenuVersion, items: list.items.map(({ id, name, category, source, checked }) => ({ id, name, category, source, checked })) })

function emptyList(context, weekStart, now = new Date()) {
  return { _id: listIdFor(context.familyId, weekStart), familyId: context.familyId, weekStart, sourceMenuId: menuIdFor(context.familyId, weekStart), sourceMenuVersion: -1, version: 0, status: 'active', items: [], createdAt: now, createdBy: context.user._id, updatedAt: now, updatedBy: context.user._id, schemaVersion: 1 }
}

function menuItems(menu, context, now) {
  const merged = new Map()
  for (const day of menu?.days || []) for (const meal of ['breakfast', 'lunch', 'dinner']) for (const dish of day[meal] || []) for (const ingredient of dish.recipeSnapshot?.ingredients || []) {
    if (ingredient.usedUp === false) continue
    const normalizedName = normalizeName(ingredient.name || '')
    if (!normalizedName) continue
    if (merged.has(normalizedName)) {
      const item = merged.get(normalizedName)
      if (!item.sourceRecipeIds.includes(dish.recipeId)) item.sourceRecipeIds.push(dish.recipeId)
    } else merged.set(normalizedName, { id: `item_${hash(`${context.familyId}:${normalizedName}`).slice(0, 32)}`, name: ingredient.name.trim(), normalizedName, category: categoryFor(ingredient.name), source: 'menu', sourceRecipeIds: [dish.recipeId], checked: false, checkedAt: null, checkedBy: null, createdAt: now, createdBy: context.user._id })
  }
  return [...merged.values()]
}

class CloudBaseShoppingRepository extends BaseRepository {
  async getList(openid, input) {
    const context = await this.context(openid)
    const list = await get(this.db, 'shopping_lists', listIdFor(context.familyId, input.weekStart))
    const menu = await get(this.db, 'menus', menuIdFor(context.familyId, input.weekStart))
    return { shoppingList: view(list || emptyList(context, input.weekStart), menu?.version || 0) }
  }

  async generate(openid, input, requestId) {
    const context = await this.context(openid)
    return this.write(context, 'shopping.generate', input, requestId, async (transaction, now, current) => {
      const id = listIdFor(current.familyId, input.weekStart)
      const existing = await get(transaction, 'shopping_lists', id)
      const menu = await get(transaction, 'menus', menuIdFor(current.familyId, input.weekStart))
      const menuVersion = menu?.version || 0
      if (existing && existing.sourceMenuVersion === menuVersion) return { shoppingList: view(existing) }
      if (existing && existing.sourceMenuVersion >= 0 && !input.replaceExisting) throw codedError('VERSION_CONFLICT', '周菜单有变化，请确认后重新汇总', { currentVersion: existing.version })
      const list = existing || emptyList(current, input.weekStart, now)
      const manual = list.items.filter((item) => item.source === 'manual')
      const manualNames = new Set(manual.map((item) => item.normalizedName))
      const items = [...menuItems(menu, current, now).filter((item) => !manualNames.has(item.normalizedName)), ...manual]
      if (items.length > 300) throw codedError('VALIDATION_ERROR', '采购单最多保留 300 项，请先清理已买食材')
      const next = { ...list, items, sourceMenuVersion: menuVersion, version: list.version + 1, updatedAt: now, updatedBy: current.user._id }
      await transaction.collection('shopping_lists').doc(id).set({ data: dataOnly(next) })
      return { shoppingList: view(next) }
    })
  }

  async mutate(openid, action, input, requestId, change) {
    const context = await this.context(openid)
    return this.write(context, action, input, requestId, async (transaction, now, current) => {
      if (input.listId !== listIdFor(current.familyId, input.weekStart)) throw codedError('NOT_FOUND', '采购单不存在或已不可访问')
      const stored = await get(transaction, 'shopping_lists', input.listId)
      const list = stored || emptyList(current, input.weekStart, now)
      if (list.familyId !== current.familyId || list.status !== 'active') throw codedError('NOT_FOUND', '采购单不存在或已不可访问')
      if (list.version !== input.expectedVersion) throw codedError('VERSION_CONFLICT', '采购单已被家人更新，请刷新后再操作', { currentVersion: list.version })
      const menu = await get(transaction, 'menus', menuIdFor(current.familyId, input.weekStart))
      const result = change(list, now, current) || {}
      if (list.items.length > 300) throw codedError('VALIDATION_ERROR', '采购单最多保留 300 项')
      list.version += 1
      list.updatedAt = now
      list.updatedBy = current.user._id
      await transaction.collection('shopping_lists').doc(list._id).set({ data: dataOnly(list) })
      return { shoppingList: view(list, menu?.version || 0), ...result }
    })
  }

  addItem(openid, input, requestId) {
    return this.mutate(openid, 'shopping.addItem', input, requestId, (list, now, context) => {
      const normalizedName = normalizeName(input.name)
      const existing = list.items.find((item) => item.normalizedName === normalizedName)
      if (existing) { existing.source = 'manual'; return }
      list.items.push({ id: `manual_${hash(`${context.user._id}:${requestId}`).slice(0, 32)}`, name: input.name, normalizedName, category: input.category, source: 'manual', sourceRecipeIds: [], checked: false, checkedAt: null, checkedBy: null, createdAt: now, createdBy: context.user._id })
    })
  }

  checkItem(openid, input, requestId) {
    return this.mutate(openid, 'shopping.checkItem', input, requestId, (list, now, context) => {
      const item = list.items.find((entry) => entry.id === input.itemId)
      if (!item) throw codedError('NOT_FOUND', '这项食材已经被清除，请刷新')
      item.checked = input.checked
      item.checkedAt = input.checked ? now : null
      item.checkedBy = input.checked ? context.user._id : null
    })
  }

  clearChecked(openid, input, requestId) {
    return this.mutate(openid, 'shopping.clearChecked', input, requestId, (list) => {
      const before = list.items.length
      list.items = list.items.filter((item) => !item.checked)
      return { removedCount: before - list.items.length }
    })
  }
}

module.exports = { CloudBaseShoppingRepository, listIdFor, menuItems, normalizeName }
