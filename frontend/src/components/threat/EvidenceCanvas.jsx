import { useEffect, useRef, useCallback } from 'react'

/* ── colour helpers ──────────────────────────────────────────────────────── */

function bboxColor(pct, alpha = 1) {
  if (pct >= 60) return `rgba(220, 38,  38,  ${alpha})`   // red-600
  if (pct >= 25) return `rgba(245, 158, 11,  ${alpha})`   // amber-500
  return               `rgba(59,  130, 246, ${alpha})`    // blue-500
}

/* ── drawing helpers ─────────────────────────────────────────────────────── */

/** Draw a single blood-stain polygon with a semi-transparent crimson fill */
function drawBloodPolygon(ctx, polygon, scaleX, scaleY) {
  if (!polygon?.length) return
  ctx.beginPath()
  ctx.moveTo(polygon[0][0] * scaleX, polygon[0][1] * scaleY)
  for (let i = 1; i < polygon.length; i++) {
    ctx.lineTo(polygon[i][0] * scaleX, polygon[i][1] * scaleY)
  }
  ctx.closePath()
  ctx.fillStyle   = 'rgba(185, 28, 28, 0.35)'   // crimson fill
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.80)'   // bright red edge
  ctx.lineWidth   = 1.5
  ctx.fill()
  ctx.stroke()
}

/** Draw a colour-coded, rounded bounding box with a label chip */
function drawBBox(ctx, obj, scaleX, scaleY, hovered) {
  if (!obj.bbox) return
  const [x1, y1, x2, y2] = obj.bbox
  const sx1 = x1 * scaleX, sy1 = y1 * scaleY
  const sx2 = x2 * scaleX, sy2 = y2 * scaleY

  const color  = bboxColor(obj.probability_pct)
  const alpha  = hovered ? 0.30 : 0.12
  const lWidth = hovered ? 2.5 : 1.5

  ctx.strokeStyle = color
  ctx.lineWidth   = lWidth
  ctx.setLineDash([])

  // Filled rect
  ctx.fillStyle = bboxColor(obj.probability_pct, alpha)
  ctx.fillRect(sx1, sy1, sx2 - sx1, sy2 - sy1)
  ctx.strokeRect(sx1, sy1, sx2 - sx1, sy2 - sy1)

  // Label chip
  const label = `${obj.label}  ${obj.probability_pct.toFixed(1)}%`
  ctx.font         = `bold ${hovered ? 12 : 11}px monospace`
  ctx.textBaseline = 'bottom'
  const tw = ctx.measureText(label).width
  const chipH = 18, chipPad = 6
  const chipX = sx1
  const chipY = sy1 - chipH

  ctx.fillStyle = bboxColor(obj.probability_pct, 0.85)
  ctx.fillRect(chipX, chipY, tw + chipPad * 2, chipH)

  ctx.fillStyle = '#fff'
  ctx.fillText(label, chipX + chipPad, sy1 - 3)
}

/** Draw a dashed line from obj centre to nearest blood stain centroid */
function drawProximityLine(ctx, obj, stains, scaleX, scaleY) {
  if (!obj.bbox || !stains?.length) return

  const [x1, y1, x2, y2] = obj.bbox
  const ox = ((x1 + x2) / 2) * scaleX
  const oy = ((y1 + y2) / 2) * scaleY

  // Find nearest stain
  let nearestStain = null
  let minDist = Infinity
  for (const s of stains) {
    const dx = ox - s.cx * scaleX
    const dy = oy - s.cy * scaleY
    const d  = Math.sqrt(dx * dx + dy * dy)
    if (d < minDist) { minDist = d; nearestStain = s }
  }
  if (!nearestStain) return

  const sx = nearestStain.cx * scaleX
  const sy = nearestStain.cy * scaleY

  ctx.beginPath()
  ctx.setLineDash([5, 4])
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.55)'  // amber dashed
  ctx.lineWidth   = 1
  ctx.moveTo(ox, oy)
  ctx.lineTo(sx, sy)
  ctx.stroke()
  ctx.setLineDash([])

  // Small dot at stain centroid
  ctx.beginPath()
  ctx.arc(sx, sy, 3, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(239, 68, 68, 0.8)'
  ctx.fill()
}

/* ── hit testing ─────────────────────────────────────────────────────────── */

function getHoveredObject(mouseX, mouseY, results, scaleX, scaleY) {
  for (const obj of results) {
    if (!obj.bbox) continue
    const [x1, y1, x2, y2] = obj.bbox
    if (
      mouseX >= x1 * scaleX && mouseX <= x2 * scaleX &&
      mouseY >= y1 * scaleY && mouseY <= y2 * scaleY
    ) return obj.label
  }
  return null
}

/* ── component ───────────────────────────────────────────────────────────── */

/**
 * EvidenceCanvas
 *
 * Props
 * -----
 * imageURL      – object URL of the uploaded image
 * apiData       – full JSON response from /api/analyze
 * hoveredLabel  – string | null (from sidebar hover)
 * onHover(lbl)  – called when canvas bbox is hovered (null on leave)
 */
export default function EvidenceCanvas({ imageURL, apiData, hoveredLabel, onHover }) {
  const canvasRef = useRef(null)
  const imgRef    = useRef(new Image())
  const scaleRef  = useRef({ x: 1, y: 1 })

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx    = canvas.getContext('2d')
    const img    = imgRef.current
    const { x: sx, y: sy } = scaleRef.current
    const { results, blood } = apiData ?? {}

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Background image
    if (img.complete && img.naturalWidth) {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    }

    if (!results) return

    // Blood polygons
    for (const stain of blood?.stains ?? []) {
      drawBloodPolygon(ctx, stain.polygon, sx, sy)
    }

    // Proximity lines (draw beneath boxes)
    for (const obj of results) {
      if (obj.category === 'unaccounted') continue
      drawProximityLine(ctx, obj, blood?.stains, sx, sy)
    }

    // Bounding boxes (hovered last so it renders on top)
    const sorted = [...results].sort(
      (a, b) => (a.label === hoveredLabel ? 1 : 0) - (b.label === hoveredLabel ? 1 : 0)
    )
    for (const obj of sorted) {
      if (obj.category === 'unaccounted') continue
      drawBBox(ctx, obj, sx, sy, hoveredLabel === obj.label)
    }
  }, [apiData, hoveredLabel])

  /* Load image and set canvas dimensions */
  useEffect(() => {
    if (!imageURL || !apiData) return
    const img = imgRef.current
    img.onload = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const maxW = canvas.parentElement.clientWidth
      const scale = Math.min(maxW / img.naturalWidth, 1)
      canvas.width  = img.naturalWidth  * scale
      canvas.height = img.naturalHeight * scale
      scaleRef.current = {
        x: canvas.width  / apiData.image.width,
        y: canvas.height / apiData.image.height,
      }
      redraw()
    }
    img.src = imageURL
  }, [imageURL, apiData, redraw])

  /* Redraw on hover changes */
  useEffect(() => { redraw() }, [hoveredLabel, redraw])

  /* Canvas mouse move for hit-testing */
  const onMouseMove = useCallback(
    (e) => {
      const canvas = canvasRef.current
      if (!canvas || !apiData?.results) return
      const rect = canvas.getBoundingClientRect()
      const mx   = e.clientX - rect.left
      const my   = e.clientY - rect.top
      const lbl  = getHoveredObject(mx, my, apiData.results, scaleRef.current.x, scaleRef.current.y)
      onHover(lbl)
    },
    [apiData, onHover]
  )

  const onMouseLeave = useCallback(() => onHover(null), [onHover])

  return (
    <div className="flex justify-center items-start w-full">
      <canvas
        ref={canvasRef}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        className="rounded-xl border border-slate-700 shadow-2xl shadow-black/60 cursor-crosshair max-w-full"
        style={{ imageRendering: 'crisp-edges' }}
      />
    </div>
  )
}
