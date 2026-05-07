function errorHandler(error, _req, res, _next) {
  const status = Number(error.status || error.statusCode || 500)

  return res.status(status).json({
    success: false,
    message: error.message || 'Internal server error',
  })
}

module.exports = { errorHandler }