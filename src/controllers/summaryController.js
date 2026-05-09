const { getSummarySnapshot } = require('../services/energySummaryService')

async function getSummarySnapshotHandler(_req, res, next) {
  try {
    const data = await getSummarySnapshot()

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
      message: 'Failed to fetch energy summaries',
      error: error.message,
    })
  }
}

module.exports = {
  getSummarySnapshotHandler,
}