'use strict'

const {
  normalizeModelOutput,
  reconcileIngredients,
  validateExtractionInput,
} = require('./ingredient-assistant')

const SAFE_ERROR_CODES = new Set([
  'UNAUTHENTICATED',
  'FAMILY_REQUIRED',
  'NOT_FAMILY_MEMBER',
  'FORBIDDEN',
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'IDEMPOTENCY_CONFLICT',
  'REQUEST_IN_PROGRESS',
  'DATABASE_NOT_INITIALIZED',
  'FEATURE_UNAVAILABLE',
  'RATE_LIMITED',
  'INVALID_RESPONSE',
  'INTERNAL_ERROR',
])
const assistantRateWindows = new Map()

function requireAssistantRateLimit(openid) {
  const now = Date.now()
  const windowMs = 60 * 1000
  const limit = 5
  const recent = (assistantRateWindows.get(openid) || []).filter((timestamp) => now - timestamp < windowMs)
  if (recent.length >= limit) {
    throw Object.assign(new Error('AI 请求次数较多，请稍后再试'), { code: 'RATE_LIMITED' })
  }
  recent.push(now)
  if (assistantRateWindows.size > 1000) assistantRateWindows.delete(assistantRateWindows.keys().next().value)
  assistantRateWindows.set(openid, recent)
}

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

function text(value, field, max, required = true) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (required && !normalized) throw validationError(`${field}不能为空`, { field })
  if (normalized.length > max) throw validationError(`${field}长度不能超过 ${max} 个字`, { field })
  return normalized
}

function normalizeDifficulty(value) {
  if (!['easy', 'medium', 'hard'].includes(value)) {
    throw validationError('难度参数无效', { field: 'difficulty' })
  }
  return value
}

function normalizeIngredients(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw validationError('食材需填写 1～100 项', { field: 'ingredients' })
  }
  return value.map((ingredient, index) => {
    if (!ingredient || typeof ingredient !== 'object') {
      throw validationError('食材格式无效', { field: `ingredients[${index}]` })
    }
    assertPayloadFields(ingredient, ['name', 'usedUp'])
    if (typeof ingredient.usedUp !== 'boolean') {
      throw validationError('请标记食材是否用完', { field: `ingredients[${index}].usedUp` })
    }
    return {
      name: text(ingredient.name, '食材名称', 50),
      usedUp: ingredient.usedUp,
    }
  })
}

function normalizeSteps(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw validationError('操作步骤需填写 1～100 步', { field: 'steps' })
  }
  return value.map((step, index) => text(step, `steps[${index}]`, 200))
}

function normalizeCreatePayload(payload) {
  assertPayloadFields(payload, ['name', 'category', 'durationMinutes', 'difficulty', 'note', 'ingredients', 'steps'])
  const durationMinutes = Number(payload.durationMinutes)
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) {
    throw validationError('用时请填写 1～1440 分钟', { field: 'durationMinutes' })
  }
  return {
    name: text(payload.name, '菜名', 80),
    category: text(payload.category, '分类', 30),
    durationMinutes,
    difficulty: normalizeDifficulty(payload.difficulty),
    note: text(payload.note, '诀窍', 1000, false),
    ingredients: normalizeIngredients(payload.ingredients),
    steps: normalizeSteps(payload.steps),
  }
}

function normalizePatch(payload) {
  assertPayloadFields(payload, ['recipeId', 'patch'])
  const recipeId = text(payload.recipeId, 'recipeId', 80)
  if (!payload.patch || typeof payload.patch !== 'object' || Array.isArray(payload.patch)) {
    throw validationError('更新内容格式无效', { field: 'patch' })
  }
  const patch = payload.patch
  assertPayloadFields(patch, ['name', 'category', 'durationMinutes', 'difficulty', 'note', 'ingredients', 'steps'])
  const normalized = {}
  if (Object.prototype.hasOwnProperty.call(patch, 'name')) normalized.name = text(patch.name, '菜名', 80)
  if (Object.prototype.hasOwnProperty.call(patch, 'category')) normalized.category = text(patch.category, '分类', 30)
  if (Object.prototype.hasOwnProperty.call(patch, 'durationMinutes')) {
    const durationMinutes = Number(patch.durationMinutes)
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) {
      throw validationError('用时请填写 1～1440 分钟', { field: 'durationMinutes' })
    }
    normalized.durationMinutes = durationMinutes
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'difficulty')) normalized.difficulty = normalizeDifficulty(patch.difficulty)
  if (Object.prototype.hasOwnProperty.call(patch, 'note')) normalized.note = text(patch.note, '诀窍', 1000, false)
  if (Object.prototype.hasOwnProperty.call(patch, 'ingredients')) normalized.ingredients = normalizeIngredients(patch.ingredients)
  if (Object.prototype.hasOwnProperty.call(patch, 'steps')) normalized.steps = normalizeSteps(patch.steps)
  if (!Object.keys(normalized).length) throw validationError('至少需要更新一个菜谱字段', { field: 'patch' })
  return { recipeId, patch: normalized }
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
    logger.error('[recipe]', { requestId, message: error instanceof Error ? error.message : String(error) })
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

function createRecipeHandler(repository, logger = console, ingredientAssistant = null) {
  return async function handleRecipe(event = {}, identity = {}) {
    const requestId = createRequestId(event)
    try {
      if (!identity.openid) {
        throw Object.assign(new Error('微信身份已失效，请重新进入小程序'), { code: 'UNAUTHENTICATED' })
      }
      const payload = event.payload && typeof event.payload === 'object' ? event.payload : {}
      if (event.action === 'recipe.extractIngredients') {
        const input = validateExtractionInput(payload)
        if (typeof repository.getContext !== 'function') {
          throw Object.assign(new Error('AI 整理暂时不可用，请稍后重试'), { code: 'FEATURE_UNAVAILABLE' })
        }
        await repository.getContext(identity.openid)
        requireAssistantRateLimit(identity.openid)
        if (!ingredientAssistant || typeof ingredientAssistant.extract !== 'function') {
          throw Object.assign(new Error('AI 整理暂未配置，请继续手动填写'), { code: 'FEATURE_UNAVAILABLE' })
        }
        const modelOutput = await ingredientAssistant.extract(input.steps, requestId)
        const normalized = normalizeModelOutput(modelOutput, input.steps)
        const { warnings: reconciliationWarnings, ...diff } = reconcileIngredients(normalized.ingredients, input.existingIngredients)
        return {
          ok: true,
          data: {
            detected: normalized.ingredients,
            diff,
            warnings: [...normalized.warnings, ...reconciliationWarnings],
          },
          requestId,
        }
      }
      if (event.action === 'recipe.list') {
        assertPayloadFields(payload, ['keyword', 'category', 'pageSize', 'cursor'])
        const pageSize = payload.pageSize === undefined ? 100 : Number(payload.pageSize)
        if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
          throw validationError('pageSize 需为 1～100 的整数', { field: 'pageSize' })
        }
        const keyword = payload.keyword === undefined ? '' : text(payload.keyword, 'keyword', 40, false)
        const category = payload.category === undefined ? '' : text(payload.category, 'category', 30, false)
        const cursor = payload.cursor === undefined ? '' : text(payload.cursor, 'cursor', 500, false)
        const data = await repository.list(identity.openid, { keyword, category, pageSize, cursor })
        return { ok: true, data, requestId }
      }
      if (event.action === 'recipe.detail') {
        assertPayloadFields(payload, ['recipeId'])
        const recipeId = text(payload.recipeId, 'recipeId', 80)
        const recipe = await repository.detail(identity.openid, recipeId)
        return { ok: true, data: { recipe }, requestId }
      }
      if (event.action === 'recipe.create') {
        requireRequestId(event, '新增菜谱需要有效的 requestId')
        const input = normalizeCreatePayload(payload)
        const recipe = await repository.create(identity.openid, input, requestId)
        return { ok: true, data: { recipe }, requestId }
      }
      if (event.action === 'recipe.update') {
        requireRequestId(event, '修改菜谱需要有效的 requestId')
        const input = normalizePatch(payload)
        const recipe = await repository.update(identity.openid, input.recipeId, input.patch, requestId)
        return { ok: true, data: { recipe }, requestId }
      }
      if (event.action === 'recipe.delete') {
        requireRequestId(event, '删除菜谱需要有效的 requestId')
        assertPayloadFields(payload, ['recipeId'])
        const recipeId = text(payload.recipeId, 'recipeId', 80)
        const data = await repository.delete(identity.openid, recipeId, requestId)
        return { ok: true, data, requestId }
      }
      throw validationError('不支持的菜谱动作', { action: event.action || '' })
    } catch (error) {
      return failure(error, requestId, logger)
    }
  }
}

module.exports = { createRecipeHandler, normalizeCreatePayload, normalizePatch }
