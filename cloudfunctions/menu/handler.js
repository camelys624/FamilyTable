'use strict'

const SAFE_ERROR_CODES = new Set([
  'UNAUTHENTICATED',
  'FAMILY_REQUIRED',
  'NOT_FAMILY_MEMBER',
  'FORBIDDEN',
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'VERSION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'REQUEST_IN_PROGRESS',
  'DATABASE_NOT_INITIALIZED',
  'INTERNAL_ERROR',
])

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner']

function createRequestId(event) {
  const supplied = typeof event?.requestId === 'string' ? event.requestId.trim() : ''
  if (supplied) return supplied.slice(0, 64)
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function validationError(message, details = {}) {
  return Object.assign(new Error(message), { code: 'VALIDATION_ERROR', details })
}

function assertPayloadFields(payload, allowed) {
  const unknown = Object.keys(payload).filter((key) => !allowed.includes(key))
  if (unknown.length) throw validationError('请求包含不支持的字段', { fields: unknown })
}

function requireRequestId(event, message) {
  if (!event.requestId || typeof event.requestId !== 'string' || event.requestId.trim().length < 8) {
    throw validationError(message, { field: 'requestId' })
  }
}

function text(value, field, max) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) throw validationError(`${field}不能为空`, { field })
  if (normalized.length > max) throw validationError(`${field}长度不能超过 ${max} 个字符`, { field })
  return normalized
}

function dateValue(value, field) {
  const date = text(value, field, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw validationError(`${field}必须是 YYYY-MM-DD`, { field })
  const parsed = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw validationError(`${field}不是有效日期`, { field })
  }
  return date
}

function assertWeekStart(value) {
  const weekStart = dateValue(value, 'weekStart')
  const day = new Date(`${weekStart}T00:00:00Z`).getUTCDay()
  if (day !== 1) throw validationError('weekStart 必须是周一', { field: 'weekStart' })
  return weekStart
}

function assertMenuDate(weekStart, value) {
  const date = dateValue(value, 'date')
  const start = new Date(`${weekStart}T00:00:00Z`)
  const target = new Date(`${date}T00:00:00Z`)
  const offset = Math.round((target.getTime() - start.getTime()) / 86400000)
  if (offset < 0 || offset > 6) throw validationError('菜单日期必须属于请求周', { field: 'date' })
  return date
}

function expectedVersion(value) {
  const version = Number(value)
  if (!Number.isInteger(version) || version < 0) {
    throw validationError('expectedVersion 必须是非负整数', { field: 'expectedVersion' })
  }
  return version
}

function normalizeAddPayload(payload) {
  assertPayloadFields(payload, ['weekStart', 'date', 'mealType', 'recipeId', 'expectedVersion'])
  const weekStart = assertWeekStart(payload.weekStart)
  const date = assertMenuDate(weekStart, payload.date)
  const mealType = text(payload.mealType, 'mealType', 20)
  if (!MEAL_TYPES.includes(mealType)) throw validationError('餐次参数无效', { field: 'mealType' })
  return {
    weekStart,
    date,
    mealType,
    recipeId: text(payload.recipeId, 'recipeId', 80),
    expectedVersion: expectedVersion(payload.expectedVersion),
  }
}

function normalizeRemovePayload(payload) {
  assertPayloadFields(payload, ['menuId', 'itemId', 'expectedVersion'])
  return {
    menuId: text(payload.menuId, 'menuId', 100),
    itemId: text(payload.itemId, 'itemId', 100),
    expectedVersion: expectedVersion(payload.expectedVersion),
  }
}

function getFailureCode(error) {
  if (SAFE_ERROR_CODES.has(error?.code)) return error.code
  const message = String(error?.message || error || '')
  if (/(collection|database|table|namespace)/i.test(message) && /(not found|not exist|does not exist|不存在|未找到|未创建)/i.test(message)) {
    return 'DATABASE_NOT_INITIALIZED'
  }
  return 'INTERNAL_ERROR'
}

function failure(error, requestId, logger) {
  const code = getFailureCode(error)
  if (code === 'INTERNAL_ERROR') {
    logger.error('[menu]', { requestId, message: error instanceof Error ? error.message : String(error) })
  }
  return {
    ok: false,
    error: {
      code,
      message: code === 'INTERNAL_ERROR'
        ? '服务暂时不可用，请稍后重试'
        : code === 'DATABASE_NOT_INITIALIZED'
          ? '数据库尚未初始化，请联系管理员'
          : error.message,
      details: error?.details || {},
    },
    requestId,
  }
}

function createMenuHandler(repository, logger = console) {
  return async function handleMenu(event = {}, identity = {}) {
    const requestId = createRequestId(event)
    try {
      if (!identity.openid) {
        throw Object.assign(new Error('微信身份已失效，请重新进入小程序'), { code: 'UNAUTHENTICATED' })
      }
      const payload = event.payload && typeof event.payload === 'object' ? event.payload : {}
      if (event.action === 'menu.week') {
        assertPayloadFields(payload, ['weekStart'])
        const menu = await repository.week(identity.openid, assertWeekStart(payload.weekStart))
        return { ok: true, data: { menu }, requestId }
      }
      if (event.action === 'menu.addRecipe') {
        requireRequestId(event, '添加菜单需要有效的 requestId')
        const input = normalizeAddPayload(payload)
        const menu = await repository.addRecipe(identity.openid, input, requestId)
        return { ok: true, data: { menu }, requestId }
      }
      if (event.action === 'menu.removeRecipe') {
        requireRequestId(event, '移除菜单需要有效的 requestId')
        const input = normalizeRemovePayload(payload)
        const menu = await repository.removeRecipe(identity.openid, input, requestId)
        return { ok: true, data: { menu }, requestId }
      }
      throw validationError('不支持的菜单动作', { action: event.action || '' })
    } catch (error) {
      return failure(error, requestId, logger)
    }
  }
}

module.exports = { createMenuHandler, normalizeAddPayload, normalizeRemovePayload, assertWeekStart, assertMenuDate }
