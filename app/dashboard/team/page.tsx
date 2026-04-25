'use client'

import { useState, useEffect } from 'react'
import { Users, Plus, Shield, Mail, Phone, Lock, Loader2, UserCheck } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

type TeamMember = {
    id: string;
    business_name: string;
    email: string;
    contact_number: string;
    created_at: string;
}

export default function TeamManagementPage() {
    const supabase = createClient()
    const [team, setTeam] = useState<TeamMember[]>([])
    const [loading, setLoading] = useState(true)
    const [creating, setCreating] = useState(false)
    const [showForm, setShowForm] = useState(false)

    const [formData, setFormData] = useState({
        fullName: '',
        email: '',
        password: '',
        contactNumber: ''
    })

    const fetchTeam = async () => {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return

        const { data } = await supabase
            .from('profiles')
            .select('id, business_name, email, contact_number, created_at')
            .eq('parent_id', user.id)
            .eq('role', 'agent')
            .order('created_at', { ascending: false })

        if (data) setTeam(data)
        setLoading(false)
    }

    useEffect(() => { fetchTeam() }, [])

    const handleCreateAgent = async (e: React.FormEvent) => {
        e.preventDefault()
        setCreating(true)

        try {
            const res = await fetch('/api/team/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            })

            const result = await res.json()
            if (!res.ok) throw new Error(result.error)

            alert("Agent credentials created successfully. They can now log in.")
            setFormData({ fullName: '', email: '', password: '', contactNumber: '' })
            setShowForm(false)
            fetchTeam()
        } catch (error: any) {
            alert(error.message)
        } finally {
            setCreating(false)
        }
    }

    if (loading) return <div className="flex h-screen items-center justify-center"><Loader2 className="animate-spin text-slate-400" /></div>

    return (
        <div className="p-6 max-w-4xl mx-auto pb-24">
            <div className="flex justify-between items-end mb-8">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Team Management</h1>
                    <p className="text-sm text-slate-500 mt-1">Create and manage access for your sales agents.</p>
                </div>
                <button onClick={() => setShowForm(!showForm)} className="bg-slate-900 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-slate-800 transition-colors">
                    {showForm ? 'Cancel' : <><Plus size={16} /> Add Agent</>}
                </button>
            </div>

            {showForm && (
                <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 mb-8 animate-in slide-in-from-top-4">
                    <div className="flex items-center gap-3 mb-6 border-b border-slate-50 pb-4">
                        <div className="bg-blue-50 p-2 rounded-full text-blue-600"><Shield size={20} /></div>
                        <div>
                            <h2 className="font-bold text-slate-800">New Agent Credentials</h2>
                            <p className="text-xs text-slate-400">Agents have restricted CRM and Inventory access.</p>
                        </div>
                    </div>

                    <form onSubmit={handleCreateAgent} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Full Name</label>
                                <input type="text" required value={formData.fullName} onChange={e => setFormData({...formData, fullName: e.target.value})} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-100" />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1">Contact Number</label>
                                <input type="tel" value={formData.contactNumber} onChange={e => setFormData({...formData, contactNumber: e.target.value})} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-100" />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1 flex items-center gap-1"><Mail size={12}/> Login Email</label>
                                <input type="email" required value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-100" />
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 ml-2 block mb-1 flex items-center gap-1"><Lock size={12}/> Initial Password</label>
                                <input type="text" required minLength={6} value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} className="w-full bg-slate-50 py-3 px-4 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-100" />
                            </div>
                        </div>
                        <button type="submit" disabled={creating} className="w-full mt-4 bg-blue-600 text-white py-3 rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors flex justify-center items-center gap-2 disabled:opacity-70">
                            {creating ? <Loader2 size={16} className="animate-spin" /> : <UserCheck size={16} />} Create Account
                        </button>
                    </form>
                </div>
            )}

            <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden">
                <div className="p-4 bg-slate-50/50 border-b border-slate-100 flex items-center gap-2">
                    <Users size={16} className="text-slate-500" />
                    <h3 className="font-bold text-slate-700 text-sm">Active Sales Team</h3>
                </div>
                
                {team.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 text-sm">No agents created yet.</div>
                ) : (
                    <div className="divide-y divide-slate-50">
                        {team.map(member => (
                            <div key={member.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                                <div>
                                    <h4 className="font-bold text-slate-800 text-sm">{member.business_name}</h4>
                                    <p className="text-xs text-slate-400 mt-0.5">{member.email}</p>
                                </div>
                                <div className="text-right">
                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-green-50 text-green-600 text-[10px] font-bold uppercase">Active</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}