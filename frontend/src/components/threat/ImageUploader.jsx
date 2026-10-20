import { useRef, useState, useCallback } from 'react'
import { UploadCloud, Loader2, AlertTriangle, ShieldAlert, Images } from 'lucide-react'

/**
 * ImageUploader
 * Drag-and-drop / click-to-browse upload zone supporting single or multiple images.
 *
 * Props
 * -----
 * onResult(items)  – called with an array of parsed image results
 * isLoading        – bool
 * setIsLoading     – setter
 * setError         – setter for error string
 * error            – current error string | null
 */
export default function ImageUploader({
  onResult,
  isLoading,
  setIsLoading,
  setError,
  error,
}) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [progressText, setProgressText] = useState('')
  const [progressPct, setProgressPct] = useState(0)

  const processFiles = useCallback(
    async (rawFiles) => {
      if (!rawFiles || rawFiles.length === 0) return

      const validFiles = Array.from(rawFiles).filter((file) => {
        return (
          file.type.startsWith('image/') ||
          /\.(jpe?g|png|webp|bmp|tiff?)$/i.test(file.name)
        )
      })

      if (validFiles.length === 0) {
        setError('Please upload valid crime scene image files (JPEG, PNG, WebP, BMP, TIFF).')
        return
      }

      setError(null)
      setIsLoading(true)
      setProgressPct(0)

      const analyzedItems = []

      try {
        for (let i = 0; i < validFiles.length; i++) {
          const file = validFiles[i]
          const pct = Math.round(((i) / validFiles.length) * 100)
          setProgressPct(pct)
          setProgressText(
            validFiles.length > 1
              ? `Analyzing photo ${i + 1} of ${validFiles.length}: ${file.name}…`
              : `Running forensic pipeline on ${file.name}…`
          )

          const form = new FormData()
          form.append('file', file)

          let res
          try {
            res = await fetch('http://127.0.0.1:8000/api/analyze', { method: 'POST', body: form })
          } catch {
            res = await fetch('/api/analyze', { method: 'POST', body: form })
          }

          if (!res.ok) {
            const body = await res.json().catch(() => ({}))
            throw new Error(body.detail ?? `Server error ${res.status} on ${file.name}`)
          }

          const data = await res.json()
          data._id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
          data._imageURL = URL.createObjectURL(file)
          data._filename = file.name
          data._size = file.size
          analyzedItems.push(data)
        }

        setProgressPct(100)
        onResult(analyzedItems)
      } catch (err) {
        setError(err.message ?? 'Unknown error occurred during analysis.')
      } finally {
        setIsLoading(false)
        setProgressText('')
      }
    },
    [onResult, setError, setIsLoading]
  )

  /* ── drag handlers ── */
  const onDragOver = (e) => {
    e.preventDefault()
    setDragging(true)
  }
  const onDragLeave = () => setDragging(false)
  const onDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files) {
      processFiles(e.dataTransfer.files)
    }
  }

  const onFileChange = (e) => {
    if (e.target.files) {
      processFiles(e.target.files)
    }
  }

  return (
    <div className="flex flex-col items-center gap-4 w-full">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <ShieldAlert className="text-red-500" size={28} />
        <h1 className="text-2xl font-bold tracking-widest text-slate-100 uppercase">
          Forensic&nbsp;Threat&nbsp;Analyzer
        </h1>
      </div>

      {/* Drop zone */}
      <div
        onClick={() => !isLoading && inputRef.current?.click()}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={[
          'w-full max-w-2xl rounded-2xl border-2 border-dashed transition-all duration-200',
          'flex flex-col items-center justify-center gap-4 cursor-pointer select-none',
          'py-16 px-8 relative overflow-hidden',
          dragging
            ? 'border-red-500 bg-red-950/30 scale-[1.01]'
            : 'border-slate-600 bg-slate-900/60 hover:border-red-700 hover:bg-slate-900',
          isLoading ? 'pointer-events-none opacity-85' : '',
        ].join(' ')}
      >
        {isLoading ? (
          <div className="flex flex-col items-center gap-3 w-full max-w-md">
            <Loader2 className="animate-spin text-red-400" size={48} />
            <p className="text-slate-200 text-sm font-semibold tracking-wide text-center">
              {progressText || 'Processing crime scene imagery…'}
            </p>
            {/* Progress bar */}
            <div className="w-full bg-slate-800 rounded-full h-2 mt-1 overflow-hidden border border-slate-700">
              <div
                className="bg-red-600 h-full rounded-full transition-all duration-300 shadow-sm shadow-red-500/50"
                style={{ width: `${Math.max(5, progressPct)}%` }}
              />
            </div>
            <p className="text-slate-500 text-xs text-center mt-1">
              YOLO-World Open-Vocab · Blood Spatter Segmentation · Forensic Probability Engine
            </p>
          </div>
        ) : (
          <>
            <div className="relative">
              <UploadCloud
                className={dragging ? 'text-red-400' : 'text-slate-400'}
                size={52}
              />
              <Images
                className="absolute -bottom-1 -right-2 text-red-500 bg-slate-900 rounded-full p-0.5 border border-slate-700"
                size={22}
              />
            </div>
            <div className="text-center">
              <p className="text-slate-200 font-semibold text-base">
                Drop crime scene images here (Single or Multiple)
              </p>
              <p className="text-slate-400 text-sm mt-1">
                or click to browse multiple photos · JPEG, PNG, WebP, BMP, TIFF
              </p>
              <span className="inline-block mt-2 text-xs text-red-400/90 bg-red-950/40 border border-red-900/50 rounded-full px-3 py-1">
                Supports multi-image batch analysis
              </span>
            </div>
          </>
        )}

        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,.webp,.png,.jpg,.jpeg,.bmp,.tiff"
          className="hidden"
          onChange={onFileChange}
        />
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 w-full max-w-2xl bg-red-950/60 border border-red-700 rounded-lg px-4 py-3 text-red-300 text-sm">
          <AlertTriangle size={16} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}
