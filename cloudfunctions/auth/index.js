'use strict'

const cloud = require('wx-server-sdk')
const { guardRepository } = require('./content-safety')
const { createAuthHandler } = require('./handler')
const { CloudBaseAuthRepository } = require('./repository')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const handler = createAuthHandler(guardRepository(new CloudBaseAuthRepository(cloud), cloud, {"updateProfile":{"fields":["displayName"],"avatar":true}}), console)

exports.main = async (event) => {
  const context = cloud.getWXContext()
  return handler(event, { openid: context.OPENID || '' })
}
