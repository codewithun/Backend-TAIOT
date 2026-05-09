require('dotenv/config')

const { createApp } = require('./src/app')
const { syncLatestReading } = require('./src/store')
const { refreshEnergySummaries, AGGREGATION_INTERVAL } = require('./src/services/energySummaryService')
const { POLL_INTERVAL } = require('./src/services/externalApiService')

const PORT = process.env.PORT || 3000
const pollInterval = Math.max(1000, Number(POLL_INTERVAL) || 10000)
const aggregationInterval = Math.max(60000, Number(AGGREGATION_INTERVAL) || 300000)

const app = createApp()

async function bootstrapJobs() {
	await syncLatestReading()
	await refreshEnergySummaries({ rebuild: true })

	setInterval(() => {
		void syncLatestReading().catch(error => {
			console.error('[Bootstrap] Background PZEM sync failed:', error.message)
		})
	}, pollInterval)

	setInterval(() => {
		void refreshEnergySummaries({ rebuild: false }).catch(error => {
			console.error('[Bootstrap] Background summary refresh failed:', error.message)
		})
	}, aggregationInterval)
}

app.listen(PORT, () => {
	console.log(`TAIOT backend listening on port ${PORT}`)
	void bootstrapJobs().catch(error => {
		console.error('[Bootstrap] Job bootstrap failed:', error.message)
	})
})
