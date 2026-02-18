import PortalNav from "@/components/PortalNav";
import { Suspense } from "react";
import { Loader2 } from "lucide-react";

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-50 relative selection:bg-slate-900 selection:text-white">
      
      {/* Main Content Area */}
      <main className="pb-32 animate-in fade-in duration-500">
        <Suspense fallback={
            <div className="h-screen flex items-center justify-center">
                <Loader2 className="animate-spin text-slate-300" />
            </div>
        }>
            {children}
        </Suspense>
      </main>
      
      {/* Navigation */}
      <PortalNav />
    </div>
  );
}