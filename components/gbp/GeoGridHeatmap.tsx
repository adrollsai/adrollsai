'use client'

import { useEffect, useRef, useState } from 'react'
import { MapPin, Navigation, Info, Layers, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import 'leaflet/dist/leaflet.css'

interface PinData {
  id: string
  lat: number
  lng: number
  rank: number
  distanceKm: number
  competitorAhead?: string
}

interface HeatmapData {
  keyword: string
  center: { lat: number; lng: number }
  radiusKm: number
  gridSize: number
  averageRank: number
  top3SharePercent: number
  pins: PinData[]
}

interface GeoGridHeatmapProps {
  heatmaps: Record<string, HeatmapData>
  businessName: string
  businessAddress: string
}

export default function GeoGridHeatmap({
  heatmaps,
  businessName,
  businessAddress
}: GeoGridHeatmapProps) {
  const keywords = Object.keys(heatmaps)
  const [selectedKeyword, setSelectedKeyword] = useState<string>(keywords[0] || '')
  const [selectedPin, setSelectedPin] = useState<PinData | null>(null)
  const [mapReady, setMapReady] = useState(false)

  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)
  const layerGroupRef = useRef<any>(null)

  const currentHeatmap = heatmaps[selectedKeyword] || Object.values(heatmaps)[0]

  useEffect(() => {
    if (typeof window === 'undefined' || !mapContainerRef.current || !currentHeatmap) return

    let L: any
    let isCancelled = false

    const initMap = async () => {
      L = (await import('leaflet')).default

      if (isCancelled || !mapContainerRef.current) return

      // Clean up previous instance
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }

      const center = [currentHeatmap.center.lat, currentHeatmap.center.lng]

      // Initialize map
      const map = L.map(mapContainerRef.current, {
        center,
        zoom: 13,
        scrollWheelZoom: false,
        attributionControl: false
      })

      // Clean, reliable OpenStreetMap layer (no watermark, zero API key required)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        subdomains: 'abc',
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(map)

      const layerGroup = L.layerGroup().addTo(map)
      layerGroupRef.current = layerGroup
      mapInstanceRef.current = map
      setMapReady(true)

      renderMarkers(L, map, layerGroup, currentHeatmap)
    }

    initMap()

    return () => {
      isCancelled = true
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }
    }
  }, [selectedKeyword])

  const renderMarkers = (L: any, map: any, layerGroup: any, heatmap: HeatmapData) => {
    layerGroup.clearLayers()

    // 1. Business Center Pin
    const centerIcon = L.divIcon({
      className: 'custom-center-pin',
      html: `
        <div class="relative flex items-center justify-center">
          <div class="absolute w-8 h-8 rounded-full bg-blue-500/30 animate-ping"></div>
          <div class="w-6 h-6 rounded-full bg-blue-600 border-2 border-white shadow-lg flex items-center justify-center text-white">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z"/>
            </svg>
          </div>
        </div>
      `,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    })

    L.marker([heatmap.center.lat, heatmap.center.lng], { icon: centerIcon })
      .bindPopup(`<strong>${businessName}</strong><br/>${businessAddress}`)
      .addTo(layerGroup)

    // 2. Geo-Grid Ranking Pins
    heatmap.pins.forEach((pin) => {
      const isTop3 = pin.rank <= 3
      const isPage1 = pin.rank >= 4 && pin.rank <= 9
      const isRank20Plus = pin.rank >= 21

      const displayText = isRank20Plus ? '20+' : `${pin.rank}`

      const bgColor = isTop3
        ? 'bg-emerald-500'
        : isPage1
        ? 'bg-amber-500'
        : 'bg-rose-600'

      const shadowColor = isTop3
        ? 'shadow-emerald-500/40'
        : isPage1
        ? 'shadow-amber-500/40'
        : 'shadow-rose-600/40'

      const pinIcon = L.divIcon({
        className: 'custom-rank-pin',
        html: `
          <div class="cursor-pointer group transform transition-transform hover:scale-125">
            <div class="${bgColor} ${shadowColor} w-7 h-7 rounded-full border-2 border-white shadow-md flex items-center justify-center text-[10px] font-black text-white select-none">
              ${displayText}
            </div>
          </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      })

      const marker = L.marker([pin.lat, pin.lng], { icon: pinIcon }).addTo(layerGroup)

      marker.on('click', () => {
        setSelectedPin(pin)
      })
    })

    // Fit bounds smoothly to contain all pins
    const bounds = L.latLngBounds(heatmap.pins.map(p => [p.lat, p.lng]))
    map.fitBounds(bounds, { padding: [25, 25] })
  }

  if (!currentHeatmap) {
    return null
  }

  const top3Count = currentHeatmap.pins.filter(p => p.rank <= 3).length
  const page1Count = currentHeatmap.pins.filter(p => p.rank >= 4 && p.rank <= 9).length
  const outerCount = currentHeatmap.pins.filter(p => p.rank >= 10).length

  return (
    <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xl overflow-hidden">
      {/* Header */}
      <div className="p-6 sm:p-8 border-b border-slate-100 bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold tracking-wider uppercase mb-2 border border-emerald-500/30">
              <Layers size={13} /> Geo-Grid Local Ranking Scanner
            </div>
            <h3 className="text-xl sm:text-2xl font-black tracking-tight">
              Google Maps Keyword Geo-Heatmap
            </h3>
            <p className="text-sm text-slate-300 mt-1">
              Visualizing how <span className="text-white font-semibold">{businessName}</span> ranks at 49 GPS coordinate checkpoints across a {currentHeatmap.radiusKm}km radius.
            </p>
          </div>

          {/* Grid Stats Bar */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="bg-white/10 backdrop-blur-md rounded-2xl px-4 py-2 border border-white/10">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Avg Rank</span>
              <span className="text-xl font-black text-white">#{currentHeatmap.averageRank}</span>
            </div>
            <div className="bg-white/10 backdrop-blur-md rounded-2xl px-4 py-2 border border-white/10">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">3-Pack Share</span>
              <span className="text-xl font-black text-emerald-400">{currentHeatmap.top3SharePercent}%</span>
            </div>
            <div className="bg-white/10 backdrop-blur-md rounded-2xl px-4 py-2 border border-white/10">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Grid Points</span>
              <span className="text-xl font-black text-indigo-300">{currentHeatmap.pins.length}</span>
            </div>
          </div>
        </div>

        {/* Keyword Selector Tabs */}
        <div className="mt-6 flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide">
          {keywords.map(kw => {
            const isActive = kw === selectedKeyword
            const kwData = heatmaps[kw]
            return (
              <button
                key={kw}
                onClick={() => {
                  setSelectedKeyword(kw)
                  setSelectedPin(null)
                }}
                className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all duration-200 flex items-center gap-2 ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30 scale-105'
                    : 'bg-white/10 hover:bg-white/15 text-slate-300'
                }`}
              >
                <span>📍 {kw}</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                  isActive ? 'bg-white/20 text-white' : 'bg-black/30 text-slate-300'
                }`}>
                  Avg #{kwData?.averageRank}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Heatmap Visual & Interactive Canvas */}
      <div className="relative">
        <div
          ref={mapContainerRef}
          className="w-full h-[420px] sm:h-[500px] z-10 bg-slate-100"
          style={{ minHeight: '400px' }}
        />

        {/* Floating Selected Pin Info Card */}
        {selectedPin && (
          <div className="absolute top-4 right-4 z-20 max-w-sm w-full bg-white/95 backdrop-blur-md rounded-2xl p-4 shadow-2xl border border-slate-200 animate-in fade-in slide-in-from-top-2">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  Checkpoint Coordinate
                </span>
                <div className="flex items-center gap-2 mt-1">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-sm text-white ${
                    selectedPin.rank <= 3 ? 'bg-emerald-500' : selectedPin.rank <= 9 ? 'bg-amber-500' : 'bg-rose-600'
                  }`}>
                    {selectedPin.rank >= 21 ? '20+' : selectedPin.rank}
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-slate-900">
                      Rank #{selectedPin.rank >= 21 ? '20+ (Not Ranking)' : selectedPin.rank}
                    </h4>
                    <p className="text-xs text-slate-500 font-medium">
                      {selectedPin.distanceKm.toFixed(1)} km from your storefront
                    </p>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setSelectedPin(null)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                ✕
              </button>
            </div>

            {selectedPin.competitorAhead && (
              <div className="mt-3 p-2.5 rounded-xl bg-slate-50 border border-slate-200/60 text-xs">
                <span className="text-slate-500 font-semibold block text-[10px] uppercase">
                  Dominating this location:
                </span>
                <span className="font-bold text-slate-900 flex items-center gap-1.5 mt-0.5">
                  🏆 {selectedPin.competitorAhead}
                </span>
              </div>
            )}

            <p className="mt-2.5 text-[11px] text-slate-600 leading-relaxed">
              {selectedPin.rank <= 3
                ? '✅ Excellent! Your business captures high-intent calls and visits at this coordinate.'
                : selectedPin.rank <= 9
                ? '⚠️ You are on page 1 but missing out on 82% of clicks going to the top 3.'
                : '❌ Prospects searching at this location cannot find your profile without scrolling.'}
            </p>
          </div>
        )}
      </div>

      {/* Heatmap Legend & Rank Breakdown */}
      <div className="p-5 sm:p-6 bg-slate-50 border-t border-slate-200/70 flex flex-col md:flex-row items-center justify-between gap-4 text-xs font-semibold text-slate-700">
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-slate-500 uppercase tracking-wider text-[11px] font-black">
            Ranking Legend:
          </span>
          <div className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-emerald-500 text-white font-black text-[9px] flex items-center justify-center">1</span>
            <span>#1 - #3 Local 3-Pack ({top3Count} pins)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-amber-500 text-white font-black text-[9px] flex items-center justify-center">5</span>
            <span>#4 - #9 First Page ({page1Count} pins)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-rose-600 text-white font-black text-[9px] flex items-center justify-center">20+</span>
            <span>#10 - 20+ Invisible ({outerCount} pins)</span>
          </div>
        </div>

        <div className="text-slate-500 flex items-center gap-1.5 text-[11px]">
          <Info size={13} className="text-blue-600" />
          Click any pin on the map to inspect local competitor advantages.
        </div>
      </div>
    </div>
  )
}
