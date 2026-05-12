const { getRelayState, updateRelayState, buildRelayStateSnapshot, syncRelayDeviceState } = require('../store')
const { sendRelayControl } = require('../services/externalApiService')

async function getRelayStateHandler(_req, res, next) {
  try {
    const state = await getRelayState()

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
    const current = await getRelayState()
    const nextState = buildRelayStateSnapshot(inputState, current)

    if (!Array.isArray(nextState.relays) || nextState.relays.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Payload must include relay state data',
      })
    }

    const relayPayload = {
      relay1: nextState.relayMap.relay1 ?? nextState.relay1,
      relay2: nextState.relayMap.relay2 ?? nextState.relay2,
    }

    const hasExtraRelays = nextState.relays.some(relay => relay.key !== 'relay1' && relay.key !== 'relay2')

    if (!hasExtraRelays) {
      await sendRelayControl(relayPayload)
    }

    const state = await updateRelayState({
      ...nextState,
      relay1: relayPayload.relay1,
      relay2: relayPayload.relay2,
      raw: payload,
    }, hasExtraRelays ? 'api-local-dynamic' : 'api')

    // Ensure persisted RelayDevice statuses reflect the new relay state for built-in relays
    try {
      await syncRelayDeviceState('relay1', state.relay1)
      await syncRelayDeviceState('relay2', state.relay2)
    } catch (syncErr) {
      // do not fail the request if syncing devices fails; just log
      console.error('[RelayController] Failed to sync relay devices:', syncErr?.message || syncErr)
    }

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