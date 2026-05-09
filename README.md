# Backend-TAIOT

REST API backend untuk sistem monitoring energi listrik dengan integrasi ke external API, Ollama AI, dan PostgreSQL via Prisma.

## Setup

```bash
npm install
npm run dev        # Development dengan nodemon
npm start          # Production
```

## Konfigurasi

Copy `.env.example` ke `.env.local` dan sesuaikan:

```env
DATABASE_URL=postgresql://postgres@localhost:5432/taiot
# Aggregation Configuration
AGGREGATION_INTERVAL=300000
RAW_RETENTION_DAYS=30
TARIFF_PER_KWH=1444
EXTERNAL_API_BASE=https://api.zxnco.my.id
POLL_INTERVAL=10000
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.1
PORT=3000
```

## API Endpoints

### PZEM (Power Monitoring)

- **GET /pzem/latest** - Data PZEM terbaru dari external API
  - Response: `{ success, data: { voltage, current, frequency, power, energy, powerFactor, relay1, relay2, ... } }`

- **GET /pzem/history?limit=24** - Riwayat data PZEM (maks 500)
  - Response: `{ success, data: [...], count, limit }`

- **POST /pzem** - Simpan data PZEM dari ESP (fallback jika external API tidak tersedia)
  - Body: `{ voltage, current, frequency, power, energy, powerFactor, ... }`
  - Response: `{ success, message, data }`

- **GET /summary** - Snapshot summary energi saat ini
  - Response: `{ success, data: { daily, weekly, monthly } }`

### Relay Control

- **GET /relay-state** - Status relai dari external API
  - Response: `{ success, state: { relay1, relay2, updatedAt, source }, relay1, relay2 }`

- **POST /relay-control** - Update status relai
  - Body: `{ relay1: true/false, relay2: true/false }`
  - Response: `{ success, message, state, relay1, relay2 }`

### AI (Ollama)

- **POST /ai** - Chat dengan Ollama AI
  - Body: `{ prompt: "...", message: "...", text: "..." }`
  - Response: `{ success, provider, model, data: { prompt, response, raw } }`
  - Note: Returns 503 jika Ollama service tidak tersedia

### Health

- **GET /health** - Status backend
  - Response: `{ success, message, timestamp }`

## External API Integration

Backend secara otomatis mengambil data dari **https://api.zxnco.my.id/pzem**:

### Format External API

```json
{
  "pzem": {
    "pzem1": {
      "current": 7.5,
      "energy": 18.4,
      "frequency": 50.0,
      "ok": true,
      "pf": 0.97,
      "power": 1650
    },
    "pzem2": { ... },
    "relay": { "relay1": true, "relay2": false },
    "updated_at": 1778159963
  },
  "relay": { "relay1": true, "relay2": false },
  "status": "Server AI OK"
}
```

### Mapping Internal

- `pzem.pzem1.*` → PZEM data utama
- `pzem.relay` → Status relai (relay1, relay2)
- `updated_at` → Timestamp
- `voltage` → Default 220V (tidak ada di external API)

### Cache & Fallback

- Data di-cache untuk menghindari rate limiting
- Jika external API gagal, gunakan data terakhir yang tersimpan di database
- Tidak ada lagi seed demo data untuk penyimpanan API
- Raw PZEM lama dipangkas sesuai `RAW_RETENTION_DAYS`
- Summary harian, mingguan, dan bulanan dihitung otomatis oleh job background

## Folder Structure

```
src/
├── app.js                 # Express setup & middleware
├── store.js              # Data storage & normalization
├── server.js             # Entry point
├── controllers/
│   ├── pzemController.js
│   ├── relayController.js
│   └── aiController.js
├── middlewares/
│   ├── errorHandler.js
│   └── notFound.js
├── routes/
│   └── index.js
└── services/
    └── externalApiService.js  # External API integration
```

## Frontend Integration

Frontend di [../frontend-TAIOT](../frontend-TAIOT) sudah dikonfigurasi untuk connect ke backend:

```env
# frontend-TAIOT/.env.local
VITE_API_BASE=http://127.0.0.1:3000
```

## Performa

- Request timeout: 5 detik
- Cache request: 1 detik (prevent excessive calls)
- History limit: 500 entries
- Default PZEM yang valid: 24 entries
