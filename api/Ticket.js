const _ = require('lodash')
const AV = require('leanengine')

const common = require('./common')
const errorHandler = require('./errorHandler')

AV.Cloud.beforeSave('Ticket', (req, res) => {
  if (!req.currentUser._sessionToken) {
    return res.error('noLogin')
  }
  getTicketAcl(req.object, req.currentUser).then((acl) => {
    req.object.setACL(acl)
    req.object.set('author', req.currentUser)
    return selectAssignee(req.object)
  }).then((assignee) => {
    req.object.set('assignee', assignee)
    res.success()
  }).catch(errorHandler.captureException)
})

const getTicketAcl = (ticket, author) => {
  const acl = new AV.ACL()
  acl.setWriteAccess(author, true)
  acl.setReadAccess(author, true)
  acl.setRoleWriteAccess(new AV.Role('customerService'), true)
  acl.setRoleReadAccess(new AV.Role('customerService'), true)
  return Promise.resolve(acl)
}

AV.Cloud.afterSave('Ticket', (req) => {
  console.log('>> Ticket afterSave')
  common.getTinyUserInfo(req.object.get('assignee'))
  .then((assignee) => {
    console.log('>> Ticket afterSave, assignee=', assignee)
    return new AV.Object('OpsLog').save({
      ticket: req.object,
      action: 'selectAssignee',
      data: {assignee},
    })
  }).catch(errorHandler.captureException)
})

AV.Cloud.afterUpdate('Ticket', (req) => {
  common.getTinyUserInfo(req.currentUser).then((user) => {
    if (req.object.updatedKeys.indexOf('status') != -1) {
      new AV.Object('OpsLog').save({
        ticket: req.object,
        action: 'changeStatus',
        data: {status: req.object.get('status'), operator: user},
      })
    }
    if (req.object.updatedKeys.indexOf('category') != -1) {
      new AV.Object('OpsLog').save({
        ticket: req.object,
        action: 'changeCategory',
        data: {category: req.object.get('category'), operator: user},
      })
    }
    if (req.object.updatedKeys.indexOf('assignee') != -1) {
      common.getTinyUserInfo(req.object.get('assignee')).then((assignee) => {
        new AV.Object('OpsLog').save({
          ticket: req.object,
          action: 'changeAssignee',
          data: {assignee: assignee, operator: user},
        })
      })
    }
  })
})


const selectAssignee = (ticket) => {
  return new AV.Query(AV.Role)
  .equalTo('name', 'customerService')
  .first()
  .then((role) => {
    const category = ticket.get('category')
    const query = role.getUsers().query()
    if (!_.isEmpty(category)) {
      query.equalTo('categories.objectId', category.objectId)
    }
    return query.find()
  }).then((users) => {
    return _.sample(users)
  })
}
