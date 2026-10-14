'use strict'

const cloud = require('wx-server-sdk')
const { guardRepository } = require('./content-safety')
const { createFridgeHandler } = require('./handler')
const { CloudBaseFridgeRepository } = require('./repository')
const { createCloudBaseSuggester } = require('./suggestion')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const handler = createFridgeHandler(
  guardRepository(new CloudBaseFridgeRepository(cloud, createCloudBaseSuggester(cloud, process.env, console)), cloud, { createBatch: { fields: ['name'] }, updateBatch: { fields: ['name'] } }),
  console,
)

exports.main = async (event) => {
  const context = cloud.getWXContext()
  return handler(event, { openid: context.OPENID || '' })
}
