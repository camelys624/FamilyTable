'use strict'

const cloud = require('wx-server-sdk')
const { createMenuHandler } = require('./handler')
const { CloudBaseMenuRepository } = require('./repository')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const handler = createMenuHandler(new CloudBaseMenuRepository(cloud), console)

exports.main = async (event) => {
  const context = cloud.getWXContext()
  return handler(event, { openid: context.OPENID || '' })
}
