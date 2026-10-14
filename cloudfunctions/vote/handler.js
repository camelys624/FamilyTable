'use strict'

const { createHandler, codedError, text, date, today } = require('./common')
const meal = (value = 'dinner') => {
  if (!['breakfast', 'lunch', 'dinner'].includes(value)) throw codedError('VALIDATION_ERROR', '请选择有效餐次')
  return value
}

function createVoteHandler(repository, logger) {
  return createHandler(repository, {
    'vote.current': { method: 'current', fields: ['targetDate', 'mealType'], normalize: (p) => ({ targetDate: date(p.targetDate || today()), mealType: meal(p.mealType) }) },
    'vote.result': { method: 'result', fields: ['pollId'], normalize: (p) => ({ pollId: text(p.pollId, '投票', 100) }) },
    'vote.createPoll': { method: 'createPoll', write: true, fields: ['title', 'targetDate', 'mealType', 'candidateRecipeIds', 'closesAt'], normalize(p) {
      if (!Array.isArray(p.candidateRecipeIds) || p.candidateRecipeIds.length < 2 || p.candidateRecipeIds.length > 10) throw codedError('VALIDATION_ERROR', '请选择 2～10 道候选菜')
      const ids = p.candidateRecipeIds.map((id) => text(id, '候选菜', 100))
      if (new Set(ids).size !== ids.length) throw codedError('VALIDATION_ERROR', '候选菜不能重复')
      const closesAt = new Date(p.closesAt)
      if (typeof p.closesAt !== 'string' || !Number.isFinite(closesAt.getTime())) throw codedError('VALIDATION_ERROR', '请选择有效截止时间')
      return { title: text(p.title, '投票标题'), targetDate: date(p.targetDate), mealType: meal(p.mealType), candidateRecipeIds: ids, closesAt: closesAt.toISOString() }
    } },
    'vote.cast': { method: 'cast', write: true, fields: ['pollId', 'candidateRecipeId'], normalize: (p) => ({ pollId: text(p.pollId, '投票', 100), candidateRecipeId: text(p.candidateRecipeId, '候选菜', 100) }) },
    'vote.close': { method: 'close', write: true, fields: ['pollId'], normalize: (p) => ({ pollId: text(p.pollId, '投票', 100) }) },
  }, logger)
}

module.exports = { createVoteHandler }
