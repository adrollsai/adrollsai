'use client'

import React, { useState, useRef, useEffect, useMemo } from 'react'
import { Search, ChevronDown, Check, X, Tag, Package, Sparkles } from 'lucide-react'
import { getPropertyTags } from '@/utils/property-tags'

export interface ProductSearchableSelectProps {
  products: any[]
  selectedId?: string | null
  selectedIds?: string[]
  mode?: 'single' | 'multi'
  onSelect?: (product: any | null) => void
  onMultiChange?: (products: any[]) => void
  placeholder?: string
  searchPlaceholder?: string
  showBrandOption?: boolean
  brandOptionLabel?: string
  brandOptionDescription?: string
  variant?: 'compact' | 'modal' | 'amber'
  disabled?: boolean
  isLoading?: boolean
  className?: string
}

export default function ProductSearchableSelect({
  products = [],
  selectedId,
  selectedIds = [],
  mode = 'single',
  onSelect,
  onMultiChange,
  placeholder = '-- Attach Product --',
  searchPlaceholder = 'Search products or tags...',
  showBrandOption = false,
  brandOptionLabel = 'Brand / Custom Mode',
  brandOptionDescription = 'No product • Custom instructions & business info',
  variant = 'compact',
  disabled = false,
  isLoading = false,
  className = '',
}: ProductSearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      // Focus search input on open
      setTimeout(() => {
        searchInputRef.current?.focus()
      }, 50)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Reset search when closed
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('')
    }
  }, [isOpen])

  // Filtered products with tags
  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return products.map(p => {
      const tags = getPropertyTags(p)
      return {
        ...p,
        _tags: tags
      }
    }).filter(p => {
      if (!q) return true
      const titleMatch = (p.title || p.name || '').toLowerCase().includes(q)
      const addressMatch = (p.address || '').toLowerCase().includes(q)
      const tagsMatch = p._tags.some((t: string) => t.toLowerCase().includes(q))
      return titleMatch || addressMatch || tagsMatch
    })
  }, [products, searchQuery])

  // Find currently selected single product
  const selectedProduct = useMemo(() => {
    if (!selectedId) return null
    return products.find(p => p.id === selectedId) || null
  }, [products, selectedId])

  const selectedTags = useMemo(() => {
    return selectedProduct ? getPropertyTags(selectedProduct) : []
  }, [selectedProduct])

  // Single select handler
  const handleSingleSelect = (product: any | null) => {
    onSelect?.(product)
    setIsOpen(false)
  }

  // Multi select toggle handler
  const handleMultiToggle = (product: any) => {
    const isCurrentlySelected = selectedIds.includes(product.id)
    let newSelected: any[]
    if (isCurrentlySelected) {
      newSelected = products.filter(p => selectedIds.includes(p.id) && p.id !== product.id)
    } else {
      const already = products.filter(p => selectedIds.includes(p.id))
      newSelected = [...already, product]
    }
    onMultiChange?.(newSelected)
  }

  const handleClearAll = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (mode === 'single') {
      onSelect?.(null)
    } else {
      onMultiChange?.([])
    }
  }

  // Color schemes according to variant
  const isCompact = variant === 'compact'
  const isAmber = variant === 'amber'
  const isModal = variant === 'modal'

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      {/* TRIGGER BUTTON */}
      {isCompact && (
        <div
          onClick={() => !disabled && !isLoading && setIsOpen(!isOpen)}
          className={`flex items-center justify-between w-full h-full min-h-[38px] px-3 py-1.5 rounded-[1rem] border transition-all cursor-pointer select-none ${
            disabled ? 'opacity-60 cursor-not-allowed bg-slate-100 border-slate-200' :
            selectedProduct 
              ? 'bg-blue-50/80 hover:bg-blue-100/70 border-blue-200 text-blue-950 shadow-xs ring-1 ring-blue-500/10'
              : 'bg-blue-50/50 hover:bg-blue-100/50 border-blue-100 text-blue-900'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1 mr-1">
            {selectedProduct ? (
              selectedProduct.image_url || (selectedProduct.images && selectedProduct.images[0]) ? (
                <img
                  src={selectedProduct.image_url || selectedProduct.images[0]}
                  alt=""
                  className="w-5 h-5 rounded-full object-cover shrink-0 border border-blue-200"
                />
              ) : (
                <Package size={14} className="text-blue-600 shrink-0" />
              )
            ) : (
              <Package size={14} className="text-blue-500 shrink-0" />
            )}

            <div className="min-w-0 flex-1 truncate text-left">
              <span className="text-[11px] font-bold truncate block">
                {selectedProduct ? selectedProduct.title : (isLoading ? 'Loading catalog...' : placeholder)}
              </span>
              {selectedProduct && selectedTags.length > 0 && (
                <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                  {selectedTags.slice(0, 2).map((tag, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-0.5 text-[8.5px] font-bold bg-blue-100 text-blue-800 px-1.5 py-0.2 rounded"
                    >
                      <Tag size={8} /> {tag}
                    </span>
                  ))}
                  {selectedTags.length > 2 && (
                    <span className="text-[8.5px] font-bold text-blue-600">+{selectedTags.length - 2}</span>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0 ml-1">
            {selectedProduct && !disabled && (
              <button
                type="button"
                onClick={handleClearAll}
                className="p-1 hover:bg-blue-200/70 rounded-full text-blue-600 hover:text-blue-900 transition-colors"
                title="Clear attached product"
              >
                <X size={12} />
              </button>
            )}
            <ChevronDown size={14} className={`text-blue-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </div>
        </div>
      )}

      {isModal && (
        <div
          onClick={() => !disabled && !isLoading && setIsOpen(!isOpen)}
          className={`flex items-center justify-between w-full p-3.5 sm:p-4 rounded-2xl border-2 transition-all cursor-pointer bg-white ${
            disabled ? 'opacity-60 cursor-not-allowed border-slate-200' :
            selectedProduct
              ? 'border-blue-500 bg-blue-50/30 ring-4 ring-blue-500/10 shadow-sm'
              : 'border-slate-200 hover:border-blue-400 hover:bg-slate-50/50'
          }`}
        >
          <div className="flex items-center gap-3.5 min-w-0 flex-1 mr-2">
            {selectedProduct ? (
              <div className="relative w-12 h-12 rounded-xl overflow-hidden shrink-0 border border-blue-200 shadow-xs">
                {selectedProduct.image_url || (selectedProduct.images && selectedProduct.images[0]) ? (
                  <img
                    src={selectedProduct.image_url || selectedProduct.images[0]}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-blue-100 flex items-center justify-center text-blue-600">
                    <Package size={20} />
                  </div>
                )}
              </div>
            ) : (
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-blue-500/20">
                <Sparkles size={20} />
              </div>
            )}

            <div className="min-w-0 flex-1 text-left">
              <div className="flex items-center gap-2">
                <span className="text-sm font-extrabold text-slate-900 truncate">
                  {selectedProduct ? selectedProduct.title : (showBrandOption ? brandOptionLabel : placeholder)}
                </span>
                {selectedProduct?.price && (
                  <span className="text-xs font-black text-emerald-600 shrink-0 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                    {selectedProduct.price}
                  </span>
                )}
              </div>
              <p className="text-[11px] font-medium text-slate-500 truncate mt-0.5">
                {selectedProduct
                  ? (selectedProduct.address || 'Selected Inventory Item')
                  : (showBrandOption ? brandOptionDescription : 'Click to select an inventory product')}
              </p>
              {selectedProduct && selectedTags.length > 0 && (
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  {selectedTags.map((tag, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center gap-1 text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200/80 px-2 py-0.5 rounded-md"
                    >
                      <Tag size={10} className="text-blue-500" /> {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {selectedProduct && (
              <button
                type="button"
                onClick={handleClearAll}
                className="text-[11px] font-bold text-blue-600 hover:text-blue-800 hover:underline px-2 py-1 rounded-lg hover:bg-blue-50 transition-all"
              >
                Clear
              </button>
            )}
            <div className={`p-2 rounded-xl bg-slate-100 text-slate-500 transition-transform ${isOpen ? 'rotate-180 bg-blue-50 text-blue-600' : ''}`}>
              <ChevronDown size={16} />
            </div>
          </div>
        </div>
      )}

      {isAmber && (
        <div
          onClick={() => !disabled && !isLoading && setIsOpen(!isOpen)}
          className={`flex items-center justify-between w-full p-3.5 rounded-2xl border transition-all cursor-pointer bg-white ${
            disabled ? 'opacity-60 cursor-not-allowed border-amber-200' :
            selectedIds.length > 0
              ? 'border-amber-400 ring-4 ring-amber-500/10 shadow-sm'
              : 'border-amber-200 hover:border-amber-400'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0 flex-1 mr-2">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
              selectedIds.length > 0 ? 'bg-amber-500 text-white shadow-sm shadow-amber-500/30' : 'bg-amber-100 text-amber-700'
            }`}>
              <Package size={18} />
            </div>
            <div className="min-w-0 flex-1 text-left">
              <span className="text-xs font-extrabold text-slate-900 truncate block">
                {selectedIds.length > 0
                  ? `${selectedIds.length} Product${selectedIds.length > 1 ? 's' : ''} Selected`
                  : 'Select Products from Inventory (Optional)'}
              </span>
              <span className="text-[10px] font-semibold text-amber-700 block truncate mt-0.5">
                {selectedIds.length > 0
                  ? 'Click to modify selection or search inventory'
                  : 'Optional • Leave blank to promote general business / brand'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {selectedIds.length > 0 && (
              <button
                type="button"
                onClick={handleClearAll}
                className="text-[10px] font-bold text-amber-700 hover:text-amber-950 underline px-1.5 py-0.5"
              >
                Clear All
              </button>
            )}
            <div className={`p-1.5 rounded-lg bg-amber-50 text-amber-700 transition-transform ${isOpen ? 'rotate-180 bg-amber-100' : ''}`}>
              <ChevronDown size={14} />
            </div>
          </div>
        </div>
      )}

      {/* DROPDOWN POPUP */}
      {isOpen && (
        <div className="absolute left-0 right-0 top-full mt-2 z-[150] bg-white rounded-2xl shadow-2xl border border-slate-200/90 overflow-hidden animate-in fade-in zoom-in-95 duration-200 min-w-[300px]">
          {/* SEARCH HEADER */}
          <div className="p-3 border-b border-slate-100 bg-slate-50/80 sticky top-0 z-10 flex items-center gap-2">
            <Search size={15} className="text-slate-400 shrink-0 ml-1" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent border-none text-xs font-bold text-slate-800 placeholder-slate-400 outline-none pr-2"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="p-1 hover:bg-slate-200/70 rounded-full text-slate-400 hover:text-slate-600 transition-colors shrink-0"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* LIST ITEMS */}
          <div className="max-h-72 overflow-y-auto divide-y divide-slate-100/70 custom-scrollbar p-1">
            {/* BRAND / CUSTOM OPTION (FOR SINGLE SELECT / BATCH MODE) */}
            {showBrandOption && mode === 'single' && (
              <div
                onClick={() => handleSingleSelect(null)}
                className={`p-3 rounded-xl cursor-pointer transition-all flex items-center justify-between gap-3 ${
                  selectedProduct === null
                    ? 'bg-blue-50/90 text-blue-950 font-bold border border-blue-200/60'
                    : 'hover:bg-slate-50 text-slate-700'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`p-2 rounded-xl shrink-0 ${
                    selectedProduct === null ? 'bg-blue-600 text-white shadow-xs' : 'bg-slate-100 text-slate-600'
                  }`}>
                    <Sparkles size={16} />
                  </div>
                  <div className="min-w-0 text-left">
                    <div className="text-xs font-extrabold text-slate-900 leading-tight flex items-center gap-1.5">
                      {brandOptionLabel}
                      <span className="text-[9px] font-black uppercase tracking-wider bg-indigo-50 text-indigo-700 px-1.5 py-0.2 rounded border border-indigo-100">
                        Default
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500 font-medium truncate mt-0.5">
                      {brandOptionDescription}
                    </div>
                  </div>
                </div>
                {selectedProduct === null && (
                  <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0">
                    <Check size={12} />
                  </div>
                )}
              </div>
            )}

            {/* CLEAR / NO PRODUCT OPTION (FOR SINGLE SELECT WITHOUT BRAND MODE) */}
            {!showBrandOption && mode === 'single' && (
              <div
                onClick={() => handleSingleSelect(null)}
                className={`p-2.5 rounded-xl cursor-pointer transition-all flex items-center justify-between gap-2.5 ${
                  selectedProduct === null
                    ? 'bg-blue-50/80 text-blue-900 font-bold'
                    : 'hover:bg-slate-50 text-slate-600'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0 text-left">
                  <div className="p-1.5 rounded-lg bg-slate-100 text-slate-400 shrink-0">
                    <X size={14} />
                  </div>
                  <span className="text-xs font-bold text-slate-600">-- None / Clear Attached Product --</span>
                </div>
                {selectedProduct === null && <Check size={14} className="text-blue-600 shrink-0 mr-1" />}
              </div>
            )}

            {/* PRODUCT ROWS */}
            {filteredProducts.length === 0 ? (
              <div className="p-5 text-center">
                <Package size={24} className="mx-auto text-slate-300 mb-1.5" />
                <p className="text-xs font-semibold text-slate-500">
                  {searchQuery ? `No products matching "${searchQuery}"` : 'No products found'}
                </p>
              </div>
            ) : (
              filteredProducts.map((p: any) => {
                const isSelected = mode === 'single'
                  ? selectedId === p.id
                  : selectedIds.includes(p.id)
                const tags: string[] = p._tags || []

                return (
                  <div
                    key={p.id}
                    onClick={() => {
                      if (mode === 'single') {
                        handleSingleSelect(p)
                      } else {
                        handleMultiToggle(p)
                      }
                    }}
                    className={`p-2.5 sm:p-3 rounded-xl cursor-pointer transition-all flex items-center justify-between gap-3 ${
                      isSelected
                        ? isAmber
                          ? 'bg-amber-50/80 border border-amber-200/80'
                          : 'bg-blue-50/80 border border-blue-200/80'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {mode === 'multi' && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          readOnly
                          className="rounded text-amber-600 focus:ring-amber-500 h-4 w-4 border-slate-300 cursor-pointer shrink-0"
                        />
                      )}

                      {/* Thumbnail */}
                      <div className="w-10 h-10 rounded-xl overflow-hidden bg-slate-100 shrink-0 border border-slate-200/80 flex items-center justify-center">
                        {p.image_url || (p.images && p.images[0]) ? (
                          <img
                            src={p.image_url || p.images[0]}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <Package size={16} className="text-slate-400" />
                        )}
                      </div>

                      {/* Product details & internal tags */}
                      <div className="min-w-0 flex-1 text-left">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-bold text-slate-900 truncate">
                            {p.title || p.name || 'Untitled Product'}
                          </span>
                          {p.price && (
                            <span className="text-[10px] font-extrabold text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-100 shrink-0">
                              {p.price}
                            </span>
                          )}
                        </div>

                        {p.address && (
                          <div className="text-[10px] text-slate-400 truncate mt-0.5">
                            {p.address}
                          </div>
                        )}

                        {/* INTERNAL TAGS ROW */}
                        {tags.length > 0 && (
                          <div className="flex items-center gap-1 mt-1 flex-wrap">
                            {tags.map((tag, tIdx) => (
                              <span
                                key={tIdx}
                                className={`inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                                  isAmber
                                    ? 'bg-amber-100/70 text-amber-800 border-amber-200'
                                    : 'bg-indigo-50 text-indigo-700 border-indigo-100'
                                }`}
                              >
                                <Tag size={8} /> {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {mode === 'single' && isSelected && (
                      <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0">
                        <Check size={12} />
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>

          {/* FOOTER SUMMARY */}
          <div className="px-3 py-2 border-t border-slate-100 bg-slate-50 text-[10px] font-medium text-slate-400 flex justify-between items-center">
            <span>{filteredProducts.length} of {products.length} products available</span>
            {mode === 'multi' && (
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-[10px] font-bold text-blue-600 hover:text-blue-800"
              >
                Done
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
