'use strict'

const cloud = require('wx-server-sdk')
const { createFridgeHandler } = require('./handler')
const { CloudBaseFridgeRepository } = require('./repository')
const { createCloudBaseSuggester } = require('./suggestion')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const handler = createFridgeHandler(
  new CloudBaseFridgeRepository(cloud, createCloudBaseSuggester(cloud, process.env, console)),
  console,
)

exports.main = async (event) => {
  const context = cloud.getWXContext()
  return handler(event, { openid: context.OPENID || '' })
}
