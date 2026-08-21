'use strict'

const SAFE_ERROR_CODES = new Set([
  'UNAUTHENTICATED',
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'DATABASE_NOT_INITIALIZED',
  'INTERNAL_ERROR',
])

function createRequestId(event) {
  const supplied = typeof event?.requestId === 'string' ? event.requestId.trim() : ''
  if (supplied) return supplied.slice(0, 64)
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
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
    logger.error('[auth]', { requestId, message: error instanceof Error ? error.message : String(error) })
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

function validationError(message, details = {}) {
  return Object.assign(new Error(message), { code: 'VALIDATION_ERROR', details })
}

function assertPayloadFields(payload, allowed) {
  const unknown = Object.keys(payload).filter((key) => !allowed.includes(key))
  if (unknown.length) throw validationError('请求包含不支持的字段', { fields: unknown })
}

function createAuthHandler(repository, logger = console) {
  return async function handleAuth(event = {}, identity = {}) {
    const requestId = createRequestId(event)
    try {
      if (!identity.openid) {
        throw Object.assign(new Error('微信身份已失效，请重新进入小程序'), { code: 'UNAUTHENTICATED' })
      }
      const payload = event.payload && typeof event.payload === 'object' ? event.payload : {}
      if (event.action === 'auth.login') {
        assertPayloadFields(payload, [])
        const data = await repository.login(identity.openid)
        return { ok: true, data, requestId }
      }
      if (event.action === 'auth.updateProfile') {
        if (!event.requestId || typeof event.requestId !== 'string' || event.requestId.trim().length < 8) {
          throw validationError('更新资料需要有效的 requestId', { field: 'requestId' })
        }
        assertPayloadFields(payload, ['displayName', 'avatarUrl'])
        const displayName = typeof payload.displayName === 'string' ? payload.displayName.trim() : ''
        if (!displayName || displayName.length > 40) {
          throw validationError('称呼需填写 1～40 个字', { field: 'displayName' })
        }
        const avatarUrl = payload.avatarUrl === undefined ? undefined : payload.avatarUrl
        if (avatarUrl !== undefined) {
          if (typeof avatarUrl !== 'string' || avatarUrl.length > 512) {
            throw validationError('头像地址格式不正确', { field: 'avatarUrl' })
          }
          if (avatarUrl && !/^(cloud:\/\/|https:\/\/)/.test(avatarUrl)) {
            throw validationError('头像地址格式不正确', { field: 'avatarUrl' })
          }
        }
        const data = await repository.updateProfile(identity.openid, { displayName, avatarUrl })
        return { ok: true, data, requestId }
      }
      throw validationError('不支持的认证动作', { action: event.action || '' })
    } catch (error) {
      return failure(error, requestId, logger)
    }
  }
}

module.exports = { createAuthHandler }
