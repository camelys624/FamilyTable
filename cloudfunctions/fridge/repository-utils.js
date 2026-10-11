'use strict'

const crypto = require('crypto')

function codedError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details })
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = stableValue(value[key])
        return result
      }, {})
  }
  return value
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function documentData(document) {
  const { _id, ...data } = document
  return data
}

function now() {
  return new Date()
}

function requestHash(input) {
  return hash(JSON.stringify(stableValue(input)))
}

function idempotencyId(userId, action, requestId) {
  return `idem_${hash(`${userId}:${action}:${requestId}`).slice(0, 40)}`
}

function operationLogId() {
  return `log_${crypto.randomBytes(12).toString('hex')}`
}

function resourceId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`
}

module.exports = { codedError, stableValue, hash, documentData, now, requestHash, idempotencyId, operationLogId, resourceId }
