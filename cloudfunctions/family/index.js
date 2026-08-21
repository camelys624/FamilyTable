'use strict'

const cloud = require('wx-server-sdk')
const { createFamilyHandler } = require('./handler')
const { CloudBaseFamilyRepository } = require('./repository')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const handler = createFamilyHandler(new CloudBaseFamilyRepository(cloud), console)

exports.main = async (event) => {
  const context = cloud.getWXContext()
  return handler(event, { openid: context.OPENID || '' })
}
