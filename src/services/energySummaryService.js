const { prisma } = require('../lib/prisma')

const TARIF_PER_KWH = Number(process.env.TARIFF_PER_KWH || 1444)
const AGGREGATION_INTERVAL = Math.max(60000, Number(process.env.AGGREGATION_INTERVAL || 300000))
const RAW_RETENTION_DAYS = Math.max(1, Number(process.env.RAW_RETENTION_DAYS || 30))

let summaryJobRunning = false

function toDate(value) {
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

function cloneDate(value) {
  return new Date(toDate(value).getTime())
}

function startOfDay(date) {
  const next = cloneDate(date)
  next.setHours(0, 0, 0, 0)
  return next
}

function startOfWeek(date) {
  const next = startOfDay(date)
  const currentDay = next.getDay()
  const distanceFromMonday = (currentDay + 6) % 7
  next.setDate(next.getDate() - distanceFromMonday)
  return next
}

function startOfMonth(date) {
  const next = startOfDay(date)
  next.setDate(1)
  return next
}

function addDays(date, amount) {
  const next = cloneDate(date)
  next.setDate(next.getDate() + amount)
  return next
}

function addWeeks(date, amount) {
  return addDays(date, amount * 7)
}

function addMonths(date, amount) {
  const next = cloneDate(date)
  next.setMonth(next.getMonth() + amount)
  return next
}

function isSameDay(left, right) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
}

function isSameMonth(left, right) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
}

function formatLocalDateKey(date) {
  const next = toDate(date)
  const year = next.getFullYear()
  const month = String(next.getMonth() + 1).padStart(2, '0')
  const day = String(next.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatLocalMonthKey(date) {
  const next = toDate(date)
  const year = next.getFullYear()
  const month = String(next.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

function formatLocalWeekKey(date) {
  return formatLocalDateKey(startOfWeek(date))
}

function hoursBetween(left, right) {
  return Math.max((toDate(right).getTime() - toDate(left).getTime()) / 36e5, 0)
}

function mean(values) {
  const numericValues = values.filter(value => Number.isFinite(Number(value))).map(Number)
  if (!numericValues.length) return 0
  return numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length
}

function sum(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0)
}

function calculateEnergySummary(readings, periodStart, periodEnd, tariffPerKwh = TARIF_PER_KWH) {
  const periodStartDate = toDate(periodStart)
  const periodEndDate = toDate(periodEnd)
  const sortedReadings = [...readings]
    .map(reading => ({
      timestamp: toDate(reading.timestamp || reading.serverTimestamp),
      power: Number(reading.power) || 0,
      voltage: Number(reading.voltage) || 0,
      current: Number(reading.current) || 0,
      frequency: Number(reading.frequency) || 0,
      powerFactor: Number(reading.powerFactor) || 0,
    }))
    .sort((left, right) => left.timestamp - right.timestamp)

  const durationHours = hoursBetween(periodStartDate, periodEndDate)

  if (sortedReadings.length === 0 || durationHours === 0) {
    return {
      readingCount: sortedReadings.length,
      durationHours,
      consumptionKwh: 0,
      estimatedCost: 0,
      averagePower: 0,
      averageVoltage: 0,
      averageCurrent: 0,
      averageFrequency: 0,
      averagePowerFactor: 0,
      tariffPerKwh,
    }
  }

  let energyWh = 0
  const firstReading = sortedReadings[0]
  const lastReading = sortedReadings[sortedReadings.length - 1]

  energyWh += firstReading.power * hoursBetween(periodStartDate, firstReading.timestamp)

  for (let index = 1; index < sortedReadings.length; index += 1) {
    const previous = sortedReadings[index - 1]
    const current = sortedReadings[index]
    const intervalHours = hoursBetween(previous.timestamp, current.timestamp)
    energyWh += ((previous.power + current.power) / 2) * intervalHours
  }

  energyWh += lastReading.power * hoursBetween(lastReading.timestamp, periodEndDate)

  const consumptionKwh = energyWh / 1000

  return {
    readingCount: sortedReadings.length,
    durationHours,
    consumptionKwh,
    estimatedCost: consumptionKwh * tariffPerKwh,
    averagePower: durationHours > 0 ? energyWh / durationHours : 0,
    averageVoltage: mean(sortedReadings.map(item => item.voltage)),
    averageCurrent: mean(sortedReadings.map(item => item.current)),
    averageFrequency: mean(sortedReadings.map(item => item.frequency)),
    averagePowerFactor: mean(sortedReadings.map(item => item.powerFactor)),
    tariffPerKwh,
  }
}

function aggregateSummaryRows(rows, periodStart, periodEnd, tariffPerKwh = TARIF_PER_KWH) {
  const safeRows = rows
    .map(row => ({
      durationHours: Number(row.durationHours) || 0,
      consumptionKwh: Number(row.consumptionKwh) || 0,
      estimatedCost: Number(row.estimatedCost) || 0,
      averagePower: Number(row.averagePower) || 0,
      averageVoltage: Number(row.averageVoltage) || 0,
      averageCurrent: Number(row.averageCurrent) || 0,
      averageFrequency: Number(row.averageFrequency) || 0,
      averagePowerFactor: Number(row.averagePowerFactor) || 0,
      readingCount: Number(row.readingCount) || 0,
    }))

  const totalDurationHours = sum(safeRows.map(row => row.durationHours))
  const totalReadingCount = sum(safeRows.map(row => row.readingCount))
  const totalConsumptionKwh = sum(safeRows.map(row => row.consumptionKwh))

  if (!safeRows.length) {
    return {
      readingCount: 0,
      durationHours: hoursBetween(periodStart, periodEnd),
      consumptionKwh: 0,
      estimatedCost: 0,
      averagePower: 0,
      averageVoltage: 0,
      averageCurrent: 0,
      averageFrequency: 0,
      averagePowerFactor: 0,
      tariffPerKwh,
    }
  }

  const weightedAverage = field => {
    const weightedSum = safeRows.reduce((total, row) => total + (row[field] * (row.durationHours || 0)), 0)
    return totalDurationHours > 0 ? weightedSum / totalDurationHours : 0
  }

  return {
    readingCount: totalReadingCount,
    durationHours: totalDurationHours,
    consumptionKwh: totalConsumptionKwh,
    estimatedCost: totalConsumptionKwh * tariffPerKwh,
    averagePower: weightedAverage('averagePower'),
    averageVoltage: weightedAverage('averageVoltage'),
    averageCurrent: weightedAverage('averageCurrent'),
    averageFrequency: weightedAverage('averageFrequency'),
    averagePowerFactor: weightedAverage('averagePowerFactor'),
    tariffPerKwh,
  }
}

function buildDailyWindows(startDate, endDate) {
  const windows = []
  let cursor = startOfDay(startDate)
  const finalDay = startOfDay(endDate)

  while (cursor <= finalDay) {
    const periodStart = cloneDate(cursor)
    const periodEnd = isSameDay(cursor, finalDay) ? cloneDate(endDate) : addDays(cursor, 1)

    windows.push({
      periodKey: formatLocalDateKey(periodStart),
      periodStart,
      periodEnd,
    })

    cursor = addDays(cursor, 1)
  }

  return windows
}

function buildWeeklyWindows(startDate, endDate) {
  const windows = []
  let cursor = startOfWeek(startDate)
  const finalWeek = startOfWeek(endDate)

  while (cursor <= finalWeek) {
    const periodStart = cloneDate(cursor)
    const periodEnd = isSameDay(cursor, finalWeek) ? cloneDate(endDate) : addWeeks(cursor, 1)

    windows.push({
      periodKey: formatLocalWeekKey(periodStart),
      periodStart,
      periodEnd,
    })

    cursor = addWeeks(cursor, 1)
  }

  return windows
}

function buildMonthlyWindows(startDate, endDate) {
  const windows = []
  let cursor = startOfMonth(startDate)
  const finalMonth = startOfMonth(endDate)

  while (cursor <= finalMonth) {
    const periodStart = cloneDate(cursor)
    const periodEnd = isSameMonth(cursor, finalMonth) ? cloneDate(endDate) : addMonths(cursor, 1)

    windows.push({
      periodKey: formatLocalMonthKey(periodStart),
      periodStart,
      periodEnd,
    })

    cursor = addMonths(cursor, 1)
  }

  return windows
}

function uniqueStartDate(values) {
  return values
    .filter(Boolean)
    .map(toDate)
    .sort((left, right) => left - right)[0]
}

async function upsertWindowSummaries(modelName, windows, sourceRows, calculator) {
  const results = []

  for (const window of windows) {
    const rows = sourceRows.filter(row => {
      const timestamp = toDate(row.timestamp || row.serverTimestamp)
      return timestamp >= window.periodStart && timestamp < window.periodEnd
    })

    const summary = calculator(rows, window.periodStart, window.periodEnd)

    const created = await prisma[modelName].upsert({
      where: { periodKey: window.periodKey },
      update: {
        periodStart: window.periodStart,
        periodEnd: window.periodEnd,
        durationHours: summary.durationHours,
        readingCount: summary.readingCount,
        consumptionKwh: summary.consumptionKwh,
        estimatedCost: summary.estimatedCost,
        averagePower: summary.averagePower,
        averageVoltage: summary.averageVoltage,
        averageCurrent: summary.averageCurrent,
        averageFrequency: summary.averageFrequency,
        averagePowerFactor: summary.averagePowerFactor,
        tariffPerKwh: summary.tariffPerKwh,
        source: 'aggregation',
      },
      create: {
        periodKey: window.periodKey,
        periodStart: window.periodStart,
        periodEnd: window.periodEnd,
        durationHours: summary.durationHours,
        readingCount: summary.readingCount,
        consumptionKwh: summary.consumptionKwh,
        estimatedCost: summary.estimatedCost,
        averagePower: summary.averagePower,
        averageVoltage: summary.averageVoltage,
        averageCurrent: summary.averageCurrent,
        averageFrequency: summary.averageFrequency,
        averagePowerFactor: summary.averagePowerFactor,
        tariffPerKwh: summary.tariffPerKwh,
        source: 'aggregation',
      },
    })

    results.push(created)
  }

  return results
}

async function refreshDailySummaries({ rebuild = false } = {}) {
  const now = new Date()
  const start = rebuild
    ? await prisma.pzemReading.findFirst({ orderBy: { timestamp: 'asc' } }).then(item => item?.timestamp)
    : startOfDay(now)

  if (!start) {
    return []
  }

  const windows = rebuild ? buildDailyWindows(start, now) : [{
    periodKey: formatLocalDateKey(startOfDay(now)),
    periodStart: startOfDay(now),
    periodEnd: now,
  }]

  const rawReadings = await prisma.pzemReading.findMany({
    where: {
      timestamp: {
        gte: windows[0].periodStart,
        lte: now,
      },
    },
    orderBy: { timestamp: 'asc' },
  })

  return upsertWindowSummaries('dailySummary', windows, rawReadings, calculateEnergySummary)
}

async function refreshWeeklySummaries({ rebuild = false } = {}) {
  const now = new Date()
  const start = rebuild
    ? uniqueStartDate([
      await prisma.dailySummary.findFirst({ orderBy: { periodStart: 'asc' } }).then(item => item?.periodStart),
    ])
    : startOfWeek(now)

  if (!start) {
    return []
  }

  const windows = rebuild ? buildWeeklyWindows(start, now) : [{
    periodKey: formatLocalWeekKey(startOfWeek(now)),
    periodStart: startOfWeek(now),
    periodEnd: now,
  }]

  const dailySummaries = await prisma.dailySummary.findMany({
    where: {
      periodStart: {
        gte: windows[0].periodStart,
        lte: now,
      },
    },
    orderBy: { periodStart: 'asc' },
  })

  return upsertWindowSummaries('weeklySummary', windows, dailySummaries, aggregateSummaryRows)
}

async function refreshMonthlySummaries({ rebuild = false } = {}) {
  const now = new Date()
  const start = rebuild
    ? uniqueStartDate([
      await prisma.dailySummary.findFirst({ orderBy: { periodStart: 'asc' } }).then(item => item?.periodStart),
    ])
    : startOfMonth(now)

  if (!start) {
    return []
  }

  const windows = rebuild ? buildMonthlyWindows(start, now) : [{
    periodKey: formatLocalMonthKey(startOfMonth(now)),
    periodStart: startOfMonth(now),
    periodEnd: now,
  }]

  const dailySummaries = await prisma.dailySummary.findMany({
    where: {
      periodStart: {
        gte: windows[0].periodStart,
        lte: now,
      },
    },
    orderBy: { periodStart: 'asc' },
  })

  return upsertWindowSummaries('monthlySummary', windows, dailySummaries, aggregateSummaryRows)
}

async function cleanupOldReadings() {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - RAW_RETENTION_DAYS)

  return prisma.pzemReading.deleteMany({
    where: {
      timestamp: {
        lt: cutoff,
      },
    },
  })
}

async function refreshEnergySummaries({ rebuild = false } = {}) {
  if (summaryJobRunning) {
    return null
  }

  summaryJobRunning = true

  try {
    const daily = await refreshDailySummaries({ rebuild })
    const weekly = await refreshWeeklySummaries({ rebuild })
    const monthly = await refreshMonthlySummaries({ rebuild })
    await cleanupOldReadings()

    return { daily, weekly, monthly }
  } finally {
    summaryJobRunning = false
  }
}

async function getSummarySnapshot() {
  const now = new Date()
  const dailyKey = formatLocalDateKey(startOfDay(now))
  const weeklyKey = formatLocalWeekKey(startOfWeek(now))
  const monthlyKey = formatLocalMonthKey(startOfMonth(now))

  const [daily, weekly, monthly] = await Promise.all([
    prisma.dailySummary.findUnique({ where: { periodKey: dailyKey } }),
    prisma.weeklySummary.findUnique({ where: { periodKey: weeklyKey } }),
    prisma.monthlySummary.findUnique({ where: { periodKey: monthlyKey } }),
  ])

  return {
    daily,
    weekly,
    monthly,
  }
}

module.exports = {
  AGGREGATION_INTERVAL,
  RAW_RETENTION_DAYS,
  TARIF_PER_KWH,
  addDays,
  addMonths,
  addWeeks,
  aggregateSummaryRows,
  buildDailyWindows,
  buildMonthlyWindows,
  buildWeeklyWindows,
  calculateEnergySummary,
  cleanupOldReadings,
  formatLocalDateKey,
  formatLocalMonthKey,
  formatLocalWeekKey,
  getSummarySnapshot,
  refreshDailySummaries,
  refreshEnergySummaries,
  refreshMonthlySummaries,
  refreshWeeklySummaries,
  startOfDay,
  startOfMonth,
  startOfWeek,
}