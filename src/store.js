const { fetchFromExternalApi, mapExternalToReading } = require('./services/externalApiService')

const INITIAL_RELAY_STATE = {
  relay1: false,
  relay2: false,
}

const readings = []

const relayState = {
  ...INITIAL_RELAY_STATE,
  updatedAt: new Date().toISOString(),
  source: 'server',
}

let lastExternalReading = null

function toNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1' || value === 'true' || value === 'on') return true
  if (value === 0 || value === '0' || value === 'false' || value === 'off') return false
  return fallback
}

function normalizeReading(payload = {}, source = 'esp') {
  const timestamp = payload.timestamp || payload.time || new Date().toISOString()

  return {
    id: payload.id || `pzem_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    deviceId: payload.deviceId || payload.device_id || payload.sensorId || 'pzem-1',
    timestamp,
    serverTimestamp: new Date().toISOString(),
    voltage: toNumber(payload.voltage ?? payload.tegangan ?? payload.v, 0),
    current: toNumber(payload.current ?? payload.arus ?? payload.i, 0),
    frequency: toNumber(payload.frequency ?? payload.frekuesi ?? payload.frekuensi ?? payload.f, 0),
    power: toNumber(payload.power ?? payload.power_w ?? payload.daya ?? payload.p, 0),
    energy: toNumber(payload.energy ?? payload.kwh ?? payload.kWh, 0),
    powerFactor: toNumber(payload.powerFactor ?? payload.pf ?? payload.factor, 0),
    relay1: normalizeBoolean(payload.relay1, relayState.relay1),
    relay2: normalizeBoolean(payload.relay2, relayState.relay2),
    source,
    raw: payload,
  }
}

function seedDemoReadings() {
  if (readings.length > 0) return

  const now = Date.now()
  const samples = [
    { voltage: 221.6, current: 7.82, frequency: 50.02, power: 1728, energy: 18.4, powerFactor: 0.97 },
    { voltage: 222.1, current: 7.95, frequency: 50.01, power: 1768, energy: 18.42, powerFactor: 0.97 },
    { voltage: 221.4, current: 8.08, frequency: 50.00, power: 1792, energy: 18.45, powerFactor: 0.98 },
  ]

  samples.forEach((sample, index) => {
    readings.push(normalizeReading({
      ...sample,
      timestamp: new Date(now - ((samples.length - index) * 60000)).toISOString(),
    }, 'seed'))
  })
}

function addReading(payload, source = 'esp') {
  const reading = normalizeReading(payload, source)
  readings.push(reading)
  return reading
}

async function getLatestReading() {
  seedDemoReadings()
  
  try {
    // Try to fetch from external API first
    const externalData = await fetchFromExternalApi()
    if (externalData && (externalData.pzem1 || externalData.pzem?.pzem1)) {
      const reading = mapExternalToReading(externalData, 'external-api')
      
      // Sync relay state from external API
      relayState.relay1 = reading.relay1
      relayState.relay2 = reading.relay2
      relayState.updatedAt = new Date().toISOString()
      relayState.source = 'external-api'
      
      // Store in history for reference
      readings.push(reading)
      if (readings.length > 500) readings.shift()
      
      lastExternalReading = reading
      return reading
    }
  } catch (error) {
    console.error('[Store] External API fetch error:', error.message)
  }
  
  // Fallback to last external reading or local readings
  if (lastExternalReading) {
    return lastExternalReading
  }
  
  return readings[readings.length - 1] || null
}

function getReadingHistory(limit = 24) {
  seedDemoReadings()
  const safeLimit = Math.max(1, Math.min(toNumber(limit, 24), 500))
  return readings.slice(-safeLimit)
}

function updateRelayState(nextState = {}, source = 'server') {
  relayState.relay1 = normalizeBoolean(nextState.relay1, relayState.relay1)
  relayState.relay2 = normalizeBoolean(nextState.relay2, relayState.relay2)
  relayState.updatedAt = new Date().toISOString()
  relayState.source = source
  return getRelayState()
}

function getRelayState() {
  return {
    relay1: relayState.relay1,
    relay2: relayState.relay2,
    updatedAt: relayState.updatedAt,
    source: relayState.source,
  }
}

module.exports = {
  INITIAL_RELAY_STATE,
  addReading,
  getLatestReading,
  getReadingHistory,
  getRelayState,
  normalizeReading,
  normalizeBoolean,
  toNumber,
  updateRelayState,
}