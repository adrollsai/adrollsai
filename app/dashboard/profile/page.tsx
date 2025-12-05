'use client'

import { useState, useEffect, useRef } from 'react'
import { Save, Upload, Loader2, Facebook, Linkedin, LogOut, CheckCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'

type FBPage = { id: string, name: string, access_token: string }

export default function ProfilePage() {
  const router = useRouter()
  const { data: session, isPending } = authClient.useSession()
  
  const [loading, setLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [providers, setProviders] = useState<string[]>([])
  
  // Facebook Page Logic
  const [fbPages, setFbPages] = useState<FBPage[]>([])
  const [selectedPageId, setSelectedPageId] = useState<string>('')
  const [loadingPages, setLoadingPages] = useState(false)

  const [formData, setFormData] = useState({
    businessName: '',
    mission: '',
    color: '#D0E8FF',
    contact: '',
    logoUrl: '',
  })

  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadProfile = async () => {
    try {
      const res = await fetch('/api/profile');
      if (res.ok) {
        const data = await res.json();
        setFormData({
          businessName: data.businessName || '',
          mission: data.missionStatement || '',
          color: data.brandColor || '#D0E8FF',
          contact: data.contactNumber || '',
          logoUrl: data.logoUrl || '',
        });
        if (data.providers) setProviders(data.providers);
        if (data.selectedPageId) setSelectedPageId(data.selectedPageId);
        
        // If Facebook is connected, fetch pages immediately
        if (data.providers && data.providers.includes('facebook')) {
            fetchFbPages();
        }
      }
    } catch (e) {
      console.error("Profile load failed", e);
    } finally {
      setLoading(false);
    }
  }

  const fetchFbPages = async () => {
      setLoadingPages(true);
      try {
          const res = await fetch('/api/facebook/pages');
          const data = await res.json();
          if (data.pages) setFbPages(data.pages);
      } catch(e) { console.error(e) } 
      finally { setLoadingPages(false); }
  }

  const handlePageSelect = async (pageId: string) => {
      const page = fbPages.find(p => p.id === pageId);
      if (!page) return;
      
      setSelectedPageId(pageId);
      
      // Save the Page Token to your 'user' table
      await fetch('/api/profile', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
              ...formData, 
              // These fields match the schema update you did earlier
              // We pass them as custom fields to be handled by the PUT route
              selectedPageId: page.id,
              selectedPageName: page.name,
              selectedPageToken: page.access_token 
          })
      });
  }

  // Update PUT in api/profile/route.ts to handle these new fields!
  // (I will provide the snippet for that below this code block)

  useEffect(() => {
    if (session) loadProfile();
  }, [session]);

  const handleConnect = async (provider: 'facebook' | 'linkedin') => {
    await authClient.linkSocial({
      provider: provider,
      callbackURL: "/dashboard/profile",
    })
  }

  const handleDisconnect = async (provider: string) => {
    if(!confirm(`Disconnect ${provider}?`)) return;
    await fetch(`/api/profile?provider=${provider}`, { method: 'DELETE' });
    await loadProfile();
    if(provider === 'facebook') { setFbPages([]); setSelectedPageId(''); }
  }

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    const file = e.target.files[0];
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (data.url) {
        setFormData(prev => ({ ...prev, logoUrl: data.url }));
        await fetch('/api/profile', { method: 'PUT', body: JSON.stringify({ ...formData, logoUrl: data.url }) });
      }
    } catch (err) { alert("Upload failed"); }
  };

  const handleSave = async () => {
    setIsSaving(true);
    await fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formData) });
    setIsSaving(false);
    alert("Saved!");
  };

  const handleSignOut = async () => {
    await authClient.signOut();
    router.push('/');
  };

  if (isPending || loading) return <div className="p-10 text-center"><Loader2 className="animate-spin inline" /> Loading...</div>

  return (
    <div className="p-5 max-w-md mx-auto min-h-screen pb-32">
      {/* Header */}
      <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 mb-6 flex flex-col items-center text-center">
        <div onClick={() => fileInputRef.current?.click()} className="w-24 h-24 bg-slate-50 rounded-full mb-3 flex items-center justify-center overflow-hidden relative cursor-pointer border-2 border-dashed border-slate-200 hover:border-blue-300 transition-all">
          {formData.logoUrl ? <img src={formData.logoUrl} className="w-full h-full object-cover" /> : <Upload size={24} className="text-slate-300" />}
          <input type="file" ref={fileInputRef} onChange={handleLogoUpload} className="hidden" />
        </div>
        <h2 className="text-xl font-bold text-slate-800">{formData.businessName || 'Your Business'}</h2>
      </div>

      {/* Social Accounts */}
      <div className="mb-6 bg-white p-5 rounded-[2rem] shadow-sm border border-slate-100">
        <h3 className="text-xs font-bold text-slate-400 uppercase mb-4">Connected Accounts</h3>
        <div className="space-y-4">
            
            {/* Facebook Section */}
            <div>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="bg-[#1877F2] text-white p-2 rounded-full"><Facebook size={16}/></div> 
                        <span className="text-sm font-bold text-slate-700">Facebook</span>
                    </div>
                    {providers.includes('facebook') ? (
                        <button onClick={() => handleDisconnect('facebook')} className="text-xs text-red-400 hover:text-red-500 font-medium">Disconnect</button>
                    ) : (
                        <button onClick={() => handleConnect('facebook')} className="text-xs bg-slate-900 text-white px-3 py-1.5 rounded-lg font-bold">Connect</button>
                    )}
                </div>

                {/* Page Selector (Only shows if FB is connected) */}
                {providers.includes('facebook') && (
                    <div className="mt-3 pl-11">
                        <p className="text-[10px] font-bold text-slate-400 uppercase mb-2">Posting Page</p>
                        {loadingPages ? <div className="text-xs text-slate-400"><Loader2 className="animate-spin inline mr-1" size={12}/> Loading Pages...</div> : 
                         fbPages.length === 0 ? <div className="text-xs text-slate-400">No pages found.</div> : (
                            <div className="space-y-2 max-h-40 overflow-y-auto">
                                {fbPages.map(page => (
                                    <button 
                                        key={page.id} 
                                        onClick={() => handlePageSelect(page.id)}
                                        className={`w-full flex items-center justify-between p-2 rounded-lg text-left text-xs border ${selectedPageId === page.id ? 'border-green-500 bg-green-50 text-green-700' : 'border-slate-100 text-slate-600 hover:bg-slate-50'}`}
                                    >
                                        <span className="truncate">{page.name}</span>
                                        {selectedPageId === page.id && <CheckCircle size={14}/>}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* LinkedIn */}
            <div className="flex items-center justify-between border-t border-slate-50 pt-3">
                <div className="flex items-center gap-3">
                    <div className="bg-[#0077b5] text-white p-2 rounded-full"><Linkedin size={16}/></div> 
                    <span className="text-sm font-bold text-slate-700">LinkedIn</span>
                </div>
                {providers.includes('linkedin') ? (
                    <button onClick={() => handleDisconnect('linkedin')} className="text-xs text-red-400 hover:text-red-500 font-medium">Disconnect</button>
                ) : (
                    <button onClick={() => handleConnect('linkedin')} className="text-xs bg-slate-900 text-white px-3 py-1.5 rounded-lg font-bold">Connect</button>
                )}
            </div>

        </div>
      </div>

      {/* Form (Same as before) */}
      <div className="bg-white p-5 rounded-[2rem] shadow-sm border border-blue-100 space-y-4">
        <div>
            <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Business Name</label>
            <input type="text" value={formData.businessName} onChange={e => setFormData({...formData, businessName: e.target.value})} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-sm focus:ring-2 focus:ring-blue-200 outline-none" />
        </div>
        <div>
            <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Contact Number</label>
            <input type="text" value={formData.contact} onChange={e => setFormData({...formData, contact: e.target.value})} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-sm focus:ring-2 focus:ring-blue-200 outline-none" />
        </div>
        <div>
            <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Mission / Bio</label>
            <textarea value={formData.mission} onChange={e => setFormData({...formData, mission: e.target.value})} rows={3} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-sm focus:ring-2 focus:ring-blue-200 outline-none" />
        </div>
        
        <button onClick={handleSave} disabled={isSaving} className="w-full bg-slate-900 text-white py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2">
            {isSaving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />} Save Changes
        </button>
      </div>

      <div className="mt-6">
        <button onClick={handleSignOut} className="w-full bg-red-50 text-red-500 py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2">
            <LogOut size={16} /> Sign Out
        </button>
      </div>
    </div>
  )
}