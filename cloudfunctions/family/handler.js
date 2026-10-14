'use strict'

const SAFE_ERROR_CODES = new Set([
  'CONTENT_REJECTED',
  'FEATURE_UNAVAILABLE',
  'UNAUTHENTICATED',
  'FAMILY_REQUIRED',
  'NOT_FAMILY_MEMBER',
  'FORBIDDEN',
  'VALIDATION_ERROR',
  'VERSION_CONFLICT',
  'INVITE_INVALID',
  'INVITE_EXPIRED',
  'FAMILY_FULL',
  'IDEMPOTENCY_CONFLICT',
  'REQUEST_IN_PROGRESS',
  'DATABASE_NOT_INITIALIZED',
  'INTERNAL_ERROR',
])

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
    logger.error('[family]', { requestId, message: error instanceof Error ? error.message : String(error) })
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

function createFamilyHandler(repository, logger = console) {
  return async function handleFamily(event = {}, identity = {}) {
    const requestId = createRequestId(event)
    try {
      if (!identity.openid) {
        throw Object.assign(new Error('微信身份已失效，请重新进入小程序'), { code: 'UNAUTHENTICATED' })
      }
      const payload = event.payload && typeof event.payload === 'object' ? event.payload : {}
      if (event.action === 'family.current') {
        assertPayloadFields(payload, [])
        const data = await repository.current(identity.openid)
        return { ok: true, data, requestId }
      }
      if (['family.create', 'family.invite', 'family.join', 'family.update'].includes(event.action)) {
        if (typeof event.requestId !== 'string' || event.requestId.trim().length < 8 || event.requestId.trim().length > 64) {
          throw validationError('家庭操作需要 8～64 位 requestId', { field: 'requestId' })
        }
      }
      if (event.action === 'family.update') {
        assertPayloadFields(payload, ['name', 'expectedVersion'])
        const name = typeof payload.name === 'string' ? payload.name.trim() : ''
        if (!name || name.length > 40) throw validationError('饭桌名称需填写 1～40 个字', { field: 'name' })
        if (!Number.isInteger(payload.expectedVersion) || payload.expectedVersion < 0) throw validationError('饭桌信息版本无效，请重新加载', { field: 'expectedVersion' })
        const data = await repository.update(identity.openid, { name, expectedVersion: payload.expectedVersion }, requestId)
        return { ok: true, data, requestId }
      }
      if (event.action === 'family.invite') {
        assertPayloadFields(payload, ['expiresInHours'])
        const expiresInHours = payload.expiresInHours === undefined ? 72 : payload.expiresInHours
        if (!Number.isInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > 168) {
          throw validationError('邀请码有效期需为 1～168 小时', { field: 'expiresInHours' })
        }
        const data = await repository.invite(identity.openid, { expiresInHours }, requestId)
        return { ok: true, data, requestId }
      }
      if (event.action === 'family.join') {
        assertPayloadFields(payload, ['inviteCode', 'displayName'])
        const inviteCode = typeof payload.inviteCode === 'string' ? payload.inviteCode.trim().toUpperCase() : ''
        const displayName = typeof payload.displayName === 'string' ? payload.displayName.trim() : ''
        if (!/^[A-HJ-NP-Z2-9]{8}$/.test(inviteCode)) throw validationError('请填写 8 位家庭邀请码', { field: 'inviteCode' })
        if (!displayName || displayName.length > 12) throw validationError('称呼需填写 1～12 个字', { field: 'displayName' })
        const data = await repository.join(identity.openid, { inviteCode, displayName }, requestId)
        return { ok: true, data, requestId }
      }
      if (event.action === 'family.create') {
        if (!event.requestId || typeof event.requestId !== 'string' || event.requestId.trim().length < 8) {
          throw validationError('创建家庭需要有效的 requestId', { field: 'requestId' })
        }
        assertPayloadFields(payload, ['name', 'displayName', 'timezone'])
        const name = typeof payload.name === 'string' ? payload.name.trim() : ''
        const displayName = typeof payload.displayName === 'string' ? payload.displayName.trim() : ''
        const timezone = typeof payload.timezone === 'string' && payload.timezone ? payload.timezone : 'Asia/Shanghai'
        if (!name || name.length > 40) throw validationError('家庭名称需填写 1～40 个字', { field: 'name' })
        if (!displayName || displayName.length > 40) throw validationError('称呼需填写 1～40 个字', { field: 'displayName' })
        if (timezone !== 'Asia/Shanghai') throw validationError('暂不支持该家庭时区', { field: 'timezone' })
        const data = await repository.create(identity.openid, { name, displayName, timezone }, requestId)
        return { ok: true, data, requestId }
      }
      throw validationError('不支持的家庭动作', { action: event.action || '' })
    } catch (error) {
      return failure(error, requestId, logger)
    }
  }
}

module.exports = { createFamilyHandler }
