'use client'

import React, { useEffect, useRef, useState } from 'react'
import { MapPin, Search, Plus, Trash2, Crosshair, Loader2, Navigation, Layers, Info } from 'lucide-react'
import 'leaflet/dist/leaflet.css'

export interface DroppedPin {
  id: string
  latitude: number
  longitude: number
  radius: number // in kilometers (1 - 80)
  name: string
  address?: string
}

interface MapLocationPickerProps {
  pins: DroppedPin[]
  onPinsChange: (pins: DroppedPin[]) => void
  defaultCenter?: { lat: number; lng: number }
}

export default function MapLocationPicker({
  pins,
  onPinsChange,
  defaultCenter = { lat: 18.5204, lng: 73.8567 } // Pune / India default
}: MapLocationPickerProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)
  const markersGroupRef = useRef<any>(null)
  const circlesGroupRef = useRef<any>(null)

  const [activeRadius, setActiveRadius] = useState<number>(15)
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [isSearching, setIsSearching] = useState<boolean>(false)
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [isDropModeActive, setIsDropModeActive] = useState<boolean>(true)
  const [selectedPinId, setSelectedPinId] = useState<string | null>(pins[0]?.id || null)

  // Initialize Leaflet Map
  useEffect(() => {
    if (typeof window === 'undefined' || !mapContainerRef.current) return

    let L: any
    let isCancelled = false

    const init = async () => {
      L = (await import('leaflet')).default

      if (isCancelled || !mapContainerRef.current) return

      // Fix default Leaflet icon paths in Next.js bundlers
      delete (L.Icon.Default.prototype as any)._getIconUrl
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      })

      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }

      const initialLat = pins.length > 0 ? pins[0].latitude : defaultCenter.lat
      const initialLng = pins.length > 0 ? pins[0].longitude : defaultCenter.lng

      const map = L.map(mapContainerRef.current, {
        center: [initialLat, initialLng],
        zoom: pins.length > 0 ? 11 : 10,
        zoomControl: true,
        attributionControl: false
      })

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
      }).addTo(map)

      markersGroupRef.current = L.layerGroup().addTo(map)
      circlesGroupRef.current = L.layerGroup().addTo(map)
      mapInstanceRef.current = map

      // Map Click Handler for Dropping Pins
      map.on('click', async (e: any) => {
        const { lat, lng } = e.latlng
        const newPinId = `pin_${Date.now()}`
        
        let placeName = `Pin (${lat.toFixed(3)}, ${lng.toFixed(3)})`
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`)
          const data = await res.json()
          if (data && data.display_name) {
            const parts = data.display_name.split(',').map((p: string) => p.trim())
            placeName = parts.slice(0, 3).join(', ')
          }
        } catch (err) {}

        const newPin: DroppedPin = {
          id: newPinId,
          latitude: parseFloat(lat.toFixed(5)),
          longitude: parseFloat(lng.toFixed(5)),
          radius: activeRadius,
          name: placeName
        }

        onPinsChange([...pins, newPin])
        setSelectedPinId(newPinId)
      })

      // Initial render of existing pins
      renderPinsOnMap(L, pins)
    }

    init()

    return () => {
      isCancelled = true
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }
    }
  }, [])

  // Sync markers and radius circles when pins change
  useEffect(() => {
    if (!mapInstanceRef.current) return
    import('leaflet').then((leafletModule) => {
      renderPinsOnMap(leafletModule.default, pins)
    })
  }, [pins, selectedPinId])

  const renderPinsOnMap = (L: any, currentPins: DroppedPin[]) => {
    if (!markersGroupRef.current || !circlesGroupRef.current || !mapInstanceRef.current) return

    markersGroupRef.current.clearLayers()
    circlesGroupRef.current.clearLayers()

    currentPins.forEach((pin, index) => {
      const isSelected = pin.id === selectedPinId

      // Custom marker icon with pin number
      const customIcon = L.divIcon({
        className: 'custom-map-pin',
        html: `
          <div style="
            background: ${isSelected ? '#1d4ed8' : '#2563eb'};
            color: white;
            font-size: 11px;
            font-weight: 800;
            width: 28px;
            height: 28px;
            border-radius: 50% 50% 50% 0;
            transform: rotate(-45deg);
            display: flex;
            align-items: center;
            justify-content: center;
            border: 2px solid white;
            box-shadow: 0 4px 10px rgba(0,0,0,0.3);
            cursor: grab;
          ">
            <span style="transform: rotate(45deg);">${index + 1}</span>
          </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 28]
      })

      const marker = L.marker([pin.latitude, pin.longitude], {
        icon: customIcon,
        draggable: true
      })

      // Drag listener to update pin coords
      marker.on('dragend', async (e: any) => {
        const newCoords = e.target.getLatLng()
        let updatedName = pin.name
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${newCoords.lat}&lon=${newCoords.lng}`)
          const data = await res.json()
          if (data && data.display_name) {
            const parts = data.display_name.split(',').map((p: string) => p.trim())
            updatedName = parts.slice(0, 3).join(', ')
          }
        } catch (err) {}

        const updatedPins = pins.map(p => p.id === pin.id ? {
          ...p,
          latitude: parseFloat(newCoords.lat.toFixed(5)),
          longitude: parseFloat(newCoords.lng.toFixed(5)),
          name: updatedName
        } : p)
        onPinsChange(updatedPins)
      })

      marker.on('click', () => {
        setSelectedPinId(pin.id)
        setActiveRadius(pin.radius)
      })

      marker.addTo(markersGroupRef.current)

      // Radius Circle overlay
      const circle = L.circle([pin.latitude, pin.longitude], {
        radius: pin.radius * 1000, // convert km to meters
        color: isSelected ? '#2563eb' : '#3b82f6',
        fillColor: isSelected ? '#3b82f6' : '#60a5fa',
        fillOpacity: isSelected ? 0.28 : 0.16,
        weight: isSelected ? 2.5 : 1.5,
        dashArray: isSelected ? undefined : '4, 4'
      })

      circle.addTo(circlesGroupRef.current)
    })
  }

  // Search places via Nominatim
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!searchQuery.trim()) return

    setIsSearching(true)
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=5`)
      const data = await res.json()
      setSearchResults(data || [])
    } catch (err) {
      console.error('Location search failed:', err)
    } finally {
      setIsSearching(false)
    }
  }

  const handleSelectSearchResult = (result: any) => {
    const lat = parseFloat(result.lat)
    const lng = parseFloat(result.lon)

    if (mapInstanceRef.current) {
      mapInstanceRef.current.flyTo([lat, lng], 12, { duration: 1 })
    }

    const parts = result.display_name.split(',').map((p: string) => p.trim())
    const shortName = parts.slice(0, 3).join(', ')

    const newPin: DroppedPin = {
      id: `pin_${Date.now()}`,
      latitude: parseFloat(lat.toFixed(5)),
      longitude: parseFloat(lng.toFixed(5)),
      radius: activeRadius,
      name: shortName,
      address: result.display_name
    }

    onPinsChange([...pins, newPin])
    setSelectedPinId(newPin.id)
    setSearchResults([])
    setSearchQuery('')
  }

  const updateRadiusForSelected = (radiusVal: number) => {
    const clamped = Math.max(1, Math.min(80, radiusVal))
    setActiveRadius(clamped)
    if (selectedPinId) {
      const updated = pins.map(p => p.id === selectedPinId ? { ...p, radius: clamped } : p)
      onPinsChange(updated)
    }
  }

  const removePin = (pinId: string) => {
    const updated = pins.filter(p => p.id !== pinId)
    onPinsChange(updated)
    if (selectedPinId === pinId) {
      setSelectedPinId(updated[0]?.id || null)
    }
  }

  return (
    <div className="bg-slate-50 border border-slate-200/80 rounded-2xl overflow-hidden shadow-xs">
      {/* Header & Search */}
      <div className="p-3.5 bg-white border-b border-slate-100 flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center justify-between">
        <form onSubmit={handleSearch} className="relative flex-1">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search address, landmark or area to drop pin..."
            className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 pl-9 pr-9 text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          />
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          {isSearching ? (
            <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-blue-500" />
          ) : (
            <button type="submit" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-blue-600 hover:text-blue-700">
              Go
            </button>
          )}

          {/* Search Dropdown */}
          {searchResults.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1.5 bg-white border border-slate-200 rounded-xl shadow-xl z-[1001] max-h-48 overflow-y-auto">
              {searchResults.map((item, idx) => (
                <div
                  key={idx}
                  onClick={() => handleSelectSearchResult(item)}
                  className="p-2.5 hover:bg-blue-50 cursor-pointer border-b border-slate-50 last:border-none text-left transition-colors"
                >
                  <div className="text-xs font-bold text-slate-800 truncate">{item.display_name.split(',')[0]}</div>
                  <div className="text-[10px] text-slate-400 truncate">{item.display_name}</div>
                </div>
              ))}
            </div>
          )}
        </form>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] font-bold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-100 flex items-center gap-1">
            <Crosshair size={12} className="text-blue-600" /> Click Map to Drop Pin
          </span>
        </div>
      </div>

      {/* Map Canvas */}
      <div className="relative w-full h-[280px] bg-slate-100">
        <div ref={mapContainerRef} className="w-full h-full z-0" />
        
        {/* Floating Instruction Overlay */}
        <div className="absolute top-2.5 right-2.5 z-[400] bg-white/90 backdrop-blur-xs px-2.5 py-1 rounded-lg border border-slate-200 shadow-xs text-[10px] font-semibold text-slate-600 flex items-center gap-1.5 pointer-events-none">
          <Navigation size={11} className="text-blue-500" /> Drag pins to adjust position
        </div>
      </div>

      {/* Radius Controls & Pin List */}
      <div className="p-3.5 bg-white border-t border-slate-100 space-y-3">
        {/* Radius Slider */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-700">Radius for Selected Pin:</span>
            <div className="flex items-center gap-1 bg-white border border-slate-200 px-2 py-0.5 rounded-lg shadow-xs">
              <input
                type="number"
                min={1}
                max={80}
                value={activeRadius}
                onChange={(e) => updateRadiusForSelected(parseInt(e.target.value) || 1)}
                className="w-10 text-center text-xs font-bold text-blue-600 bg-transparent outline-none"
              />
              <span className="text-[10px] font-bold text-slate-400">km</span>
            </div>
            <span className="text-[10px] text-slate-400 font-medium">(Meta supports 1 - 80 km)</span>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-48">
            <input
              type="range"
              min={1}
              max={80}
              value={activeRadius}
              onChange={(e) => updateRadiusForSelected(parseInt(e.target.value))}
              className="w-full accent-blue-600 cursor-pointer h-1.5 bg-slate-200 rounded-lg"
            />
            <span className="text-xs font-extrabold text-blue-600 min-w-[36px] text-right">{activeRadius} km</span>
          </div>
        </div>

        {/* Dropped Pins List */}
        {pins.length > 0 ? (
          <div className="space-y-1.5">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
              <span>Dropped Pins ({pins.length})</span>
              <span className="text-[9px] text-slate-400 font-normal">Click a pin to adjust its radius</span>
            </div>
            <div className="flex flex-wrap gap-2 max-h-28 overflow-y-auto pr-1">
              {pins.map((pin, idx) => {
                const isSelected = pin.id === selectedPinId
                return (
                  <div
                    key={pin.id}
                    onClick={() => {
                      setSelectedPinId(pin.id)
                      setActiveRadius(pin.radius)
                      if (mapInstanceRef.current) {
                        mapInstanceRef.current.panTo([pin.latitude, pin.longitude])
                      }
                    }}
                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-blue-50 border-blue-300 text-blue-900 shadow-xs'
                        : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300'
                    }`}
                  >
                    <span className="w-4 h-4 rounded-full bg-blue-600 text-white text-[9px] flex items-center justify-center font-extrabold">
                      {idx + 1}
                    </span>
                    <span className="truncate max-w-[160px]">{pin.name}</span>
                    <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-md font-bold">
                      {pin.radius} km
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        removePin(pin.id)
                      }}
                      className="text-slate-400 hover:text-red-500 font-black ml-0.5 p-0.5"
                    >
                      ×
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="text-center py-2 text-xs text-slate-400 font-medium">
            No pins dropped yet. Click anywhere on the map or search an address above.
          </div>
        )}
      </div>
    </div>
  )
}
