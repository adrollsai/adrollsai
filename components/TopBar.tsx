'use client'

import { useOrganization } from '@/components/OrganizationWrapper'
import NotificationSystem from '@/components/NotificationSystem'
import WalletHeader from '@/components/WalletHeader'
import { Building2, Menu } from 'lucide-react'

export default function TopBar() {
    const { org, userRole } = useOrganization()

    const handleRefresh = () => {
        window.location.reload();
    };

    return (
        <header className="fixed top-0 left-0 right-0 h-16 bg-white/95 backdrop-blur-md border-b border-slate-200 z-[50] px-4 md:px-6 flex items-center justify-between shadow-sm">
            
            {/* LEFT: Identity (Logo + Name) */}
            <div className="flex items-center gap-3">
                {/* Organization Logo - Click to Refresh */}
                <div 
                    onClick={handleRefresh}
                    className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center overflow-hidden border border-slate-200 shadow-sm cursor-pointer active:scale-95 transition-transform"
                    title="Click to refresh page"
                >
                    {org?.master_logo_url ? (
                        <img src={org.master_logo_url} className="w-full h-full object-contain p-1.5" alt="Logo" />
                    ) : (
                        <Building2 className="text-slate-400" size={20} />
                    )}
                </div>

                {/* Organization Name & Role */}
                <div className="flex flex-col">
                    <h1 className="text-sm font-black text-slate-900 leading-tight">
                        {org?.name || 'AdRolls AI'}
                    </h1>
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide bg-slate-100 px-1.5 py-0.5 rounded-md self-start mt-0.5">
                        {userRole === 'admin' ? 'Builder Console' : 'Agent Workspace'}
                    </span>
                </div>
            </div>

            {/* RIGHT: Utilities (Notifications + Wallet) */}
            <div className="flex items-center gap-4">
                <WalletHeader />
                <NotificationSystem />
            </div>
        </header>
    )
}