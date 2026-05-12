const { prisma } = require('./lib/prisma')
const { fetchFromExternalApi, mapExternalToReadings } = require('./services/externalApiService')

const INITIAL_RELAY_STATE = {
  relay1: false,
  relay2: false,
  relays: [
    { key: 'relay1', label: 'Relay 1', state: false },
    { key: 'relay2', label: 'Relay 2', state: false },
  ],
  relayMap: {
    relay1: false,
    relay2: false,
  },
}

const DEFAULT_RELAY_DEVICES = [
  {
    relayKey: 'relay1',
    nama: 'Relay 1',
    description: 'Relay Control 1',
    warna: '#22d3ee',
    status: false,
    isBuiltin: true,
    sortOrder: 1,
  },
  {
    relayKey: 'relay2',
    nama: 'Relay 2',
    description: 'Relay Control 2',
    warna: '#4ade80',
    status: false,
    isBuiltin: true,
    sortOrder: 2,
  },
]

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

function slugifyRelayKey(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'relay'
}

function relayDeviceToResponse(device = {}) {
  return {
    id: device.id,
    relayKey: device.relayKey,
    nama: device.nama,
    description: device.description || '',
    warna: device.warna || '#a78bfa',
    status: device.status ? 'aktif' : 'nonaktif',
    isBuiltin: Boolean(device.isBuiltin),
    sortOrder: device.sortOrder || 0,
    createdAt: device.createdAt?.toISOString?.() || device.createdAt || null,
    updatedAt: device.updatedAt?.toISOString?.() || device.updatedAt || null,
  }
}

function normalizeRelayDeviceInput(input = {}, fallbackKey = null) {
  const relayKey = String(input.relayKey || fallbackKey || '').trim() || null
  const nama = String(input.nama || input.name || '').trim()
  const description = String(input.description || '').trim()
  const warna = String(input.warna || input.color || '#a78bfa').trim() || '#a78bfa'

  return {
    relayKey,
    nama,
    description,
    warna,
    status: normalizeBoolean(input.status ?? input.isActive ?? input.active, false),
    isBuiltin: normalizeBoolean(input.isBuiltin, false),
    sortOrder: toNumber(input.sortOrder, 0),
  }
}

function relayStateSignature(relay1, relay2, raw = null) {
  const relays = Array.isArray(raw?.relays) ? raw.relays : []
  const relayMap = raw?.relayMap && typeof raw.relayMap === 'object' ? raw.relayMap : null

  const signatureRelays = relays.length
    ? relays.map((entry, index) => {
      const normalized = normalizeRelayEntry(entry, index)
      return {
        key: normalized.key,
        state: normalizeBoolean(normalized.state, false),
      }
    })
    : relayMap
      ? Object.entries(relayMap).map(([key, value]) => ({
        key: String(key),
        state: normalizeBoolean(value, false),
      }))
      : []

  signatureRelays.sort((left, right) => String(left.key).localeCompare(String(right.key)))

  return JSON.stringify({
    relay1: normalizeBoolean(relay1, false),
    relay2: normalizeBoolean(relay2, false),
    relays: signatureRelays,
  })
}

function normalizeRelayEntry(entry = {}, index = 0) {
  if (entry && typeof entry !== 'object') {
    return {
      key: `relay${index + 1}`,
      label: `Relay ${index + 1}`,
      state: normalizeBoolean(entry, false),
      raw: entry,
    }
  }

  const key = String(entry.key || entry.id || entry.relayKey || `relay${index + 1}`)
  const label = entry.label || entry.name || key
  const state = normalizeBoolean(
    entry.state ?? entry.value ?? entry.active ?? entry.on ?? entry.enabled,
    false,
  )

  return {
    key,
    label,
    state,
    raw: entry,
  }
}

function isRelayKey(key) {
  return /^relay/i.test(String(key || ''))
}

function extractRelayEntries(input = {}) {
  if (Array.isArray(input.relays)) {
    return input.relays.map((entry, index) => normalizeRelayEntry(entry, index))
  }

  if (input.relayMap && typeof input.relayMap === 'object' && !Array.isArray(input.relayMap)) {
    return Object.entries(input.relayMap).map(([key, value], index) => normalizeRelayEntry({ key, state: value }, index))
  }

  return Object.entries(input)
    .filter(([key]) => isRelayKey(key) && key !== 'relays' && key !== 'relayMap')
    .map(([key, value], index) => {
      if (value && typeof value === 'object') {
        return normalizeRelayEntry({ key, ...value }, index)
      }

      return normalizeRelayEntry({ key, state: value }, index)
    })
}

function sortRelayEntries(entries = []) {
  return [...entries].sort((left, right) => {
    const leftMatch = String(left.key).match(/^(.*?)(\d+)$/)
    const rightMatch = String(right.key).match(/^(.*?)(\d+)$/)

    if (leftMatch && rightMatch && leftMatch[1] === rightMatch[1]) {
      return Number(leftMatch[2]) - Number(rightMatch[2])
    }

    return String(left.key).localeCompare(String(right.key))
  })
}

async function ensureDefaultRelayDevices() {
  for (const device of DEFAULT_RELAY_DEVICES) {
    await prisma.relayDevice.upsert({
      where: { relayKey: device.relayKey },
      update: {
        nama: device.nama,
        description: device.description,
        warna: device.warna,
        isBuiltin: true,
        sortOrder: device.sortOrder,
      },
      create: {
        relayKey: device.relayKey,
        nama: device.nama,
        description: device.description,
        warna: device.warna,
        status: device.status,
        isBuiltin: true,
        sortOrder: device.sortOrder,
      },
    })
  }
}

async function getRelayDevices() {
  await ensureDefaultRelayDevices()

  const devices = await prisma.relayDevice.findMany({
    orderBy: [
      { sortOrder: 'asc' },
      { createdAt: 'asc' },
    ],
  })

  return devices.map(relayDeviceToResponse)
}

async function createRelayDevice(input = {}) {
  await ensureDefaultRelayDevices()

  const normalized = normalizeRelayDeviceInput(input)
  if (!normalized.nama) {
    const error = new Error('Nama relay harus diisi')
    error.status = 400
    throw error
  }

  let relayKey = normalized.relayKey || slugifyRelayKey(normalized.nama)
  if (!relayKey) relayKey = 'relay'

  const existing = await prisma.relayDevice.findFirst({
    where: { relayKey },
  })

  if (existing) {
    const error = new Error(`Relay key "${relayKey}" sudah digunakan`)
    error.status = 409
    throw error
  }

  const lastDevice = await prisma.relayDevice.findFirst({
    orderBy: [
      { sortOrder: 'desc' },
      { createdAt: 'desc' },
    ],
  })

  const created = await prisma.relayDevice.create({
    data: {
      relayKey,
      nama: normalized.nama,
      description: normalized.description || `Relay Control ${relayKey}`,
      warna: normalized.warna,
      status: normalizeBoolean(normalized.status, false),
      isBuiltin: false,
      sortOrder: normalized.sortOrder > 0 ? normalized.sortOrder : (lastDevice?.sortOrder || 0) + 1,
    },
  })

  return relayDeviceToResponse(created)
}

async function updateRelayDevice(id, input = {}) {
  await ensureDefaultRelayDevices()

  const existing = await prisma.relayDevice.findUnique({
    where: { id },
  })

  if (!existing) {
    const error = new Error('Relay device tidak ditemukan')
    error.status = 404
    throw error
  }

  const normalized = normalizeRelayDeviceInput(input, existing.relayKey)
  const updated = await prisma.relayDevice.update({
    where: { id },
    data: {
      nama: normalized.nama || existing.nama,
      description: normalized.description || existing.description,
      warna: normalized.warna || existing.warna,
      status: input.status === undefined && input.isActive === undefined && input.active === undefined
        ? existing.status
        : normalizeBoolean(input.status ?? input.isActive ?? input.active, existing.status),
      sortOrder: normalized.sortOrder > 0 ? normalized.sortOrder : existing.sortOrder,
    },
  })

  return relayDeviceToResponse(updated)
}

async function deleteRelayDevice(id) {
  await ensureDefaultRelayDevices()

  const existing = await prisma.relayDevice.findUnique({
    where: { id },
  })

  if (!existing) {
    const error = new Error('Relay device tidak ditemukan')
    error.status = 404
    throw error
  }

  if (existing.isBuiltin) {
    const error = new Error('Relay bawaan tidak bisa dihapus')
    error.status = 400
    throw error
  }

  await prisma.relayDevice.delete({
    where: { id },
  })

  return relayDeviceToResponse(existing)
}

async function syncRelayDeviceState(relayKey, status) {
  await ensureDefaultRelayDevices()

  const existing = await prisma.relayDevice.findUnique({
    where: { relayKey },
  })

  if (!existing) return null

  const updated = await prisma.relayDevice.update({
    where: { relayKey },
    data: { status: normalizeBoolean(status, false) },
  })

  return relayDeviceToResponse(updated)
}

function buildRelayStateSnapshot(input = {}, fallback = INITIAL_RELAY_STATE) {
  const fallbackEntries = Array.isArray(fallback.relays)
    ? fallback.relays.map((entry, index) => normalizeRelayEntry(entry, index))
    : extractRelayEntries(fallback)

  const relayEntries = extractRelayEntries(input)
  const relayMap = {
    ...Object.fromEntries(fallbackEntries.map(entry => [entry.key, entry.state])),
  }

  for (const entry of relayEntries) {
    relayMap[entry.key] = entry.state
  }

  const orderedEntries = sortRelayEntries([
    ...fallbackEntries.map(entry => ({ ...entry, state: relayMap[entry.key] ?? entry.state })),
    ...relayEntries.filter(entry => !fallbackEntries.some(existing => existing.key === entry.key)),
  ].map(entry => ({
    ...entry,
    state: relayMap[entry.key] ?? entry.state,
  })))

  const relay1 = normalizeBoolean(relayMap.relay1, fallback.relay1 ?? false)
  const relay2 = normalizeBoolean(relayMap.relay2, fallback.relay2 ?? false)

  return {
    relay1,
    relay2,
    relays: orderedEntries.map(entry => ({
      key: entry.key,
      label: entry.label,
      state: normalizeBoolean(relayMap[entry.key], entry.state),
      raw: entry.raw ?? null,
    })),
    relayMap: Object.fromEntries(
      orderedEntries.map(entry => [entry.key, normalizeBoolean(relayMap[entry.key], entry.state)]),
    ),
    raw: input.raw ?? input,
  }
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
  const nextSignature = relayStateSignature(normalized1, normalized2, raw)
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

  const latestSignature = latestGlobal
    ? relayStateSignature(latestGlobal.relay1, latestGlobal.relay2, latestGlobal.raw)
    : null

  if (!latestSignature || latestSignature !== nextSignature) {
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
  const snapshot = buildRelayStateSnapshot(nextState, await getRelayState())

  await createRelayStateRecord(snapshot.relay1, snapshot.relay2, source, {
    ...snapshot.raw,
    relays: snapshot.relays,
    relayMap: snapshot.relayMap,
  })

  return getRelayState()
}

async function getRelayState() {
  const latest = await prisma.relayState.findFirst({
    orderBy: { createdAt: 'desc' },
  })

  const relayDevices = await getRelayDevices()
  const relayMap = Object.fromEntries(
    relayDevices.map(device => [device.relayKey, normalizeBoolean(device.status === 'aktif', false)]),
  )

  if (latest) {
    const rawRelays = Array.isArray(latest.raw?.relays) ? latest.raw.relays : null
    const relaySnapshot = rawRelays || relayDevices.map(device => ({
      key: device.relayKey,
      label: device.nama,
      state: device.status === 'aktif',
    }))

    relayMap.relay1 = latest.relay1 ?? relayMap.relay1 ?? false
    relayMap.relay2 = latest.relay2 ?? relayMap.relay2 ?? false

    return {
      relay1: relayMap.relay1,
      relay2: relayMap.relay2,
      updatedAt: latest.createdAt.toISOString(),
      source: latest.source,
      relays: sortRelayEntries(relaySnapshot.map((entry, index) => normalizeRelayEntry(entry, index))).map(entry => ({
        key: entry.key,
        label: entry.label,
        state: normalizeBoolean(entry.state, false),
      })),
      relayMap,
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
      relay1: relayMap.relay1 ?? mostRecent.relay1,
      relay2: relayMap.relay2 ?? mostRecent.relay2,
      updatedAt: mostRecent.serverTimestamp.toISOString(),
      source: mostRecent.source,
      relays: relayDevices.map(device => ({
        key: device.relayKey,
        label: device.nama,
        state: device.status === 'aktif',
      })),
      relayMap,
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
  createRelayDevice,
  deleteRelayDevice,
  getLatestReading,
  getReadingHistory,
  getRelayDevices,
  getRelayState,
  normalizeReading,
  normalizeBoolean,
  buildRelayStateSnapshot,
  relayDeviceToResponse,
  ensureDefaultRelayDevices,
  syncRelayDeviceState,
  updateRelayDevice,
  syncLatestReading,
  toNumber,
  updateRelayState,
}