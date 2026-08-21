'use strict'

const cloud = require('wx-server-sdk')
const { createAuthHandler } = require('./handler')
const { CloudBaseAuthRepository } = require('./repository')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const handler = createAuthHandler(new CloudBaseAuthRepository(cloud), console)

exports.main = async (event) => {
  const context = cloud.getWXContext()
  return handler(event, { openid: context.OPENID || '' })
}
