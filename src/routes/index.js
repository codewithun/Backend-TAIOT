const express = require('express')

const { getLatestPzem, getPzemHistory, postPzem } = require('../controllers/pzemController')
const { getRelayStateHandler, postRelayControl } = require('../controllers/relayController')
const { createRelayDeviceHandler, deleteRelayDeviceHandler, listRelayDevicesHandler, updateRelayDeviceHandler } = require('../controllers/relayDeviceController')
const { getSummarySnapshotHandler } = require('../controllers/summaryController')
const { postAi } = require('../controllers/aiController')

const apiRouter = express.Router()

apiRouter.get('/', (_req, res) => {
  res.json({
    success: true,
    message: 'TAIOT API is running',
    endpoints: [
      'GET /health',
      'GET /pzem',
      'GET /pzem/latest',
      'GET /pzem/history?limit=24',
      'POST /pzem',
      'GET /summary',
      'GET /relay-state',
      'POST /relay-control',
      'GET /relay-devices',
      'POST /relay-devices',
      'PATCH /relay-devices/:id',
      'DELETE /relay-devices/:id',
      'POST /ai',
    ],
  })
})

apiRouter.get('/pzem', getLatestPzem)
apiRouter.get('/pzem/latest', getLatestPzem)
apiRouter.get('/pzem/history', getPzemHistory)
apiRouter.post('/pzem', postPzem)

apiRouter.get('/summary', getSummarySnapshotHandler)

apiRouter.get('/relay-state', getRelayStateHandler)
apiRouter.post('/relay-control', postRelayControl)

apiRouter.get('/relay-devices', listRelayDevicesHandler)
apiRouter.post('/relay-devices', createRelayDeviceHandler)
apiRouter.patch('/relay-devices/:id', updateRelayDeviceHandler)
apiRouter.delete('/relay-devices/:id', deleteRelayDeviceHandler)

apiRouter.post('/ai', postAi)

module.exports = { apiRouter }