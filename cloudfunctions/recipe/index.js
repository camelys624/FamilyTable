'use strict'

const cloud = require('wx-server-sdk')
const { guardRepository } = require('./content-safety')
const { createRecipeHandler } = require('./handler')
const { createOpenAICompatibleIngredientAssistant } = require('./ai-client')
const { CloudBaseRecipeRepository } = require('./repository')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const handler = createRecipeHandler(
  guardRepository(new CloudBaseRecipeRepository(cloud), cloud, {"create":{"fields":["name","category","note","steps","ingredients.name"]},"update":{"arg":2,"fields":["name","category","note","steps","ingredients.name"]}}),
  console,
  createOpenAICompatibleIngredientAssistant(),
)

exports.main = async (event) => {
  const context = cloud.getWXContext()
  return handler(event, { openid: context.OPENID || '' })
}
