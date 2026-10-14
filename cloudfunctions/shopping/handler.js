'use strict'

const { createHandler, codedError, text, week, version } = require('./common')
const categories = ['蔬菜鲜食', '肉禽水产', '粮油调味', '手动添加']
const mutation = (p) => ({ listId: text(p.listId, '清单', 100), weekStart: week(p.weekStart), expectedVersion: version(p.expectedVersion) })

function createShoppingHandler(repository, logger) {
  return createHandler(repository, {
    'shopping.get': { method: 'getList', fields: ['weekStart'], normalize: (p) => ({ weekStart: week(p.weekStart) }) },
    'shopping.generate': { method: 'generate', write: true, fields: ['weekStart', 'replaceExisting'], normalize(p) {
      if (p.replaceExisting !== undefined && typeof p.replaceExisting !== 'boolean') throw codedError('VALIDATION_ERROR', '请确认是否重新汇总')
      return { weekStart: week(p.weekStart), replaceExisting: p.replaceExisting === true }
    } },
    'shopping.addItem': { method: 'addItem', write: true, fields: ['listId', 'weekStart', 'name', 'category', 'expectedVersion'], normalize(p) {
      const category = p.category || '手动添加'
      if (!categories.includes(category)) throw codedError('VALIDATION_ERROR', '采购分组无效')
      return { ...mutation(p), name: text(p.name, '食材名称', 40), category }
    } },
    'shopping.checkItem': { method: 'checkItem', write: true, fields: ['listId', 'weekStart', 'itemId', 'checked', 'expectedVersion'], normalize(p) {
      if (typeof p.checked !== 'boolean') throw codedError('VALIDATION_ERROR', '购买状态无效')
      return { ...mutation(p), itemId: text(p.itemId, '食材', 100), checked: p.checked }
    } },
    'shopping.clearChecked': { method: 'clearChecked', write: true, fields: ['listId', 'weekStart', 'expectedVersion'], normalize: mutation },
  }, logger)
}

module.exports = { createShoppingHandler }
