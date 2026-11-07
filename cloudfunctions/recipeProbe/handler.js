'use strict'

const { codedError } = require('./common')
const { probeShare } = require('./probe')
const SAFE_CODES = new Set(['UNAUTHENTICATED', 'FAMILY_REQUIRED', 'NOT_FAMILY_MEMBER', 'FORBIDDEN', 'FEATURE_UNAVAILABLE', 'VALIDATION_ERROR', 'RATE_LIMITED'])

function createProbeHandler(repository, { env = process.env, probe = probeShare, clock = Date.now } = {}) {
  const windows = new Map()
  return async (event = {}, identity = {}) => {
    const requestId = typeof event?.requestId === 'string' && /^[\w-]{8,64}$/.test(event.requestId) ? event.requestId : ''
    try {
      if (env.RECIPE_PROBE_ENABLED !== 'true') throw codedError('FEATURE_UNAVAILABLE', '抓取诊断未启用')
      if (!identity.openid) throw codedError('UNAUTHENTICATED', '请从已登录的小程序开发者工具调用诊断')
      const context = await repository.context(identity.openid)
      if (context.member.role !== 'owner') throw codedError('FORBIDDEN', '仅家庭管理员可以执行抓取诊断')
      const payload = event?.payload
      if (!requestId || event?.action !== 'probe.fetch' || !payload || typeof payload !== 'object' || Array.isArray(payload)
        || Object.keys(payload).some((key) => !['shareText', 'sampleId'].includes(key))
        || typeof payload.shareText !== 'string' || !payload.shareText.trim() || payload.shareText.length > 4096
        || typeof payload.sampleId !== 'string' || !/^[\w-]{1,48}$/.test(payload.sampleId)) {
        throw codedError('VALIDATION_ERROR', '需提供 probe.fetch、有效 requestId、sampleId 和单条分享文字（不超过 4096 字）')
      }
      const now = clock()
      const recent = (windows.get(identity.openid) || []).filter((time) => now - time < 60000)
      if (recent.length >= 5) throw codedError('RATE_LIMITED', '单实例每位管理员每分钟最多诊断 5 次')
      if (windows.size >= 1000) windows.delete(windows.keys().next().value)
      windows.set(identity.openid, [...recent, now])
      const data = await probe(payload.shareText)
      return { ok: true, data: {
        ...data,
        sampleId: payload.sampleId,
        measuredAt: new Date(clock()).toISOString(),
        environment: identity.environment || '',
        invocationId: identity.invocationId || '',
      }, requestId }
    } catch (error) {
      const code = SAFE_CODES.has(error.code) ? error.code : 'INTERNAL_ERROR'
      // Never log event, URLs, page bodies, identities or upstream exception messages.
      return { ok: false, error: { code, message: code === 'INTERNAL_ERROR' ? '诊断暂时不可用，请检查云端配置' : error.message }, requestId }
    }
  }
}

module.exports = { createProbeHandler }
