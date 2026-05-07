function pickPrompt(body = {}) {
  return body.prompt || body.message || body.text || body.input || ''
}

async function postAi(req, res, next) {
  try {
    const prompt = pickPrompt(req.body || {})
    if (!prompt) {
      return res.status(400).json({
        success: false,
        message: 'prompt, message, text, or input is required',
      })
    }

    const baseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'
    const model = req.body?.model || process.env.OLLAMA_MODEL || 'llama3.1'
    const payload = {
      model,
      prompt,
      stream: false,
    }

    const response = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    const data = await response.json().catch(() => null)

    if (!response.ok) {
      return res.status(502).json({
        success: false,
        message: 'Ollama request failed',
        error: data || { status: response.status },
      })
    }

    return res.json({
      success: true,
      provider: 'ollama',
      model,
      data: {
        prompt,
        response: data?.response || '',
        raw: data,
      },
    })
  } catch (error) {
    return res.status(503).json({
      success: false,
      message: 'Ollama service unavailable',
      error: error.message,
    })
  }
}

module.exports = {
  postAi,
}