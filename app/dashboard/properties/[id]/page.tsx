'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Users, Plus, Loader2, CheckCircle, Shield, RefreshCw, FileText, Upload, CalendarRange, X, AlertTriangle, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'

export default function PropertyFractionManager() {
  const supabase = createClient()
  const params = useParams()
  const router = useRouter()
  
  const propertyId = params.id as string

  // State
  const [loading, setLoading] = useState(true)
  const [property, setProperty] = useState<any>(null)
  const [fractions, setFractions] = useState<any[]>([])
  
  // Assign Modal State
  const [selectedFraction, setSelectedFraction] = useState<any>(null)
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false)
  const [newCustomer, setNewCustomer] = useState({ name: '', email: '', password: '', phone: '' })
  const [creatingUser, setCreatingUser] = useState(false)

  // Document Modal State
  const [isDocModalOpen, setIsDocModalOpen] = useState(false)
  const [uploadingDoc, setUploadingDoc] = useState(false)
  const [docName, setDocName] = useState('')

  // 1. Fetch Data (Using the "Bulletproof" Database Function)
  const fetchData = async () => {
    setLoading(true)
    try {
        // A. Fetch Basic Property Info
        const { data: prop, error: propError } = await supabase
            .from('properties')
            .select('*')
            .eq('id', propertyId)
            .single()
        
        if (propError) throw propError
        setProperty(prop)

        // B. Fetch Fractions using the RPC Function (Bypasses RLS)
        const { data: rawFractions, error: rpcError } = await supabase
            .rpc('get_property_fractions_admin', { target_property_id: propertyId })

        if (rpcError) throw rpcError

        // C. Map the flat RPC data back to the nested structure our UI expects
        const formattedFractions = (rawFractions || []).map((row: any) => ({
            id: row.fraction_id,
            fraction_number: row.fraction_number,
            status: row.status,
            // Reconstruct nested object for compatibility
            customer_holdings: row.owner_email ? [{
                profiles: {
                    business_name: row.owner_name,
                    email: row.owner_email
                },
                documents: row.documents || []
            }] : []
        }))

        setFractions(formattedFractions)

    } catch (e: any) {
        console.error("Fetch Error:", e)
        alert("Error loading data: " + e.message)
    } finally {
        setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [])

  // 2. Initialize Fractions
  const handleInitialize = async () => {
    if (!confirm("Generate 11 fractions for this unit?")) return;
    setLoading(true)
    
    const inserts = []
    for (let i = 1; i <= 11; i++) {
        inserts.push({
            property_id: propertyId,
            fraction_number: i,
            name: `Share ${i}`,
            status: 'available'
        })
    }
    
    const { error } = await supabase.from('fractions').insert(inserts)
    
    if (error) alert("Failed: " + error.message)
    else fetchData()
    setLoading(false)
  }

  // 3. Create & Assign Customer
  const handleCreateAndAssign = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreatingUser(true)

    try {
        // A. Create User via API (Auth requires server-side)
        const res = await fetch('/api/admin/create-customer', {
            method: 'POST',
            body: JSON.stringify({ ...newCustomer, organization_id: property.organization_id })
        })

        if (!res.ok) throw new Error(await res.text())
        const data = await res.json()
        if (!data.success) throw new Error(data.error)

        // B. Create Holding
        const { error: holdingError } = await supabase.from('customer_holdings').insert({
            user_id: data.user.id,
            fraction_id: selectedFraction.id,
            purchase_price: 0, 
            documents: [] 
        })
        if (holdingError) throw holdingError

        // C. Update Status
        await supabase.from('fractions').update({ status: 'sold' }).eq('id', selectedFraction.id)

        alert("Customer Assigned!")
        setIsAssignModalOpen(false)
        setNewCustomer({ name: '', email: '', password: '', phone: '' })
        fetchData() // Refresh using RPC

    } catch (error: any) {
        alert("Error: " + error.message)
    } finally {
        setCreatingUser(false)
    }
  }

  // 4. Force Reset (Deep Clean)
  const handleResetFraction = async (fracId: string) => {
      if (!confirm("Are you sure? This will WIPE all data for this share.")) return
      
      setLoading(true)
      try {
          // A. Find Holding
          const { data: holding } = await supabase
            .from('customer_holdings')
            .select('id')
            .eq('fraction_id', fracId)
            .single()

          if (holding) {
              // B. Delete Dependencies
              await Promise.all([
                  supabase.from('fraction_bookings').delete().eq('holding_id', holding.id),
                  supabase.from('quarterly_preferences').delete().eq('holding_id', holding.id)
              ])

              // C. Delete Holding
              await supabase.from('customer_holdings').delete().eq('id', holding.id)
          }

          // D. Reset Status
          await supabase.from('fractions').update({ status: 'available' }).eq('id', fracId)

          alert("Reset Successful.")
          fetchData()

      } catch (error: any) {
          alert("Reset Failed: " + error.message)
      } finally {
          setLoading(false)
      }
  }

  // 5. Handle Document Upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files || e.target.files.length === 0) return
      if (!docName) {
          alert("Please enter a Document Name first")
          e.target.value = ''
          return
      }

      setUploadingDoc(true)
      const file = e.target.files[0]
      const fileExt = file.name.split('.').pop()
      const fileName = `${selectedFraction.id}-${Date.now()}.${fileExt}`
      const filePath = `${fileName}`

      try {
        const { error: uploadError } = await supabase.storage
            .from('fraction-documents')
            .upload(filePath, file)

        if (uploadError) throw uploadError

        const { data: { publicUrl } } = supabase.storage.from('fraction-documents').getPublicUrl(filePath)
        
        // Use standard query for update (RLS usually allows admins to update)
        const { data: holding } = await supabase
            .from('customer_holdings')
            .select('id, documents')
            .eq('fraction_id', selectedFraction.id)
            .single()

        if (!holding) throw new Error("Holding not found")

        const currentDocs = holding.documents || []
        const newDoc = { name: docName, url: publicUrl, type: 'pdf', path: filePath }
        
        const { error: dbError } = await supabase
            .from('customer_holdings')
            .update({ documents: [...currentDocs, newDoc] })
            .eq('id', holding.id)
            
        if (dbError) throw dbError

        alert("Document Uploaded!")
        setDocName('')
        setIsDocModalOpen(false)
        fetchData()

      } catch (error: any) {
          alert("Upload Failed: " + error.message)
      } finally {
          setUploadingDoc(false)
      }
  }

  // Helper to safely get profile info
  const getOwnerInfo = (frac: any) => {
      const holding = frac.customer_holdings?.[0]
      if (!holding) return null
      
      let profile = holding.profiles
      // Handle array or object
      if (Array.isArray(profile)) profile = profile[0]
      
      return profile
  }

  if (loading && !property) return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-slate-400"/></div>

  return (
    <div className="p-6 pb-32 max-w-5xl mx-auto space-y-6">
      
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
            <button onClick={() => router.back()} className="p-2 hover:bg-slate-100 rounded-full">
                <ArrowLeft size={20}/>
            </button>
            <div>
                <h1 className="text-xl font-bold text-slate-900">{property?.title || 'Loading...'}</h1>
                <p className="text-xs text-slate-500">Fractional Ownership Manager</p>
            </div>
        </div>
        
        <div className="flex gap-2">
            <Link href={`/dashboard/properties/${propertyId}/bookings`} className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold flex items-center gap-2 hover:bg-slate-800">
                <CalendarRange size={16} />
                Manage Calendar
            </Link>

            <button onClick={fetchData} className="p-2 bg-slate-100 rounded-full hover:bg-slate-200">
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''}/>
            </button>
        </div>
      </div>

      {/* Initialize Button */}
      {fractions.length === 0 && (
          <div className="bg-blue-50 border border-blue-100 p-8 rounded-2xl text-center space-y-4">
              <Users size={32} className="mx-auto text-blue-500"/>
              <h3 className="text-sm font-bold text-blue-900">No Fractions Yet</h3>
              <button onClick={handleInitialize} className="bg-blue-600 text-white px-6 py-3 rounded-xl text-sm font-bold hover:bg-blue-700 shadow-lg shadow-blue-200">
                  Generate 11 Fractions
              </button>
          </div>
      )}

      {/* Fractions Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {fractions.map((frac) => {
              const holding = frac.customer_holdings?.[0]
              const owner = getOwnerInfo(frac)
              const isSold = frac.status === 'sold' || !!holding
              const docCount = holding?.documents?.length || 0

              return (
                <div key={frac.id} className={`border rounded-xl p-4 transition-all ${isSold ? 'bg-white border-slate-200 shadow-sm' : 'bg-slate-50 border-dashed border-slate-300'}`}>
                    <div className="flex justify-between items-start mb-3">
                        <span className="font-mono text-[10px] font-bold text-slate-400 uppercase tracking-widest">Share {frac.fraction_number}</span>
                        {isSold ? <Shield size={14} className="text-green-600" /> : <span className="w-2 h-2 rounded-full bg-slate-300"/>}
                    </div>
                    
                    {isSold ? (
                        <div className="space-y-3">
                            <div>
                                {owner ? (
                                    <>
                                        <p className="text-sm font-bold text-slate-900">{owner.business_name || owner.email || 'Name Missing'}</p>
                                        <p className="text-[10px] text-slate-500 truncate">{owner.email}</p>
                                    </>
                                ) : (
                                    <div className="flex flex-col gap-2">
                                        <div className="flex items-center gap-2 text-amber-600 bg-amber-50 p-2 rounded-lg">
                                            <AlertTriangle size={14}/>
                                            <p className="text-xs font-bold">Sold, but no owner linked</p>
                                        </div>
                                        {/* RESET BUTTON */}
                                        <button 
                                            onClick={() => handleResetFraction(frac.id)}
                                            className="w-full py-2 bg-red-50 border border-red-100 text-red-600 rounded-lg text-[10px] font-bold hover:bg-red-100 flex items-center justify-center gap-2"
                                        >
                                            <Trash2 size={12}/> Reset (Fix Broken Share)
                                        </button>
                                    </div>
                                )}
                            </div>
                            
                            {owner && (
                                <button 
                                    onClick={() => { setSelectedFraction(frac); setIsDocModalOpen(true); }}
                                    className="w-full py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-100 flex items-center justify-center gap-2"
                                >
                                    <FileText size={14}/> 
                                    {docCount > 0 ? `${docCount} Documents` : 'Upload Docs'}
                                </button>
                            )}
                        </div>
                    ) : (
                        <button 
                            onClick={() => { setSelectedFraction(frac); setIsAssignModalOpen(true); }}
                            className="w-full py-2 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs font-bold hover:border-slate-400 hover:text-slate-900 transition-all flex items-center justify-center gap-2"
                        >
                            <Plus size={14}/> Assign Owner
                        </button>
                    )}
                </div>
              )
          })}
      </div>

      {/* ASSIGN MODAL */}
      {isAssignModalOpen && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
              <div className="bg-white w-full max-w-md rounded-3xl p-6 space-y-5 shadow-2xl">
                  <div className="flex justify-between items-center">
                      <h3 className="font-bold text-lg text-slate-900">Add Owner</h3>
                      <button onClick={() => setIsAssignModalOpen(false)}><X size={20} className="text-slate-400"/></button>
                  </div>
                  <form onSubmit={handleCreateAndAssign} className="space-y-3">
                        <input required className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm" value={newCustomer.name} onChange={e => setNewCustomer({...newCustomer, name: e.target.value})} placeholder="Full Name"/>
                        <input required type="email" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm" value={newCustomer.email} onChange={e => setNewCustomer({...newCustomer, email: e.target.value})} placeholder="Email"/>
                        <input required type="text" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm" value={newCustomer.password} onChange={e => setNewCustomer({...newCustomer, password: e.target.value})} placeholder="Password"/>
                        <input required className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm" value={newCustomer.phone} onChange={e => setNewCustomer({...newCustomer, phone: e.target.value})} placeholder="Phone"/>
                      <button disabled={creatingUser} className="w-full bg-slate-900 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 mt-2">
                          {creatingUser ? <Loader2 className="animate-spin"/> : <CheckCircle size={18}/>} Create Account
                      </button>
                  </form>
              </div>
          </div>
      )}

      {/* DOCUMENT MODAL */}
      {isDocModalOpen && selectedFraction && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
              <div className="bg-white w-full max-w-md rounded-3xl p-6 space-y-6 shadow-2xl">
                  <div className="flex justify-between items-center border-b pb-4">
                      <div>
                        <h3 className="font-bold text-lg text-slate-900">Documents</h3>
                        <p className="text-xs text-slate-500">Share #{selectedFraction.fraction_number}</p>
                      </div>
                      <button onClick={() => setIsDocModalOpen(false)}><X size={20} className="text-slate-400"/></button>
                  </div>

                  <div className="space-y-2 max-h-40 overflow-y-auto">
                      {selectedFraction.customer_holdings[0]?.documents?.map((doc: any, i: number) => (
                          <div key={i} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                              <div className="flex items-center gap-2">
                                  <FileText size={16} className="text-blue-500"/>
                                  <a href={doc.url} target="_blank" className="text-sm font-bold text-slate-700 hover:underline">{doc.name}</a>
                              </div>
                          </div>
                      ))}
                      {(!selectedFraction.customer_holdings[0]?.documents?.length) && (
                          <p className="text-center text-xs text-slate-400 py-2">No documents uploaded yet.</p>
                      )}
                  </div>

                  <div className="bg-slate-50 p-4 rounded-xl border border-dashed border-slate-300 space-y-3">
                      <p className="text-xs font-bold text-slate-500 uppercase">Upload New File</p>
                      <input 
                        className="w-full p-2 bg-white border border-slate-200 rounded-lg text-sm" 
                        placeholder="Document Name"
                        value={docName}
                        onChange={e => setDocName(e.target.value)}
                      />
                      <div className="relative">
                          <input 
                            type="file" 
                            disabled={uploadingDoc || !docName}
                            onChange={handleFileUpload}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                          />
                          <button disabled={uploadingDoc || !docName} className="w-full py-3 bg-white border border-slate-300 rounded-xl text-sm font-bold text-slate-600 flex items-center justify-center gap-2 hover:bg-slate-100 disabled:opacity-50">
                              {uploadingDoc ? <Loader2 className="animate-spin" size={16}/> : <Upload size={16}/>}
                              Select PDF
                          </button>
                      </div>
                  </div>
              </div>
          </div>
      )}

    </div>
  )
}