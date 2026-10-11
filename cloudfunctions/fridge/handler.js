'use strict'

const SAFE_ERROR_CODES = new Set([
  'UNAUTHENTICATED',
  'FAMILY_REQUIRED',
  'NOT_FAMILY_MEMBER',
  'FORBIDDEN',
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'VERSION_CONFLICT',
  'ALREADY_COOKED',
  'IDEMPOTENCY_CONFLICT',
  'REQUEST_IN_PROGRESS',
  'FEATURE_UNAVAILABLE',
  'DATABASE_NOT_INITIALIZED',
  'INTERNAL_ERROR',
])

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner']
const DISCARD_REASONS = ['expired', 'spoiled', 'other']

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
  if (normalized.length > max) throw validationError(`${field}长度不能超过 ${max} 个字`, { field })
  return normalized
}

function dateValue(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw validationError(`${field}必须是 YYYY-MM-DD`, { field })
  }
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw validationError(`${field}不是有效日期`, { field })
  }
  return value
}

// 保质期选填：空字符串表示未填写，不能理解为一定安全。
function expiresOnValue(value) {
  if (value === '') return ''
  return dateValue(value, '保质期')
}

function expectedVersion(value, field = 'expectedVersion') {
  if (!Number.isInteger(value) || value < 1) {
    throw validationError('expectedVersion 必须是正整数', { field })
  }
  return value
}

function booleanValue(value, field, message) {
  if (typeof value !== 'boolean') throw validationError(message, { field })
  return value
}

function normalizeCreatePayload(payload) {
  assertPayloadFields(payload, ['name', 'expiresOn'])
  return {
    name: text(payload.name, '食材名称', 50),
    expiresOn: expiresOnValue(payload.expiresOn),
  }
}

function normalizeUpdatePayload(payload) {
  assertPayloadFields(payload, ['batchId', 'expectedVersion', 'name', 'expiresOn'])
  return {
    batchId: text(payload.batchId, 'batchId', 80),
    expectedVersion: expectedVersion(payload.expectedVersion),
    name: text(payload.name, '食材名称', 50),
    expiresOn: expiresOnValue(payload.expiresOn),
  }
}

function normalizeDiscardPayload(payload) {
  assertPayloadFields(payload, ['batchId', 'expectedVersion', 'reason', 'usedUp'])
  if (!DISCARD_REASONS.includes(payload.reason)) {
    throw validationError('报损原因无效', { field: 'reason' })
  }
  return {
    batchId: text(payload.batchId, 'batchId', 80),
    expectedVersion: expectedVersion(payload.expectedVersion),
    reason: payload.reason,
    usedUp: booleanValue(payload.usedUp, 'usedUp', '请标记这一批是否已全部丢弃'),
  }
}

function normalizeCookPayload(payload) {
  assertPayloadFields(payload, ['menuId', 'itemId', 'date', 'mealType', 'batches'])
  if (!MEAL_TYPES.includes(payload.mealType)) throw validationError('餐次参数无效', { field: 'mealType' })
  if (!Array.isArray(payload.batches) || payload.batches.length < 1 || payload.batches.length > 50) {
    throw validationError('请选择 1～50 批要消耗的食材', { field: 'batches' })
  }
  const seen = new Set()
  const batches = payload.batches.map((batch, index) => {
    const field = `batches[${index}]`
    if (!batch || typeof batch !== 'object' || Array.isArray(batch)) throw validationError('食材批次格式无效', { field })
    assertPayloadFields(batch, ['batchId', 'expectedVersion', 'usedUp'])
    const batchId = text(batch.batchId, `${field}.batchId`, 80)
    if (seen.has(batchId)) throw validationError('同一批食材不能重复选择', { field: `${field}.batchId` })
    seen.add(batchId)
    return {
      batchId,
      expectedVersion: expectedVersion(batch.expectedVersion, `${field}.expectedVersion`),
      usedUp: booleanValue(batch.usedUp, `${field}.usedUp`, '请标记这批食材是否用完'),
    }
  })
  return {
    menuId: text(payload.menuId, 'menuId', 100),
    itemId: text(payload.itemId, 'itemId', 100),
    date: dateValue(payload.date, 'date'),
    mealType: payload.mealType,
    batches,
  }
}

function normalizeRecordsPayload(payload) {
  assertPayloadFields(payload, ['pageSize', 'cursor'])
  const pageSize = payload.pageSize === undefined ? 20 : payload.pageSize
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
    throw validationError('pageSize 需为 1～50 的整数', { field: 'pageSize' })
  }
  let cursor = ''
  if (payload.cursor !== undefined && payload.cursor !== '') {
    if (typeof payload.cursor !== 'string' || payload.cursor.length > 200) {
      throw validationError('cursor 无效', { field: 'cursor' })
    }
    cursor = payload.cursor
  }
  return { pageSize, cursor }
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
    logger.error('[fridge]', { requestId, message: error instanceof Error ? error.message : String(error) })
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

function createFridgeHandler(repository, logger = console) {
  return async function handleFridge(event = {}, identity = {}) {
    const requestId = createRequestId(event)
    try {
      if (!identity.openid) {
        throw Object.assign(new Error('微信身份已失效，请重新进入小程序'), { code: 'UNAUTHENTICATED' })
      }
      const payload = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) ? event.payload : {}
      if (event.action === 'fridge.listBatches') {
        assertPayloadFields(payload, [])
        const batches = await repository.listBatches(identity.openid)
        return { ok: true, data: { batches }, requestId }
      }
      if (event.action === 'fridge.listRecords') {
        const data = await repository.listRecords(identity.openid, normalizeRecordsPayload(payload))
        return { ok: true, data, requestId }
      }
      if (event.action === 'fridge.createBatch') {
        requireRequestId(event, '录入食材需要有效的 requestId')
        const data = await repository.createBatch(identity.openid, normalizeCreatePayload(payload), requestId)
        return { ok: true, data, requestId }
      }
      if (event.action === 'fridge.updateBatch') {
        requireRequestId(event, '修改食材需要有效的 requestId')
        const data = await repository.updateBatch(identity.openid, normalizeUpdatePayload(payload), requestId)
        return { ok: true, data, requestId }
      }
      if (event.action === 'fridge.discardBatch') {
        requireRequestId(event, '记录报损需要有效的 requestId')
        const data = await repository.discardBatch(identity.openid, normalizeDiscardPayload(payload), requestId)
        return { ok: true, data, requestId }
      }
      if (event.action === 'fridge.cook') {
        requireRequestId(event, '记录做菜消耗需要有效的 requestId')
        const data = await repository.cook(identity.openid, normalizeCookPayload(payload), requestId)
        return { ok: true, data, requestId }
      }
      if (event.action === 'fridge.suggest') {
        assertPayloadFields(payload, [])
        const data = await repository.suggest(identity.openid, requestId)
        return { ok: true, data, requestId }
      }
      throw validationError('不支持的冰箱动作', { action: event.action || '' })
    } catch (error) {
      return failure(error, requestId, logger)
    }
  }
}

module.exports = {
  createFridgeHandler,
  normalizeCreatePayload,
  normalizeUpdatePayload,
  normalizeDiscardPayload,
  normalizeCookPayload,
  normalizeRecordsPayload,
}
