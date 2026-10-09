'use strict'

const MAX_STEPS = 100
const MAX_STEP_LENGTH = 200
const MAX_TOTAL_STEP_LENGTH = 8000
const MAX_EXISTING_INGREDIENTS = 100
const MAX_INGREDIENT_NAME = 50
const MAX_UNIT_LENGTH = 12
const MAX_QUANTITY_TEXT = 40
const CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 }

function codedError(code, message, details = {}) {
  return Object.assign(new Error(message), { code, details })
}

function normalizeName(value) {
  return String(value || '').trim().toLocaleLowerCase().replace(/\s+/g, '')
}

function text(value, field, max, required = true) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (required && !normalized) throw codedError('VALIDATION_ERROR', `${field}不能为空`, { field })
  if (normalized.length > max) throw codedError('VALIDATION_ERROR', `${field}长度不能超过 ${max} 个字`, { field })
  return normalized
}

function normalizeQuantity(value, field) {
  if (value === null || value === undefined || value === '') return null
  const quantity = Number(value)
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100000) {
    throw codedError('VALIDATION_ERROR', `${field}数量需大于 0，且不能超过 100000`, { field })
  }
  return Math.round(quantity * 1000) / 1000
}

function normalizeExistingIngredient(value, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw codedError('VALIDATION_ERROR', '现有食材格式无效', { field: `existingIngredients[${index}]` })
  }
  const name = text(value.name, '食材名称', MAX_INGREDIENT_NAME)
  const unit = text(value.unit, '食材单位', MAX_UNIT_LENGTH, false)
  const quantity = normalizeQuantity(value.quantity, `existingIngredients[${index}].quantity`)
  return { name, quantity, unit }
}

function validateExtractionInput(payload = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw codedError('VALIDATION_ERROR', 'AI 整理食材的请求格式无效', { field: 'payload' })
  }
  const unknown = Object.keys(payload).filter((key) => !['steps', 'existingIngredients'].includes(key))
  if (unknown.length) throw codedError('VALIDATION_ERROR', '请求包含不支持的字段', { fields: unknown })
  if (!Array.isArray(payload.steps) || payload.steps.length < 1 || payload.steps.length > MAX_STEPS) {
    throw codedError('VALIDATION_ERROR', `操作步骤需填写 1～${MAX_STEPS} 步`, { field: 'steps' })
  }
  const steps = payload.steps.map((step, index) => text(step, `steps[${index}]`, MAX_STEP_LENGTH))
  const totalLength = steps.reduce((total, step) => total + step.length, 0)
  if (totalLength > MAX_TOTAL_STEP_LENGTH) {
    throw codedError('VALIDATION_ERROR', `操作步骤总长度不能超过 ${MAX_TOTAL_STEP_LENGTH} 个字`, { field: 'steps' })
  }
  const rawExisting = payload.existingIngredients === undefined ? [] : payload.existingIngredients
  if (!Array.isArray(rawExisting) || rawExisting.length > MAX_EXISTING_INGREDIENTS) {
    throw codedError('VALIDATION_ERROR', `现有食材不能超过 ${MAX_EXISTING_INGREDIENTS} 项`, { field: 'existingIngredients' })
  }
  const existingIngredients = rawExisting.map(normalizeExistingIngredient)
  return { steps, existingIngredients }
}

function buildExtractionPrompt(steps) {
  const numberedSteps = steps.map((step, index) => `${index + 1}. ${step}`).join('\n')
  return [
    '你是一个谨慎的中文菜谱食材抽取器,不是菜谱创作者。',
    '只从用户提供的操作步骤中提取明确出现的可食用食材、调味料和液体。',
    '不要根据菜名、常识或菜谱习惯补充步骤中没有证据的食材。',
    '不要把锅、刀、盘、火、油烟机等工具或动作当成食材。',
    '保留步骤中明确写出的数字和单位;“适量”“少许”“一把”等无法可靠换算为数字时 quantity 必须为 null,并保留 quantityText。',
    '每项必须给出来源步骤编号和原文短引,没有可靠来源时不要输出该项。',
    '只调用 extract_recipe_ingredients 工具,不要输出额外文字。',
    '',
    '操作步骤:',
    numberedSteps,
  ].join('\n')
}

function normalizeEvidenceIndexes(value, steps) {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value
    .map((index) => Number(index))
    .filter((index) => Number.isInteger(index) && index >= 0 && index < steps.length)))
}

function normalizeEvidenceQuotes(value, indexes, steps) {
  if (!Array.isArray(value)) return []
  return value
    .map((quote, index) => {
      if (typeof quote !== 'string') return ''
      const normalized = quote.trim().slice(0, 80)
      const stepIndex = indexes[index]
      return normalized && steps[stepIndex]?.includes(normalized) ? normalized : ''
    })
    .filter(Boolean)
}

function confidence(value) {
  return ['high', 'medium', 'low'].includes(value) ? value : 'low'
}

function normalizeModelOutput(output, steps) {
  if (!output || typeof output !== 'object' || !Array.isArray(output.ingredients)) {
    throw codedError('INVALID_RESPONSE', 'AI 返回结果格式异常，请重试')
  }
  if (output.ingredients.length > MAX_EXISTING_INGREDIENTS) {
    throw codedError('INVALID_RESPONSE', 'AI 返回的食材数量异常，请重试')
  }
  const warnings = []
  const byName = new Map()
  for (const raw of output.ingredients) {
    if (!raw || typeof raw !== 'object') {
      warnings.push('AI 返回了一项无法识别的食材')
      continue
    }
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, MAX_INGREDIENT_NAME) : ''
    if (!name) {
      warnings.push('AI 返回了一项没有名称的食材')
      continue
    }
    let quantity = null
    if (raw.quantity !== null && raw.quantity !== undefined && raw.quantity !== '') {
      const parsed = Number(raw.quantity)
      if (Number.isFinite(parsed) && parsed > 0 && parsed <= 100000) {
        quantity = Math.round(parsed * 1000) / 1000
      } else {
        warnings.push(`${name} 的用量无法确认,已留空`)
      }
    }
    const unit = typeof raw.unit === 'string' ? raw.unit.trim().slice(0, MAX_UNIT_LENGTH) : ''
    const quantityText = typeof raw.quantityText === 'string' ? raw.quantityText.trim().slice(0, MAX_QUANTITY_TEXT) : ''
    const evidenceStepIndexes = normalizeEvidenceIndexes(raw.evidenceStepIndexes, steps)
    const evidenceQuotes = normalizeEvidenceQuotes(raw.evidenceQuotes, evidenceStepIndexes, steps)
    if (!evidenceStepIndexes.length) {
      warnings.push(`${name} 缺少步骤依据,已标记为低确定度`)
    }
    const candidate = {
      name,
      quantity,
      unit,
      quantityText,
      evidenceStepIndexes,
      evidenceQuotes,
      confidence: confidence(raw.confidence),
    }
    const key = normalizeName(name)
    const previous = byName.get(key)
    if (!previous || CONFIDENCE_RANK[candidate.confidence] > CONFIDENCE_RANK[previous.confidence]) {
      byName.set(key, candidate)
    }
  }
  return { ingredients: Array.from(byName.values()), warnings }
}

function existingSuggestion(ingredient, confidenceValue = 'high') {
  return {
    name: ingredient.name,
    quantity: ingredient.quantity,
    unit: ingredient.unit,
    quantityText: ingredient.quantity === null ? '' : String(ingredient.quantity),
    evidenceStepIndexes: [],
    evidenceQuotes: [],
    confidence: confidenceValue,
  }
}

function sameQuantity(left, right) {
  return left === right || (left !== null && right !== null && Number(left) === Number(right))
}

function reconcileIngredients(detected, existingIngredients) {
  const existingByName = new Map(existingIngredients.map((ingredient) => [normalizeName(ingredient.name), ingredient]))
  const detectedNames = new Set(detected.map((ingredient) => normalizeName(ingredient.name)))
  const add = []
  const update = []
  const needsQuantity = []

  for (const ingredient of detected) {
    const existing = existingByName.get(normalizeName(ingredient.name))
    if (!existing) {
      add.push(ingredient)
      if (ingredient.quantity === null) needsQuantity.push(ingredient)
      continue
    }
    const quantityChanged = ingredient.quantity !== null && !sameQuantity(ingredient.quantity, existing.quantity)
    const unitChanged = Boolean(ingredient.unit) && ingredient.unit !== existing.unit
    if (quantityChanged || unitChanged) {
      update.push({
        existing: existingSuggestion(existing),
        suggested: ingredient,
        reason: quantityChanged ? '步骤中的用量与当前食材不同' : '步骤中的单位与当前食材不同',
      })
    }
    if (ingredient.quantity === null && existing.quantity === null) needsQuantity.push(ingredient)
  }

  const removeCandidates = detected.length
    ? existingIngredients
      .filter((ingredient) => !detectedNames.has(normalizeName(ingredient.name)))
      .map((ingredient) => ({
        ...existingSuggestion(ingredient, 'low'),
        reason: '步骤中未提及,可能是准备材料或基础调味料',
      }))
    : []
  const warnings = detected.length ? [] : ['没有找到明确的食材,未生成删除建议']

  return { add, update, removeCandidates, needsQuantity, warnings }
}

module.exports = {
  MAX_STEPS,
  MAX_STEP_LENGTH,
  MAX_TOTAL_STEP_LENGTH,
  buildExtractionPrompt,
  normalizeModelOutput,
  reconcileIngredients,
  validateExtractionInput,
}
