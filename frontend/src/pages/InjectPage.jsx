import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../services/api'
import useStore from '../store'

const EXT_COLORS = {
  PDF:  { bg: 'rgba(251,113,133,.12)', color: '#fb7185', border: 'rgba(251,113,133,.3)' },
  DOCX: { bg: 'rgba(167,139,250,.12)', color: '#a78bfa', border: 'rgba(167,139,250,.3)' },
  XLSX: { bg: 'rgba(45,212,160,.12)',  color: '#2dd4a0', border: 'rgba(45,212,160,.3)' },
  CSV:  { bg: 'rgba(251,191,36,.12)',  color: '#fbbf24', border: 'rgba(251,191,36,.3)' },
  TXT:  { bg: 'rgba(96,165,250,.12)',  color: '#60a5fa', border: 'rgba(96,165,250,.3)' },
  DB:   { bg: 'rgba(96,165,250,.12)',  color: '#60a5fa', border: 'rgba(96,165,250,.3)' },
}

function getExt(s) { return EXT_COLORS[s?.toUpperCase()] || EXT_COLORS.TXT }

function StatusDot({ status }) {
  const done = status === 'completed'
  const processing = ['processing', 'cleaned', 'chunked', 'entities_extracted', 'graph_built'].includes(status)
  const failed = status === 'failed'
  if (done) return <><span className="inline-block w-2 h-2 rounded-full bg-gg mr-1.5 align-middle" /><span className="text-[11px] text-gg font-medium">GraphRAG ready</span></>
  if (failed) return <><span className="inline-block w-2 h-2 rounded-full bg-coral mr-1.5 align-middle" /><span className="text-[11px] text-coral font-medium">Failed</span></>
  if (processing) return <><span className="inline-block w-2 h-2 rounded-full bg-amber mr-1.5 align-middle animate-pulse" /><span className="text-[11px] text-amber font-medium capitalize">{status.replace('_', ' ')}</span></>
  return <><span className="inline-block w-2 h-2 rounded-full bg-dborder2 mr-1.5 align-middle" /><span className="text-[11px] text-t3 font-medium">Queued</span></>
}

function PipelineSteps({ steps = {}, status }) {
  const labels = ['Cleaned', 'Chunked', 'Entities', 'Graph built', 'Indexed']
  const keys = ['cleaned', 'chunked', 'entities_extracted', 'graph_built', 'indexed']
  const processing = ['processing', 'cleaned', 'chunked', 'entities_extracted', 'graph_built'].includes(status)

  return (
    <div className="flex flex-wrap gap-1">
      {keys.map((k, i) => {
        const done = steps[k]
        const isActive = !done && processing && keys.slice(0, i).every(pk => steps[pk])
        return (
          <span
            key={k}
            className={`apill ${done ? 'apill-done' : isActive ? 'apill-active' : ''}`}
          >
            {labels[i]}{isActive ? '…' : ''}
          </span>
        )
      })}
    </div>
  )
}

function Pyramid() {
  return (
    <div className="flex flex-col items-center gap-1 pb-7">
      {[
        { label: 'Result', w: 80 }, { label: 'Model select', w: 160 },
        { label: 'SLM engine', w: 250 },
        { label: '▶ Data + GraphRAG — active', w: 360, active: true },
      ].map((t, i) => (
        <div
          key={i}
          className={`flex items-center justify-center h-9 rounded-[10px] text-[12px] font-semibold px-5 ${
            t.active
              ? 'bg-amber/10 border border-amber/40 text-amber'
              : 'bg-bg4 border border-dborder text-t3'
          }`}
          style={{ width: t.w }}
        >
          {t.label}
        </div>
      ))}
    </div>
  )
}

export default function InjectPage() {
  const { fileStatuses, addFile, updateFile, setStep } = useStore()
  const [activeTab, setActiveTab] = useState('file')
  const [dbOpen, setDbOpen] = useState(false)
  const [dbStatus, setDbStatus] = useState('Not connected')
  const [dbStatusClass, setDbStatusClass] = useState('text-t3')
  const [scrapeUrl, setScrapeUrl] = useState('')
  const [scraping, setScraping] = useState(false)
  const [retrying, setRetrying] = useState({})
  const fileInput = useRef(null)
  const pollingRef = useRef(null)

  const handleRetry = useCallback(async (fileId) => {
    setRetrying((r) => ({ ...r, [fileId]: true }))
    try {
      await api.retryFile(fileId)
    } catch (e) {
      console.error('Retry failed', e)
    } finally {
      setRetrying((r) => ({ ...r, [fileId]: false }))
    }
  }, [])

  // Poll for status updates every 2 seconds
  useEffect(() => {
    const poll = async () => {
      try {
        const { files } = await api.getStatus()
        const { uploadedFileIds, sessionStartedAt, fileStatuses: knownFiles } = useStore.getState()
        const sessionFiles = files.filter((f) => {
          const uploadedAt = Number(f.uploaded_at || 0)
          return uploadedAt >= sessionStartedAt || uploadedFileIds.includes(f.file_id)
        })

        sessionFiles.forEach((f) => updateFile(f.file_id, f))
        sessionFiles.forEach((f) => {
          if (!knownFiles.find((s) => s.file_id === f.file_id)) addFile(f)
        })
      } catch {}
    }
    poll()
    pollingRef.current = setInterval(poll, 2000)
    return () => clearInterval(pollingRef.current)
  }, [addFile, updateFile])

  const handleFiles = useCallback(async (fileList) => {
    for (const file of Array.from(fileList)) {
      try {
        const res = await api.upload(file)
        addFile({
          file_id: res.file_id,
          filename: file.name,
          size: file.size,
          ext: file.name.split('.').pop().toUpperCase(),
          status: 'uploaded',
          pipeline_steps: { cleaned: false, chunked: false, entities_extracted: false, graph_built: false, indexed: false },
          entities_count: 0,
          relations_count: 0,
          chunks_count: 0,
          uploaded_at: Date.now() / 1000,
        })
      } catch (e) {
        console.error('Upload failed', e)
      }
    }
  }, [addFile])

  const handleDrop = (e) => {
    e.preventDefault()
    handleFiles(e.dataTransfer.files)
  }

  const handleScrape = async () => {
    if (!scrapeUrl.trim()) return
    setScraping(true)
    try {
      const res = await api.scrape(scrapeUrl.trim())
      addFile({
        file_id: res.file_id,
        filename: `${scrapeUrl.slice(0, 40)}_scraped.txt`,
        size: res.chars,
        ext: 'TXT',
        status: 'uploaded',
        pipeline_steps: { cleaned: false, chunked: false, entities_extracted: false, graph_built: false, indexed: false },
        entities_count: 0, relations_count: 0, chunks_count: 0,
        uploaded_at: Date.now() / 1000,
      })
      setScrapeUrl('')
    } catch (e) {
      alert('Scrape failed: ' + e.message)
    } finally {
      setScraping(false)
    }
  }

  const completed = fileStatuses.filter((f) => f.status === 'completed').length
  const total = fileStatuses.length
  const overallPct = total > 0 ? Math.round((completed / total) * 100) : 0

  return (
    <div>
      <div className="bg-card border-b border-dborder px-0 py-7 mb-7">
        <div className="max-w-[1100px] mx-auto px-12">
          <div className="text-[10px] font-semibold uppercase tracking-[.12em] text-t3 mb-1.5 flex items-center gap-2">
            <span className="inline-block w-4 h-px bg-accent" />
            Step 1 of 4 · Foundation layer
          </div>
          <div className="font-sora text-2xl font-semibold text-t1">Data Injection & GraphRAG</div>
          <div className="text-[12px] text-t2 mt-1">
            Upload files or connect a database — system cleans, labels, maps entities & builds knowledge graph
          </div>
        </div>
      </div>

      <div className="max-w-[1100px] mx-auto px-12">
        <Pyramid />

        {/* Source tabs */}
        <div className="flex gap-2 mb-4">
          {['file', 'db', 'scrape'].map((t) => (
            <button
              key={t}
              className={`btn btn-sm ${activeTab === t ? 'border-accent text-accent bg-accent/10' : ''}`}
              onClick={() => setActiveTab(t)}
            >
              {t === 'file' ? 'File upload' : t === 'db' ? 'Database connect' : 'Scrape URL'}
            </button>
          ))}
        </div>

        {/* File upload */}
        {activeTab === 'file' && (
          <div
            className="border border-dashed border-dborder2 rounded-card p-7 text-center cursor-pointer bg-card transition-all hover:border-accent hover:bg-accent/5"
            onDrop={handleDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileInput.current?.click()}
          >
            <input
              ref={fileInput}
              type="file"
              multiple
              accept=".pdf,.docx,.txt,.csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <div className="w-10 h-10 bg-bg4 border border-dborder rounded-sm flex items-center justify-center mx-auto mb-2.5">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M9 2.5v10M6 5.5l3-3 3 3M3 13h12v2H3z" stroke="#7c6af8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="text-[12px] text-t2">
              Drop files or <span className="text-accent font-medium">click to browse</span>
            </div>
            <div className="text-[10px] text-t3 mt-1">Supports PDF · DOCX · XLSX · CSV · TXT — multiple files allowed</div>
          </div>
        )}

        {/* DB connect */}
        {activeTab === 'db' && (
          <div className="bg-card border border-dborder rounded-card overflow-hidden">
            <div
              className="flex items-center justify-between p-3.5 border-b border-dborder bg-card2 cursor-pointer hover:bg-bg4"
              onClick={() => setDbOpen(!dbOpen)}
            >
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 bg-blue/10 border border-blue/30 rounded-lg flex items-center justify-center">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <ellipse cx="7" cy="4" rx="5" ry="2" stroke="#60a5fa" strokeWidth="1.2" />
                    <path d="M2 4v3c0 1.1 2.24 2 5 2s5-.9 5-2V4" stroke="#60a5fa" strokeWidth="1.2" />
                    <path d="M2 7v3c0 1.1 2.24 2 5 2s5-.9 5-2V7" stroke="#60a5fa" strokeWidth="1.2" />
                  </svg>
                </div>
                <div>
                  <div className="text-[12px] font-semibold text-t1">Database connection</div>
                  <div className="text-[10px] text-t3">Connect your data source securely</div>
                </div>
              </div>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ transform: dbOpen ? 'rotate(180deg)' : '', transition: 'transform .2s' }}>
                <path d="M3 5l4 4 4-4" stroke="#5c5a78" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </div>
            {dbOpen && (
              <div className="p-5">
                <div className="grid grid-cols-2 gap-3 mb-4">
                  {[
                    { label: 'Database type', type: 'select', opts: ['PostgreSQL','MySQL','MongoDB','Snowflake','BigQuery','SQL Server'] },
                    { label: 'Host / Endpoint', type: 'text', placeholder: 'db.example.com' },
                    { label: 'Port', type: 'text', placeholder: '5432' },
                    { label: 'Database name', type: 'text', placeholder: 'production_db' },
                    { label: 'Username', type: 'text', placeholder: 'admin' },
                    { label: 'Password', type: 'password', placeholder: '••••••••' },
                  ].map((f) => (
                    <div key={f.label} className="flex flex-col gap-1">
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-t3">{f.label}</label>
                      {f.type === 'select' ? (
                        <select className="bg-bg3 border border-dborder2 rounded-sm px-3 py-2 text-[12px] text-t1 outline-none focus:border-accent">
                          {f.opts.map((o) => <option key={o}>{o}</option>)}
                        </select>
                      ) : (
                        <input type={f.type} placeholder={f.placeholder} className="bg-bg3 border border-dborder2 rounded-sm px-3 py-2 text-[12px] text-t1 outline-none focus:border-accent" />
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2.5">
                  <button className="btn btn-p btn-sm" onClick={() => { setDbStatus('✓ Connection successful'); setDbStatusClass('text-gg') }}>Test connection</button>
                  <button className="btn btn-sm" onClick={() => { setDbStatus('✓ Ingesting schema…'); setDbStatusClass('text-gg') }}>Connect & ingest</button>
                  <span className={`text-[11px] ${dbStatusClass}`}>{dbStatus}</span>
                </div>
                <div className="flex gap-2 flex-wrap mt-3.5 pt-3.5 border-t border-dborder">
                  <div className="db-chip db-chip-connected"><span className="w-1.5 h-1.5 rounded-full bg-gg flex-shrink-0" />PostgreSQL · prod-db</div>
                  <div className="db-chip"><span className="w-1.5 h-1.5 rounded-full bg-t3 flex-shrink-0" />MySQL · analytics</div>
                  <div className="db-chip"><span className="w-1.5 h-1.5 rounded-full bg-t3 flex-shrink-0" />Snowflake · warehouse</div>
                  <div className="db-chip border-dashed text-t3">+ Add new source</div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Scrape URL */}
        {activeTab === 'scrape' && (
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="https://example.com/page"
              value={scrapeUrl}
              onChange={(e) => setScrapeUrl(e.target.value)}
              className="flex-1 bg-bg3 border border-dborder2 rounded-sm px-4 py-2 text-[12px] text-t1 outline-none focus:border-accent"
              onKeyDown={(e) => e.key === 'Enter' && handleScrape()}
            />
            <button className="btn btn-p" onClick={handleScrape} disabled={scraping}>
              {scraping ? 'Scraping…' : 'Scrape & ingest'}
            </button>
          </div>
        )}

        <div className="h-4" />

        {/* Document table */}
        <div className="sect">Injected documents</div>
        <div className="overflow-x-auto border border-dborder rounded-card">
          <table className="w-full border-collapse" style={{ tableLayout: 'fixed', minWidth: 700 }}>
            <thead>
              <tr>
                {[['Document', '32%'], ['Type', '10%'], ['Curation status', '20%'], ['Pipeline actions', '38%']].map(([h, w]) => (
                  <th key={h} className="text-[10px] font-semibold uppercase tracking-widest text-t3 px-3.5 py-3 text-left bg-bg4 border-b border-dborder" style={{ width: w }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fileStatuses.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center py-10 text-t3 text-[12px]">
                    No files uploaded yet — drag & drop or browse to get started
                  </td>
                </tr>
              ) : (
                fileStatuses.map((f) => {
                  const ec = getExt(f.ext)
                  return (
                    <tr key={f.file_id} className="border-b border-dborder last:border-b-0 hover:bg-bg4 transition-colors">
                      <td className="px-3.5 py-3">
                        <div className="text-[12px] font-medium text-t1 truncate">{f.filename}</div>
                        <div className="text-[10px] text-t3 mt-0.5">
                          {f.size ? `${(f.size / 1024).toFixed(0)} KB` : '—'}
                          {f.entities_count > 0 && ` · ${f.entities_count} entities`}
                          {f.relations_count > 0 && ` · ${f.relations_count} relations`}
                        </div>
                      </td>
                      <td className="px-3.5 py-3">
                        <span className="ft-badge" style={{ background: ec.bg, color: ec.color, border: `1px solid ${ec.border}` }}>{f.ext || 'FILE'}</span>
                      </td>
                      <td className="px-3.5 py-3 align-middle">
                        <StatusDot status={f.status} />
                      </td>
                      <td className="px-3.5 py-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <PipelineSteps steps={f.pipeline_steps} status={f.status} />
                          {f.status === 'failed' && (
                            <button
                              className="btn btn-sm"
                              style={{ color: '#fb7185', borderColor: 'rgba(251,113,133,.4)', background: 'rgba(251,113,133,.08)', padding: '2px 10px', fontSize: 11 }}
                              disabled={retrying[f.file_id]}
                              onClick={() => handleRetry(f.file_id)}
                            >
                              {retrying[f.file_id] ? 'Retrying…' : '↺ Retry'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Progress bars */}
        {fileStatuses.length > 0 && (
          <div className="mt-3.5 space-y-2.5">
            <div>
              <div className="flex justify-between mb-1 text-[11px] text-t2">
                <span>Overall GraphRAG construction</span><span>{overallPct}%</span>
              </div>
              <div className="prog-bar"><div className="prog-fill" style={{ width: `${overallPct}%` }} /></div>
            </div>
            <div>
              <div className="flex justify-between mb-1 text-[11px] text-t2">
                <span>Entity relationship mapping</span>
                <span>{Math.min(100, Math.round(overallPct * 1.2))}%</span>
              </div>
              <div className="prog-bar">
                <div className="prog-fill" style={{ width: `${Math.min(100, Math.round(overallPct * 1.2))}%`, background: '#2dd4a0' }} />
              </div>
            </div>
          </div>
        )}

        <div className="h-6" />
        <div className="grid grid-cols-2 gap-3">
          <button className="btn" onClick={() => setStep(0)}>← Back</button>
          <button className="btn btn-p" onClick={() => setStep(2)}>Continue to prompt →</button>
        </div>
        <div className="h-8" />
      </div>
    </div>
  )
}
