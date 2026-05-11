const { prisma } = require('./lib/prisma')
const { fetchFromExternalApi, mapExternalToReadings } = require('./services/externalApiService')

const INITIAL_RELAY_STATE = {
  relay1: false,
  relay2: false,
}

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

function toDate(value, fallback = new Date()) {
  if (!value) return new Date(fallback)
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsed.getTime()) ? new Date(fallback) : parsed
}

async function getRelayDefaults() {
  const relayState = await prisma.relayState.findFirst({
    orderBy: { createdAt: 'desc' },
  })

  if (relayState) {
    return relayState
  }

  const latestReading = await prisma.pzemReading.findFirst({
    orderBy: { serverTimestamp: 'desc' },
  })

  if (latestReading) {
    return {
      relay1: latestReading.relay1,
      relay2: latestReading.relay2,
    }
  }

  return INITIAL_RELAY_STATE
}

async function normalizeReading(payload = {}, source = 'esp') {
  const relayDefaults = await getRelayDefaults()
  const timestamp = toDate(payload.timestamp || payload.time || new Date())
  const serverTimestamp = toDate(payload.serverTimestamp || new Date())

  return {
    deviceId: payload.deviceId || payload.device_id || payload.sensorId || 'pzem-1',
    timestamp,
    serverTimestamp,
    voltage: toNumber(payload.voltage ?? payload.tegangan ?? payload.v, 0),
    current: toNumber(payload.current ?? payload.arus ?? payload.i, 0),
    frequency: toNumber(payload.frequency ?? payload.frekuesi ?? payload.frekuensi ?? payload.f, 0),
    power: toNumber(payload.power ?? payload.power_w ?? payload.daya ?? payload.p, 0),
    energy: toNumber(payload.energy ?? payload.kwh ?? payload.kWh, 0),
    powerFactor: toNumber(payload.powerFactor ?? payload.pf ?? payload.factor, 0),
    relay1: normalizeBoolean(payload.relay1, relayDefaults.relay1),
    relay2: normalizeBoolean(payload.relay2, relayDefaults.relay2),
    source,
    ok: normalizeBoolean(payload.ok, false),
    raw: payload.raw ?? payload,
  }
}

async function createRelayStateRecord(relay1, relay2, source, raw = null) {
  const normalized1 = normalizeBoolean(relay1, false)
  const normalized2 = normalizeBoolean(relay2, false)
  
  // Get the latest RelayState globally (regardless of source)
  const latestGlobal = await prisma.relayState.findFirst({
    orderBy: { createdAt: 'desc' },
  })
  
  // Only create new record if state actually changed
  if (!latestGlobal || latestGlobal.relay1 !== normalized1 || latestGlobal.relay2 !== normalized2) {
    return prisma.relayState.create({
      data: {
        relay1: normalized1,
        relay2: normalized2,
        source,
        raw,
      },
    })
  }
  
  // State tidak berubah - return existing record tanpa menyimpan
  return latestGlobal
}

async function addReading(payload, source = 'esp') {
  const reading = await normalizeReading(payload, source)

  // Check if reading already exists
  const existing = await prisma.pzemReading.findFirst({
    where: {
      timestamp: reading.timestamp,
      deviceId: reading.deviceId,
      source: reading.source,
    },
  })

  let result
  if (existing) {
    // Update existing
    result = await prisma.pzemReading.update({
      where: { id: existing.id },
      data: {
        voltage: reading.voltage,
        current: reading.current,
        frequency: reading.frequency,
        power: reading.power,
        energy: reading.energy,
        powerFactor: reading.powerFactor,
        relay1: reading.relay1,
        relay2: reading.relay2,
        ok: reading.ok,
        raw: reading.raw,
        serverTimestamp: reading.serverTimestamp,
      },
    })
  } else {
    // Create new
    result = await prisma.pzemReading.create({
      data: reading,
    })
  }

  // Only save relay state for non-external-api sources (esp, server)
  if (source !== 'external-api') {
    await createRelayStateRecord(result.relay1, result.relay2, source, result.raw)
  }

  return result
}

async function syncLatestReading() {
  try {
    const externalData = await fetchFromExternalApi()
    if (externalData && (externalData.pzem1 || externalData.pzem?.pzem1)) {
      const readings = mapExternalToReadings(externalData, 'external-api')
      let latestResult = null

      for (const reading of readings) {
        // Check if reading already exists
        const existing = await prisma.pzemReading.findFirst({
          where: {
            timestamp: reading.timestamp,
            deviceId: reading.deviceId,
            source: reading.source,
          },
        })

        let result
        if (existing) {
          // Update existing
          result = await prisma.pzemReading.update({
            where: { id: existing.id },
            data: {
              voltage: reading.voltage,
              current: reading.current,
              frequency: reading.frequency,
              power: reading.power,
              energy: reading.energy,
              powerFactor: reading.powerFactor,
              relay1: reading.relay1,
              relay2: reading.relay2,
              ok: reading.ok,
              raw: reading.raw,
              serverTimestamp: reading.serverTimestamp,
            },
          })
        } else {
          // Create new
          result = await prisma.pzemReading.create({
            data: reading,
          })
        }

        latestResult = result
      }

      // Save relay state ONCE after all readings processed
      if (readings.length > 0) {
        const lastReading = readings[readings.length - 1]
        await createRelayStateRecord(lastReading.relay1, lastReading.relay2, 'external-api', externalData)
      }

      return latestResult
    }
  } catch (error) {
    console.error('[Store] External API fetch error:', error.message)
  }
  
  return getLatestReading()
}

async function getLatestReading() {
  // Get latest reading for each device separately
  const [pzem1Reading, pzem2Reading] = await Promise.all([
    prisma.pzemReading.findFirst({
      where: { deviceId: 'pzem-1' },
      orderBy: { serverTimestamp: 'desc' },
    }),
    prisma.pzemReading.findFirst({
      where: { deviceId: 'pzem-2' },
      orderBy: { serverTimestamp: 'desc' },
    }),
  ])

  // Get relay state from RelayState table
  const relayState = await prisma.relayState.findFirst({
    orderBy: { createdAt: 'desc' },
  })

  // Use the most recent reading's timestamp
  const mostRecent = [pzem1Reading, pzem2Reading]
    .filter(Boolean)
    .sort((a, b) => new Date(b.serverTimestamp) - new Date(a.serverTimestamp))[0]

  if (!mostRecent) return null

  // Return combined data with definitive relay state from RelayState table
  return {
    ...mostRecent,
    pzem1: pzem1Reading,
    pzem2: pzem2Reading,
    relay1: relayState?.relay1 ?? mostRecent.relay1 ?? false,
    relay2: relayState?.relay2 ?? mostRecent.relay2 ?? false,
  }
}

function getReadingHistory(limit = 24) {
  const safeLimit = Math.max(1, Math.min(toNumber(limit, 24), 500))
  return prisma.pzemReading.findMany({
    take: safeLimit,
    orderBy: { serverTimestamp: 'asc' },
  })
}

async function updateRelayState(nextState = {}, source = 'server') {
  const relay1 = normalizeBoolean(nextState.relay1, false)
  const relay2 = normalizeBoolean(nextState.relay2, false)

  await createRelayStateRecord(relay1, relay2, source, nextState.raw || nextState)

  return getRelayState()
}

async function getRelayState() {
  const latest = await prisma.relayState.findFirst({
    orderBy: { createdAt: 'desc' },
  })

  if (latest) {
    return {
      relay1: latest.relay1,
      relay2: latest.relay2,
      updatedAt: latest.createdAt.toISOString(),
      source: latest.source,
    }
  }

  // Fallback: get relay state from latest readings (check both pzem-1 and pzem-2)
  const [pzem1Reading, pzem2Reading] = await Promise.all([
    prisma.pzemReading.findFirst({
      where: { deviceId: 'pzem-1' },
      orderBy: { serverTimestamp: 'desc' },
    }),
    prisma.pzemReading.findFirst({
      where: { deviceId: 'pzem-2' },
      orderBy: { serverTimestamp: 'desc' },
    }),
  ])

  // Use the most recent reading that has relay state
  const mostRecent = [pzem1Reading, pzem2Reading]
    .filter(Boolean)
    .sort((a, b) => new Date(b.serverTimestamp) - new Date(a.serverTimestamp))[0]

  if (mostRecent) {
    return {
      relay1: mostRecent.relay1,
      relay2: mostRecent.relay2,
      updatedAt: mostRecent.serverTimestamp.toISOString(),
      source: mostRecent.source,
    }
  }

  return {
    ...INITIAL_RELAY_STATE,
    updatedAt: new Date().toISOString(),
    source: 'server',
  }
}

async function addAiInteraction(payload = {}) {
  return prisma.aiInteraction.create({
    data: {
      prompt: payload.prompt || '',
      response: payload.response || '',
      model: payload.model || '',
      provider: payload.provider || 'ollama',
      raw: payload.raw ?? null,
    },
  })
}

module.exports = {
  INITIAL_RELAY_STATE,
  addReading,
  addAiInteraction,
  getLatestReading,
  getReadingHistory,
  getRelayState,
  normalizeReading,
  normalizeBoolean,
  syncLatestReading,
  toNumber,
  updateRelayState,
}