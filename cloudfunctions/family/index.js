'use strict'

const cloud = require('wx-server-sdk')
const { guardRepository } = require('./content-safety')
const { createFamilyHandler } = require('./handler')
const { CloudBaseFamilyRepository } = require('./repository')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const handler = createFamilyHandler(guardRepository(new CloudBaseFamilyRepository(cloud), cloud, {"create":{"fields":["name","displayName"]},"join":{"fields":["displayName"]}}), console)

exports.main = async (event) => {
  const context = cloud.getWXContext()
  return handler(event, { openid: context.OPENID || '' })
}
