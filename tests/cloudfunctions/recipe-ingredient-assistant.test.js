'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { createRecipeHandler, normalizePatch } = require('../../cloudfunctions/recipe/handler')
const {
  buildExtractionPrompt,
  normalizeModelOutput,
  reconcileIngredients,
  validateExtractionInput,
} = require('../../cloudfunctions/recipe/ingredient-assistant')
const { createOpenAICompatibleIngredientAssistant, normalizeBaseURL, parseToolArguments } = require('../../cloudfunctions/recipe/ai-client')

const silentLogger = { error() {} }

function extractedIngredient(overrides = {}) {
  return {
    name: '生抽',
    quantity: 2,
    unit: '勺',
    quantityText: '两勺',
    evidenceStepIndexes: [1],
    evidenceQuotes: ['加入生抽'],
    confidence: 'high',
    ...overrides,
  }
}

test('recipe.update keeps normalized ingredients in the patch', () => {
  const result = normalizePatch({
    recipeId: 'recipe-1',
    patch: {
      name: '红烧肉',
      ingredients: [{ name: '  生抽 ', usedUp: false }],
    },
  })
  assert.deepEqual(result.patch.ingredients, [{ name: '生抽', usedUp: false }])
})

test('ingredient extraction validates input and builds a grounded prompt', () => {
  const input = validateExtractionInput({
    steps: ['五花肉切块', '加入生抽和冰糖'],
    existingIngredients: [{ name: '盐', quantity: 2, unit: '克' }],
  })
  const prompt = buildExtractionPrompt(input.steps)
  assert.match(prompt, /1\. 五花肉切块/)
  assert.match(prompt, /不要把锅、刀、盘、火/)
  assert.deepEqual(input.existingIngredients[0], { name: '盐', quantity: 2, unit: '克' })
})

test('recipe.extractIngredients returns deterministic add, update and removal suggestions', async () => {
  let receivedSteps = []
  const handler = createRecipeHandler({ async getContext() {} }, silentLogger, {
    async extract(steps, requestId) {
      receivedSteps = steps
      assert.equal(requestId, 'req_extract_001')
      return { ingredients: [extractedIngredient(), extractedIngredient({ name: '冰糖', quantity: null, unit: '', quantityText: '适量' })] }
    },
  })
  const result = await handler({
    action: 'recipe.extractIngredients',
    requestId: 'req_extract_001',
    payload: {
      steps: ['五花肉切块', '锅中倒油,加入生抽和冰糖'],
      existingIngredients: [
        { name: '生抽', quantity: 1, unit: '勺' },
        { name: '盐', quantity: 2, unit: '克' },
      ],
    },
  }, { openid: 'trusted-openid' })

  assert.deepEqual(receivedSteps, ['五花肉切块', '锅中倒油,加入生抽和冰糖'])
  assert.equal(result.ok, true)
  assert.equal(result.data.diff.add[0].name, '冰糖')
  assert.equal(result.data.diff.add[0].quantity, null)
  assert.equal(result.data.diff.update[0].existing.name, '生抽')
  assert.equal(result.data.diff.update[0].suggested.quantity, 2)
  assert.equal(result.data.diff.removeCandidates[0].name, '盐')
  assert.match(result.data.diff.update[0].reason, /用量/)
  assert.deepEqual(result.data.diff.needsQuantity.map((item) => item.name), ['冰糖'])
})

test('empty extraction never creates removal suggestions', () => {
  const result = reconcileIngredients([], [{ name: '盐', quantity: 2, unit: '克' }])
  assert.deepEqual(result.removeCandidates, [])
  assert.match(result.warnings[0], /没有找到明确的食材/)
})

test('invalid assistant output is returned as a safe error', async () => {
  const handler = createRecipeHandler({ async getContext() {} }, silentLogger, {
    async extract() {
      return { ingredients: [{ name: '油', quantity: 'not-a-number' }] }
    },
  })
  const result = await handler({
    action: 'recipe.extractIngredients',
    payload: { steps: ['锅中倒油'], existingIngredients: [] },
  }, { openid: 'trusted-openid' })
  assert.equal(result.ok, true)
  assert.equal(result.data.detected[0].quantity, null)
  assert.match(result.data.warnings[0], /用量无法确认/)
})

test('missing assistant configuration stays actionable', async () => {
  const handler = createRecipeHandler({ async getContext() {} }, silentLogger)
  const result = await handler({
    action: 'recipe.extractIngredients',
    payload: { steps: ['锅中倒油'], existingIngredients: [] },
  }, { openid: 'trusted-openid' })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'FEATURE_UNAVAILABLE')
})

test('ingredient extraction rejects forged and oversized payload fields', async () => {
  const handler = createRecipeHandler({ async getContext() {} }, silentLogger, { async extract() { return { ingredients: [] } } })
  const forged = await handler({
    action: 'recipe.extractIngredients',
    payload: { steps: ['锅中倒油'], existingIngredients: [], openid: 'forged' },
  }, { openid: 'trusted-openid' })
  assert.equal(forged.ok, false)
  assert.equal(forged.error.code, 'VALIDATION_ERROR')

  assert.throws(
    () => validateExtractionInput({ steps: ['x'.repeat(2001)], existingIngredients: [] }),
    (error) => error.code === 'VALIDATION_ERROR',
  )
})
test('hunyuan tool-call arguments are parsed without exposing provider text', () => {
  const result = parseToolArguments({
    choices: [{
      message: {
        tool_calls: [{
          function: {
            name: 'extract_recipe_ingredients',
            arguments: '{"ingredients":[]}',
          },
        }],
      },
    }],
  })
  assert.deepEqual(result, { ingredients: [] })
})

test('hunyuan assistant fails safely when server credentials are absent', async () => {
  const assistant = createOpenAICompatibleIngredientAssistant({})
  await assert.rejects(
    () => assistant.extract(['锅中倒油']),
    (error) => error.code === 'FEATURE_UNAVAILABLE' && /AI_API_KEY/.test(error.message),
  )
})
test('hunyuan assistant uses base URL and API key with OpenAI-compatible requests', async () => {
  let clientOptions
  let request
  const assistant = createOpenAICompatibleIngredientAssistant({
    AI_API_KEY: 'test-api-key',
    AI_BASE_URL: 'https://api.example.com/v1/',
    AI_MODEL: 'test-model',
  }, (options) => {
    clientOptions = options
    return {
      chat: {
        completions: {
          async create(payload) {
            request = payload
            return {
              choices: [{
                message: {
                  tool_calls: [{
                    function: {
                      name: 'extract_recipe_ingredients',
                      arguments: '{"ingredients":[]}',
                    },
                  }],
                },
              }],
            }
          },
        },
      },
    }
  })

  const result = await assistant.extract(['锅中倒油'])
  assert.deepEqual(result, { ingredients: [] })
  assert.equal(clientOptions.apiKey, 'test-api-key')
  assert.equal(clientOptions.baseURL, 'https://api.example.com/v1')
  assert.equal(request.model, 'test-model')
  assert.equal(request.tools[0].function.name, 'extract_recipe_ingredients')
  assert.equal(request.tool_choice.function.name, 'extract_recipe_ingredients')
})
test('compatible client requires an HTTPS base URL', () => {
  assert.throws(
    () => normalizeBaseURL('http://api.example.com/v1'),
    (error) => error.code === 'FEATURE_UNAVAILABLE' && /HTTPS/.test(error.message),
  )
})
