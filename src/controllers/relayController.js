const { getRelayState, updateRelayState } = require('../store')
const { sendRelayControl } = require('../services/externalApiService')

async function getRelayStateHandler(_req, res, next) {
  try {
    const state = getRelayState()

    return res.json({
      success: true,
      state,
      ...state,
    })
  } catch (error) {
    if (typeof next === 'function') {
      return next(error)
    }
    return res.status(500).json({
      success: false,
      message: 'Failed to get relay state',
      error: error.message,
    })
  }
}

async function postRelayControl(req, res, next) {
  try {
    const payload = req.body || {}
    const inputState = payload.state && typeof payload.state === 'object' ? payload.state : payload
    const hasRelay1 = Object.prototype.hasOwnProperty.call(inputState, 'relay1')
    const hasRelay2 = Object.prototype.hasOwnProperty.call(inputState, 'relay2')

    if (!hasRelay1 && !hasRelay2) {
      return res.status(400).json({
        success: false,
        message: 'Payload must include relay1 or relay2',
      })
    }

    const current = getRelayState()
    const nextState = {
      relay1: hasRelay1 ? inputState.relay1 : current.relay1,
      relay2: hasRelay2 ? inputState.relay2 : current.relay2,
    }

    await sendRelayControl(nextState)

    const state = updateRelayState(nextState, 'api')

    return res.json({
      success: true,
      message: 'Relay state updated',
      state,
      ...state,
    })
  } catch (error) {
    if (typeof next === 'function') {
      return next(error)
    }
    return res.status(500).json({
      success: false,
      message: 'Failed to update relay state',
      error: error.message,
    })
  }
}

module.exports = {
  getRelayStateHandler,
  postRelayControl,
}