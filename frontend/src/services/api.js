const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

async function req(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, opts)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || res.statusText)
  }
  return res.json()
}

const api = {
  upload: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return req('/upload', { method: 'POST', body: fd })
  },

  getStatus: () => req('/status'),
  getFileStatus: (id) => req(`/status/${id}`),

  scrape: (url) =>
    req('/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    }),

  analyse: (prompt, fileIds = []) =>
    req('/analyse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, file_ids: fileIds }),
    }),

  query: (prompt, fileIds = [], slmId = null) =>
    req('/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, file_ids: fileIds, slm_id: slmId }),
    }),

  getGraph: (fileIds = []) => {
    const qs = fileIds.length ? `?file_ids=${fileIds.join(',')}` : ''
    return req(`/graph${qs}`)
  },

  finalRun: (prompt, slmId, model, fileIds = []) =>
    req('/final-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, slm_id: slmId, model, file_ids: fileIds }),
    }),

  retryFile: (fileId) =>
    req(`/retry/${fileId}`, { method: 'POST' }),

  getStats: () => req('/stats'),
}

export default api
