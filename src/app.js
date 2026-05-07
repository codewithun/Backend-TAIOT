const express = require('express')

const { apiRouter } = require('./routes')
const { notFound } = require('./middlewares/notFound')
const { errorHandler } = require('./middlewares/errorHandler')

function createApp() {
	const app = express()

	app.disable('x-powered-by')
	app.use(express.json({ limit: '1mb' }))
	app.use(express.urlencoded({ extended: true }))

	app.use((req, res, next) => {
		res.setHeader('Access-Control-Allow-Origin', '*')
		res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
		res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
		if (req.method === 'OPTIONS') {
			return res.status(204).end()
		}
		return next()
	})

	app.get('/health', (_req, res) => {
		res.json({ success: true, message: 'TAIOT backend is healthy', timestamp: new Date().toISOString() })
	})

	app.use(apiRouter)
	app.use(notFound)
	app.use(errorHandler)

	return app
}

module.exports = { createApp }
