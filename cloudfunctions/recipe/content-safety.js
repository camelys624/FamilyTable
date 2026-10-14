'use strict'
const fail = (code, message, details = {}) => Object.assign(new Error(message), { code, details })
function diagnostic(value, reason) {
  const candidates = [value?.errCode, value?.code, value?.errMsg?.match(/(?:errCode|error code)\s*:\s*(-?\d+)/i)?.[1]]
  const raw = candidates.find((entry) => entry !== undefined && entry !== null && /^-?\d+$/.test(String(entry)))
  return { check: 'text', reason, ...(raw !== undefined ? { upstreamCode: Number(raw) } : {}) }
}
function valuesAt(value, path) {
  if (Array.isArray(value)) return value.flatMap((entry) => valuesAt(entry, path))
  if (!path.length) return typeof value === 'string' && value.trim() ? [value.trim()] : []
  return value && typeof value === 'object' ? valuesAt(value[path[0]], path.slice(1)) : []
}
async function checkText(cloud, openid, content) {
  const characters = Array.from(content)
  for (let offset = 0; offset < characters.length; offset += 2000) {
    let result
    try { result = await cloud.openapi.security.msgSecCheck({ openid, version: 2, scene: 2, content: characters.slice(offset, offset + 2000).join('') }) }
    catch (error) {
      if (Number(error.errCode || error.code) === 87014) throw fail('CONTENT_REJECTED', '内容未通过安全检查，请修改后重试')
      throw fail('FEATURE_UNAVAILABLE', '内容安全检查暂不可用，请稍后重试', diagnostic(error, 'api_failed'))
    }
    if (result.result?.suggest === 'risky' || result.result?.suggest === 'review' || Number(result.errCode) === 87014) throw fail('CONTENT_REJECTED', '内容未通过安全检查，请修改后重试')
    if ((result.errCode && Number(result.errCode) !== 0) || result.result?.suggest !== 'pass') throw fail('FEATURE_UNAVAILABLE', '内容安全检查暂不可用，请稍后重试', diagnostic(result, 'no_pass_result'))
  }
}
async function checkAvatar(cloud, fileID) {
  if (!fileID) return
  if (typeof fileID !== 'string' || !fileID.startsWith('cloud://')) throw fail('VALIDATION_ERROR', '请重新选择并上传头像')
  try {
    const { fileContent } = await cloud.downloadFile({ fileID })
    if (!Buffer.isBuffer(fileContent) || fileContent.length > 1024 * 1024) throw fail('VALIDATION_ERROR', '请使用小于 1 MB 的头像')
    const png = fileContent.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    if (!png && !(fileContent[0] === 255 && fileContent[1] === 216)) throw fail('VALIDATION_ERROR', '请使用 PNG 或 JPG 头像')
    const result = await cloud.openapi.security.imgSecCheck({ media: { contentType: png ? 'image/png' : 'image/jpeg', value: fileContent } })
    if (Number(result.errCode) === 87014) throw fail('CONTENT_REJECTED', '头像未通过安全检查，请重新选择')
    if (result.errCode !== 0) throw fail('FEATURE_UNAVAILABLE', '头像安全检查暂不可用，请稍后重试或跳过头像')
  } catch (error) {
    if (['VALIDATION_ERROR', 'CONTENT_REJECTED', 'FEATURE_UNAVAILABLE'].includes(error.code)) throw error
    if (Number(error.errCode || error.code) === 87014) throw fail('CONTENT_REJECTED', '头像未通过安全检查，请重新选择')
    throw fail('FEATURE_UNAVAILABLE', '头像安全检查暂不可用，请稍后重试或跳过头像')
  }
}
function guardRepository(repository, cloud, rules) {
  return new Proxy(repository, { get(target, property) {
    const method = target[property]
    if (typeof method !== 'function') return method
    const rule = rules[property]
    if (!rule) return method.bind(target)
    return async (...args) => {
      const input = args[rule.arg || 1] || {}
      const content = (rule.fields || []).flatMap((field) => valuesAt(input, field.split('.'))).join('\n')
      if (content) await checkText(cloud, args[0], content)
      if (rule.avatar) await checkAvatar(cloud, input.avatarUrl)
      return method.apply(target, args)
    }
  } })
}
module.exports = { guardRepository, checkText, checkAvatar }
