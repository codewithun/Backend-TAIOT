const EXTERNAL_API_BASE = process.env.EXTERNAL_API_BASE || 'https://api.zxnco.my.id'
const POLL_INTERVAL = process.env.POLL_INTERVAL || 10000 // 10 seconds

let lastFetchTime = 0
let lastFetchData = null
let lastError = null

async function fetchFromExternalApi() {
  try {
    const now = Date.now()
    
    // Prevent excessive requests
    if (now - lastFetchTime < 1000) {
      return lastFetchData
    }

    lastFetchTime = now
    const response = await fetch(`${EXTERNAL_API_BASE}/pzem`, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 5000,
    })

    if (!response.ok) {
      throw new Error(`External API returned ${response.status}`)
    }

    const data = await response.json()
    lastFetchData = data
    lastError = null

    return data
  } catch (error) {
    lastError = error
    console.error('[ExternalAPI] Fetch failed:', error.message)
    return lastFetchData // Return last successful data if available
  }
}

function mapExternalToReading(externalData = {}, source = 'external-api') {
  // Handle both formats:
  // Format 1: { pzem1: {...}, pzem2: {...}, relay: {...}, updated_at: ... }
  // Format 2: { pzem: { pzem1: {...}, pzem2: {...}, relay: {...}, updated_at: ... }, relay: {...}, status: ... }
  
  const pzem1 = externalData.pzem1 || (externalData.pzem?.pzem1) || {}
  const relayData = externalData.relay || (externalData.pzem?.relay) || {}
  const timestamp = (externalData.updated_at || externalData.pzem?.updated_at)
    ? new Date((externalData.updated_at || externalData.pzem?.updated_at) * 1000).toISOString()
    : new Date().toISOString()

  return {
    id: `pzem_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    deviceId: 'pzem-1',
    timestamp,
    serverTimestamp: new Date().toISOString(),
    voltage: 220, // Default voltage since external API doesn't provide it
    current: Number(pzem1.current ?? 0) || 0,
    frequency: Number(pzem1.frequency ?? 0) || 0,
    power: Number(pzem1.power ?? 0) || 0,
    energy: Number(pzem1.energy ?? 0) || 0,
    powerFactor: Number(pzem1.pf ?? 0) || 0,
    relay1: normalizeBoolean(relayData.relay1, false),
    relay2: normalizeBoolean(relayData.relay2, false),
    source,
    raw: externalData,
    ok: pzem1.ok === true || pzem1.ok === 1 || pzem1.ok === 'true',
  }
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1' || value === 'true' || value === 'on') return true
  if (value === 0 || value === '0' || value === 'false' || value === 'off') return false
  return fallback
}

function mapPzemBlockToReading(pzem = {}, deviceId = 'pzem-1', externalData = {}, source = 'external-api') {
  const relayData = externalData.relay || (externalData.pzem?.relay) || {}
  const timestamp = (externalData.updated_at || externalData.pzem?.updated_at)
    ? new Date((externalData.updated_at || externalData.pzem?.updated_at) * 1000).toISOString()
    : new Date().toISOString()

  return {
    id: `pzem_${deviceId}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    deviceId,
    timestamp,
    serverTimestamp: new Date().toISOString(),
    voltage: 220,
    current: Number(pzem.current ?? 0) || 0,
    frequency: Number(pzem.frequency ?? 0) || 0,
    power: Number(pzem.power ?? 0) || 0,
    energy: Number(pzem.energy ?? 0) || 0,
    powerFactor: Number(pzem.pf ?? 0) || 0,
    relay1: normalizeBoolean(relayData.relay1, false),
    relay2: normalizeBoolean(relayData.relay2, false),
    source,
    raw: externalData,
    ok: pzem.ok === true || pzem.ok === 1 || pzem.ok === 'true',
  }
}

async function sendRelayControl(relayPayload = {}) {
  const response = await fetch(`${EXTERNAL_API_BASE}/relay-control`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(relayPayload),
  })

  if (!response.ok) {
    throw new Error(`External relay-control returned ${response.status}`)
  }

  return response.json()
}

function getLastError() {
  return lastError
}

function mapExternalToReadings(externalData = {}, source = 'external-api') {
  const pzemRoot = externalData.pzem && typeof externalData.pzem === 'object' ? externalData.pzem : externalData
  const readings = []

  if (pzemRoot.pzem1) {
    readings.push(mapPzemBlockToReading(pzemRoot.pzem1, 'pzem-1', externalData, source))
  }

  if (pzemRoot.pzem2) {
    readings.push(mapPzemBlockToReading(pzemRoot.pzem2, 'pzem-2', externalData, source))
  }

  return readings
}

module.exports = {
  EXTERNAL_API_BASE,
  POLL_INTERVAL,
  fetchFromExternalApi,
  mapPzemBlockToReading,
  mapExternalToReadings,
  sendRelayControl,
  getLastError,
}
