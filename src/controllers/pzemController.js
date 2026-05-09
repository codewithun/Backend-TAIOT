const {
  addReading,
  getLatestReading,
  getReadingHistory,
  toNumber,
} = require('../store')

async function postPzem(req, res, next) {
  try {
    const reading = await addReading(req.body || {}, 'esp')

    return res.status(201).json({
      success: true,
      message: 'PZEM data stored',
      data: reading,
    })
  } catch (error) {
    if (typeof next === 'function') {
      return next(error)
    }
    return res.status(500).json({
      success: false,
      message: 'Failed to store PZEM data',
      error: error.message,
    })
  }
}

async function getLatestPzem(_req, res, next) {
  try {
    const data = await getLatestReading()

    return res.json({
      success: true,
      data,
    })
  } catch (error) {
    if (typeof next === 'function') {
      return next(error)
    }
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch latest PZEM data',
      error: error.message,
    })
  }
}

async function getPzemHistory(req, res, next) {
  try {
    const limit = toNumber(req.query.limit, 24)
    const data = await getReadingHistory(limit)

    return res.json({
      success: true,
      data,
      count: data.length,
      limit: Math.max(1, Math.min(limit, 500)),
    })
  } catch (error) {
    if (typeof next === 'function') {
      return next(error)
    }
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch PZEM history',
      error: error.message,
    })
  }
}

module.exports = {
  getLatestPzem,
  getPzemHistory,
  postPzem,
}