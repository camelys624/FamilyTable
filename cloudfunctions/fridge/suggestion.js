'use strict'

const { codedError } = require('./repository-utils')

const MAX_SUGGESTIONS = 5
const DEFAULT_TIMEOUT_MS = 20000

function normalizeName(value) {
  return String(value || '').trim().toLocaleLowerCase().replace(/\s+/g, '')
}

function unavailable(message = 'AI 建议暂时不可用，食材录入和做菜记录不受影响') {
  return codedError('FEATURE_UNAVAILABLE', message)
}

// 只把食材名和家庭菜谱名/食材名发给模型；不发送成员、家庭或用户标识。
function buildMessages(stockNames, recipes) {
  const recipeLines = recipes.map((recipe) => `- ${recipe.name}：${recipe.ingredients.join('、')}`).join('\n')
  return [
    {
      role: 'system',
      content: [
        '你是家庭厨房助手，根据冰箱里现有的食材推荐家常菜。',
        `最多推荐 ${MAX_SUGGESTIONS} 道菜，优先使用现有食材，优先推荐家庭菜谱里已有的菜。`,
        '只输出 JSON，不要输出其他文字，格式：',
        '{"suggestions":[{"name":"菜名","reason":"一句话理由","ingredients":["需要的主要食材"],"steps":["简短步骤"]}]}',
        'ingredients 写这道菜需要的全部主要食材（包括冰箱里没有的），不写用量。不要给出食品安全判断。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `冰箱现有食材：${stockNames.join('、')}\n家庭菜谱：\n${recipeLines || '（暂无）'}`,
    },
  ]
}

function stringList(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const result = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim().slice(0, maxLength)
    const key = normalizeName(trimmed)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
    if (result.length >= maxItems) break
  }
  return result
}

// 模型输出可能夹带 Markdown 代码块或前后说明；取第一个 JSON 对象，结构不对即视为失败。
function parseModelText(text) {
  if (typeof text !== 'string') throw unavailable()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw unavailable()
  let parsed
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch (error) {
    throw unavailable()
  }
  if (!parsed || !Array.isArray(parsed.suggestions)) throw unavailable()
  return parsed.suggestions
    .filter((item) => item && typeof item === 'object' && typeof item.name === 'string' && item.name.trim())
    .slice(0, MAX_SUGGESTIONS)
    .map((item) => ({
      name: item.name.trim().slice(0, 80),
      reason: typeof item.reason === 'string' ? item.reason.trim().slice(0, 200) : '',
      ingredients: stringList(item.ingredients, 30, 50),
      steps: stringList(item.steps, 10, 200),
    }))
}

// 可做/需补购由服务端按当前可用库存重新计算，不信任模型对“已有”的判断。
// 与家庭菜谱同名的建议改用菜谱自身的食材清单，保证和做菜消耗口径一致。
function reconcileSuggestions(rawSuggestions, stockNames, recipes) {
  const stock = new Set(stockNames.map(normalizeName))
  const recipeByName = new Map(recipes.map((recipe) => [normalizeName(recipe.name), recipe]))
  const seen = new Set()
  const suggestions = []
  for (const raw of rawSuggestions) {
    const key = normalizeName(raw.name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    const recipe = recipeByName.get(key) || null
    const ingredients = recipe ? recipe.ingredients : raw.ingredients
    const available = ingredients.filter((name) => stock.has(normalizeName(name)))
    const missing = ingredients.filter((name) => !stock.has(normalizeName(name)))
    // 一样现有食材都用不上的建议不属于“根据冰箱推荐”，丢弃。
    if (!available.length) continue
    suggestions.push({
      name: recipe ? recipe.name : raw.name,
      recipeId: recipe ? recipe.id : null,
      canCook: missing.length === 0,
      reason: raw.reason,
      available,
      missing,
      steps: raw.steps,
    })
  }
  return suggestions
}

function withTimeout(promise, timeoutMs) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(unavailable('AI 建议响应超时，食材录入和做菜记录不受影响')), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

// 供应商和模型由云函数环境变量指定；未配置时明确报“未开通”，不伪造推荐结果。
function createCloudBaseSuggester(cloud, env = process.env, logger = console) {
  const provider = (env.FRIDGE_AI_PROVIDER || 'cloudbase').trim()
  const model = (env.FRIDGE_AI_MODEL || '').trim()
  const parsedTimeout = Number(env.FRIDGE_AI_TIMEOUT_MS)
  const timeoutMs = Number.isInteger(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : DEFAULT_TIMEOUT_MS

  return async function suggest({ stockNames, recipes, requestId }) {
    if (!model) throw unavailable('AI 建议尚未开通，请联系管理员配置模型；食材录入和做菜记录不受影响')
    if (typeof cloud.ai !== 'function') throw unavailable('当前云函数环境不支持 AI 建议，请联系管理员')
    let result
    try {
      const chat = cloud.ai().createModel(provider)
      result = await withTimeout(chat.generateText({ model, messages: buildMessages(stockNames, recipes) }), timeoutMs)
    } catch (error) {
      if (error?.code === 'FEATURE_UNAVAILABLE') {
        logger.error('[fridge.suggest]', { requestId, message: error.message })
        throw error
      }
      logger.error('[fridge.suggest]', { requestId, message: error instanceof Error ? error.message : String(error) })
      throw unavailable()
    }
    try {
      return parseModelText(result?.text)
    } catch (error) {
      logger.error('[fridge.suggest]', { requestId, message: 'unparseable model output', length: String(result?.text || '').length })
      throw error
    }
  }
}

module.exports = {
  MAX_SUGGESTIONS,
  buildMessages,
  parseModelText,
  reconcileSuggestions,
  createCloudBaseSuggester,
  normalizeName,
}
