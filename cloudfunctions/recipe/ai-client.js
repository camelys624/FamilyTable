'use strict'

let OpenAIClient

function getOpenAIClient() {
  if (!OpenAIClient) OpenAIClient = require('openai').OpenAI
  return OpenAIClient
}

const { buildExtractionPrompt } = require('./ingredient-assistant')

const DEFAULT_TIMEOUT_MS = 20 * 1000

const EXTRACTION_TOOL = {
  type: 'function',
  function: {
    name: 'extract_recipe_ingredients',
    description: '从操作步骤中提取有明确证据的食材、数量、单位和来源步骤',
    parameters: {
      type: 'object',
      properties: {
        ingredients: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '食材或调味料名称' },
              quantity: { type: ['number', 'null'], description: '明确的数字用量,无法确认时为 null' },
              unit: { type: 'string', description: '步骤中明确出现的单位,没有时为空字符串' },
              quantityText: { type: 'string', description: '步骤中的原始用量短语,例如“少许”或“两勺”' },
              evidenceStepIndexes: {
                type: 'array',
                items: { type: 'integer', minimum: 0 },
                description: '从 0 开始的步骤下标',
              },
              evidenceQuotes: {
                type: 'array',
                items: { type: 'string' },
                description: '与来源步骤对应的原文短引',
              },
              confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            },
            required: ['name', 'quantity', 'unit', 'quantityText', 'evidenceStepIndexes', 'evidenceQuotes', 'confidence'],
          },
        },
      },
      required: ['ingredients'],
    },
  },
}

function assistantError(code, message, cause) {
  const error = Object.assign(new Error(message), { code })
  if (cause) error.providerCause = String(cause.message || cause).slice(0, 300)
  return error
}

function normalizeBaseURL(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) throw assistantError('FEATURE_UNAVAILABLE', 'AI 整理暂未配置，请联系管理员')
  let url
  try {
    url = new URL(raw)
  } catch (error) {
    throw assistantError('FEATURE_UNAVAILABLE', 'AI 服务地址配置无效，请联系管理员', error)
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw assistantError('FEATURE_UNAVAILABLE', 'AI 服务地址必须使用 HTTPS，请联系管理员')
  }
  return url.toString().replace(/\/+$/, '')
}

function parseToolArguments(response) {
  const message = response?.choices?.[0]?.message || response?.Response?.Choices?.[0]?.Message
  const toolCalls = message?.tool_calls || message?.ToolCalls || []
  const toolCall = toolCalls.find((call) => {
    const functionCall = call?.function || call?.Function
    return (functionCall?.name || functionCall?.Name) === EXTRACTION_TOOL.function.name
  })
  const functionCall = toolCall?.function || toolCall?.Function
  const rawArguments = functionCall?.arguments || functionCall?.Arguments
  if (typeof rawArguments === 'string' && rawArguments.trim()) {
    try {
      return JSON.parse(rawArguments)
    } catch (error) {
      throw assistantError('INVALID_RESPONSE', 'AI 返回结果格式异常，请重试', error)
    }
  }
  if (typeof message?.content === 'string' && message.content.trim().startsWith('{')) {
    try {
      return JSON.parse(message.content)
    } catch (error) {
      throw assistantError('INVALID_RESPONSE', 'AI 返回结果格式异常，请重试', error)
    }
  }
  if (typeof message?.Content === 'string' && message.Content.trim().startsWith('{')) {
    try {
      return JSON.parse(message.Content)
    } catch (error) {
      throw assistantError('INVALID_RESPONSE', 'AI 返回结果格式异常，请重试', error)
    }
  }
  throw assistantError('INVALID_RESPONSE', 'AI 没有返回可用的食材结果，请重试')
}

function createOpenAICompatibleIngredientAssistant(env = process.env, createClient) {
  let client
  let model

  function getClient() {
    const apiKey = typeof env.AI_API_KEY === 'string' ? env.AI_API_KEY.trim() : ''
    const configuredModel = typeof env.AI_MODEL === 'string' ? env.AI_MODEL.trim() : ''
    const configuredBaseURL = typeof env.AI_BASE_URL === 'string' ? env.AI_BASE_URL.trim() : ''
    const missing = []
    if (!apiKey) missing.push('AI_API_KEY')
    if (!configuredBaseURL) missing.push('AI_BASE_URL')
    if (!configuredModel) missing.push('AI_MODEL')
    if (missing.length) {
      throw assistantError('FEATURE_UNAVAILABLE', `AI 配置不完整，缺少 ${missing.join('、')}`)
    }
    if (!client) {
      const baseURL = normalizeBaseURL(configuredBaseURL)
      const options = {
        apiKey,
        baseURL,
        timeout: DEFAULT_TIMEOUT_MS,
        maxRetries: 0,
      }
      if (createClient) {
        client = createClient(options)
      } else {
        const Client = getOpenAIClient()
        client = new Client(options)
      }
      model = configuredModel
    }
    return { client, model }
  }

  return {
    async extract(steps) {
      try {
        const configured = getClient()
        const response = await configured.client.chat.completions.create({
          model: configured.model,
          stream: false,
          temperature: 0,
          top_p: 0,
          messages: [
            {
              role: 'system',
              content: '严格按照工具参数输出结构化结果,不要输出工具调用以外的文字。',
            },
            {
              role: 'user',
              content: buildExtractionPrompt(steps),
            },
          ],
          tools: [EXTRACTION_TOOL],
          tool_choice: { type: 'function', function: { name: EXTRACTION_TOOL.function.name } },
        })
        return parseToolArguments(response)
      } catch (error) {
        if (['FEATURE_UNAVAILABLE', 'INVALID_RESPONSE', 'RATE_LIMITED'].includes(error?.code)) throw error
        const providerMessage = `${error?.code || ''} ${error?.message || ''}`.toLowerCase()
        if (error?.status === 429 || /limit|quota|too many|rate/.test(providerMessage)) {
          throw assistantError('RATE_LIMITED', 'AI 请求次数较多，请稍后再试', error)
        }
        throw assistantError('FEATURE_UNAVAILABLE', 'AI 整理暂时不可用，请稍后重试', error)
      }
    },
  }
}

module.exports = { EXTRACTION_TOOL, createOpenAICompatibleIngredientAssistant, normalizeBaseURL, parseToolArguments }
