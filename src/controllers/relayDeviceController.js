const {
  createRelayDevice,
  deleteRelayDevice,
  getRelayDevices,
  getRelayState,
  relayDeviceToResponse,
  syncRelayDeviceState,
  updateRelayDevice,
  updateRelayState,
} = require('../store')
const { sendRelayControl } = require('../services/externalApiService')

function toBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1' || value === 'true' || value === 'on') return true
  if (value === 0 || value === '0' || value === 'false' || value === 'off') return false
  return fallback
}

async function listRelayDevicesHandler(_req, res, next) {
  try {
    const devices = await getRelayDevices()

    return res.json({
      success: true,
      devices,
    })
  } catch (error) {
    if (typeof next === 'function') return next(error)

    return res.status(500).json({
      success: false,
      message: 'Failed to get relay devices',
      error: error.message,
    })
  }
}

async function createRelayDeviceHandler(req, res, next) {
  try {
    const device = await createRelayDevice(req.body || {})

    return res.status(201).json({
      success: true,
      message: 'Relay device created',
      device,
    })
  } catch (error) {
    if (typeof next === 'function') return next(error)

    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Failed to create relay device',
    })
  }
}

async function updateRelayDeviceHandler(req, res, next) {
  try {
    const { id } = req.params
    const payload = req.body || {}
    const existingState = await getRelayState()
    const currentDevices = await getRelayDevices()
    const currentDevice = currentDevices.find(device => device.id === id)

    if (!currentDevice) {
      return res.status(404).json({
        success: false,
        message: 'Relay device not found',
      })
    }

    const nextStatus = payload.status !== undefined
      ? toBoolean(payload.status, currentDevice.status === 'aktif')
      : payload.isActive !== undefined
        ? toBoolean(payload.isActive, currentDevice.status === 'aktif')
        : payload.active !== undefined
          ? toBoolean(payload.active, currentDevice.status === 'aktif')
          : currentDevice.status === 'aktif'

    let updatedDevice = currentDevice

    if (currentDevice.relayKey === 'relay1' || currentDevice.relayKey === 'relay2') {
      const nextRelayState = {
        relay1: currentDevice.relayKey === 'relay1' ? nextStatus : existingState.relay1,
        relay2: currentDevice.relayKey === 'relay2' ? nextStatus : existingState.relay2,
        raw: payload.raw || payload,
      }

      // Attempt to send external relay control, but do not fail the whole request if the external call errors.
      let externalError = null
      try {
        await sendRelayControl({
          relay1: nextRelayState.relay1,
          relay2: nextRelayState.relay2,
        })
      } catch (err) {
        externalError = err
        console.error('[RelayDeviceController] sendRelayControl failed:', err?.message || err)
      }

      const savedState = await updateRelayState(nextRelayState, 'api')
      await syncRelayDeviceState('relay1', savedState.relay1)
      await syncRelayDeviceState('relay2', savedState.relay2)
      updatedDevice = await updateRelayDevice(id, {
        ...payload,
        status: nextStatus,
      })

      if (externalError) {
        // Attach an informational warning to the response rather than throwing.
        return res.status(200).json({
          success: true,
          message: 'Relay device updated (external relay-control failed)',
          warning: externalError.message || String(externalError),
          device: relayDeviceToResponse({
            ...currentDevice,
            ...updatedDevice,
            status: nextStatus,
          }),
        })
      }
    } else {
      updatedDevice = await updateRelayDevice(id, {
        ...payload,
        status: nextStatus,
      })
    }

    return res.json({
      success: true,
      message: 'Relay device updated',
      device: relayDeviceToResponse({
        ...currentDevice,
        ...updatedDevice,
        status: nextStatus,
      }),
    })
  } catch (error) {
    if (typeof next === 'function') return next(error)

    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Failed to update relay device',
    })
  }
}

async function deleteRelayDeviceHandler(req, res, next) {
  try {
    const { id } = req.params
    const deleted = await deleteRelayDevice(id)

    return res.json({
      success: true,
      message: 'Relay device deleted',
      device: deleted,
    })
  } catch (error) {
    if (typeof next === 'function') return next(error)

    return res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Failed to delete relay device',
    })
  }
}

module.exports = {
  createRelayDeviceHandler,
  deleteRelayDeviceHandler,
  listRelayDevicesHandler,
  updateRelayDeviceHandler,
}
