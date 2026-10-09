'use strict'

const cloud = require('wx-server-sdk')
const { createRecipeHandler } = require('./handler')
const { createOpenAICompatibleIngredientAssistant } = require('./ai-client')
const { CloudBaseRecipeRepository } = require('./repository')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const handler = createRecipeHandler(
  new CloudBaseRecipeRepository(cloud),
  console,
  createOpenAICompatibleIngredientAssistant(),
)

exports.main = async (event) => {
  const context = cloud.getWXContext()
  return handler(event, { openid: context.OPENID || '' })
}
