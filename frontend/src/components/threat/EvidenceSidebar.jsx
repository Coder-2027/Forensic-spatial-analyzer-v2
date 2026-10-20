import { Crosshair, Droplets, Zap, AlertCircle, HelpCircle } from 'lucide-react'

/* ── helpers ─────────────────────────────────────────────────────────────── */

function probColor(pct) {
  if (pct >= 60) return { bar: 'bg-red-600',   text: 'text-red-400',   border: 'border-red-700' }
  if (pct >= 25) return { bar: 'bg-amber-500',  text: 'text-amber-400', border: 'border-amber-700' }
  return               { bar: 'bg-blue-500',    text: 'text-blue-400',  border: 'border-blue-700' }
}

function categoryIcon(cat) {
  const cls = 'shrink-0'
  switch (cat) {
    case 'ballistic':   return <Zap      size={14} className={`${cls} text-red-400`}   />
    case 'sharp':       return <Crosshair size={14} className={`${cls} text-orange-400`} />
    case 'heavy_blunt': return <AlertCircle size={14} className={`${cls} text-amber-400`} />
    case 'ligature':    return <Crosshair size={14} className={`${cls} text-purple-400`} />
    case 'improvised':  return <AlertCircle size={14} className={`${cls} text-teal-400`}  />
    case 'unaccounted': return <HelpCircle  size={14} className={`${cls} text-slate-400`} />
    default:            return <HelpCircle  size={14} className={`${cls} text-slate-400`} />
  }
}

/* ── sub-components ──────────────────────────────────────────────────────── */

function BloodPill({ contact }) {
  return contact ? (
    <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full
                     bg-red-950 border border-red-700 text-red-300 font-medium">
      <Droplets size={10} /> Blood contact
    </span>
  ) : (
    <span className="text-xs px-2 py-0.5 rounded-full
                     bg-slate-800 border border-slate-600 text-slate-500">
      No contact
    </span>
  )
}

function ConfidenceBadge({ conf }) {
  const pct = Math.round(conf * 100)
  const color =
    pct >= 70 ? 'text-emerald-400 border-emerald-700 bg-emerald-950' :
    pct >= 40 ? 'text-amber-400  border-amber-700  bg-amber-950'  :
                'text-slate-400  border-slate-600  bg-slate-800'
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-mono ${color}`}>
      {pct}% conf
    </span>
  )
}

function ResultCard({ item, rank, isHovered, onMouseEnter, onMouseLeave }) {
  const isUnaccounted = item.category === 'unaccounted'
  const colors = probColor(item.probability_pct)

  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={[
        'rounded-xl border p-3 transition-all duration-150 cursor-default',
        isHovered
          ? `${colors.border} bg-slate-800/80 shadow-lg shadow-black/40`
          : 'border-slate-700/60 bg-slate-900/60 hover:border-slate-600',
        isUnaccounted ? 'opacity-70 mt-2' : '',
      ].join(' ')}
    >
      {/* ── top row ── */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          {!isUnaccounted && (
            <span className="text-xs font-bold text-slate-500 w-4 shrink-0">
              #{rank}
            </span>
          )}
          {categoryIcon(item.category)}
          <span className="font-semibold text-slate-100 text-sm truncate capitalize">
            {item.label}
          </span>
        </div>

        <span className={`text-lg font-bold tabular-nums shrink-0 ${colors.text}`}>
          {item.probability_pct.toFixed(1)}%
        </span>
      </div>

      {/* ── probability bar ── */}
      <div className="w-full bg-slate-800 rounded-full h-1.5 mb-2">
        <div
          className={`h-1.5 rounded-full transition-all duration-500 ${colors.bar}`}
          style={{ width: `${Math.min(item.probability_pct, 100)}%` }}
        />
      </div>

      {/* ── badges row ── */}
      {!isUnaccounted && (
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <ConfidenceBadge conf={item.confidence} />
          <BloodPill contact={item.blood_contact} />
          {item.nearest_blood_dist_px != null && (
            <span className="text-xs text-slate-500 font-mono">
              {Math.round(item.nearest_blood_dist_px)}px from stain
            </span>
          )}
        </div>
      )}

      {/* ── rationale ── */}
      <p className="text-xs text-slate-400 leading-relaxed line-clamp-3">
        {item.rationale}
      </p>
    </div>
  )
}

/* ── main component ──────────────────────────────────────────────────────── */

/**
 * EvidenceSidebar
 *
 * Props
 * -----
 * results       – array from API (sorted by probability desc)
 * hoveredLabel  – string | null – label of the currently hovered bbox
 * onHover(lbl)  – called when a card is hovered (null on leave)
 * bloodInfo     – { stain_count, stains[] } from API
 */
export default function EvidenceSidebar({ results, hoveredLabel, onHover, bloodInfo }) {
  if (!results?.length) return null

  const regular    = results.filter(r => r.category !== 'unaccounted')
  const unaccounted = results.find(r => r.category === 'unaccounted')

  return (
    <aside className="flex flex-col gap-3 h-full overflow-y-auto pr-1
                      scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">

      {/* ── blood summary header ── */}
      {bloodInfo && (
        <div className="flex items-center gap-2 bg-red-950/40 border border-red-900/60
                        rounded-xl px-3 py-2 text-sm">
          <Droplets size={16} className="text-red-400 shrink-0" />
          <span className="text-red-300 font-medium">
            {bloodInfo.stain_count} bloodstain{bloodInfo.stain_count !== 1 ? 's' : ''} detected
          </span>
          <span className="ml-auto text-red-500 text-xs">
            {bloodInfo.stains.filter(s => s.type === 'pool').length} pool ·{' '}
            {bloodInfo.stains.filter(s => s.type === 'spatter').length} spatter
          </span>
        </div>
      )}

      {/* ── ranked detections ── */}
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest px-1">
        Weapon Probability Ranking
      </div>

      {regular.map((item, i) => (
        <ResultCard
          key={`${item.label}-${i}`}
          item={item}
          rank={i + 1}
          isHovered={hoveredLabel === item.label}
          onMouseEnter={() => onHover(item.label)}
          onMouseLeave={() => onHover(null)}
        />
      ))}

      {/* ── unaccounted baseline ── */}
      {unaccounted && (
        <>
          <div className="text-xs text-slate-600 uppercase tracking-widest px-1 mt-1">
            Baseline Prior
          </div>
          <ResultCard
            key="unaccounted"
            item={unaccounted}
            rank={0}
            isHovered={false}
            onMouseEnter={() => {}}
            onMouseLeave={() => {}}
          />
        </>
      )}
    </aside>
  )
}
