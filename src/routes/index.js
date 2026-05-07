const express = require('express')

const { getLatestPzem, getPzemHistory, postPzem } = require('../controllers/pzemController')
const { getRelayStateHandler, postRelayControl } = require('../controllers/relayController')
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
      'GET /relay-state',
      'POST /relay-control',
      'POST /ai',
    ],
  })
})

apiRouter.get('/pzem', getLatestPzem)
apiRouter.get('/pzem/latest', getLatestPzem)
apiRouter.get('/pzem/history', getPzemHistory)
apiRouter.post('/pzem', postPzem)

apiRouter.get('/relay-state', getRelayStateHandler)
apiRouter.post('/relay-control', postRelayControl)

apiRouter.post('/ai', postAi)

module.exports = { apiRouter }