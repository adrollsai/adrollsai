import { createClient } from '@/utils/supabase/server';
import { notFound } from 'next/navigation';

export default async function PrivacyPolicyPage({ params }: { params: { id: string } }) {
    const supabase = await createClient();
    const { data: profile } = await supabase.from('profiles').select('business_name, custom_domain').eq('id', params.id).single();

    if (!profile) {
        return notFound();
    }

    const businessName = profile.business_name || 'Our Company';
    const domain = profile.custom_domain || 'adrolls.in';

    return (
        <div className="max-w-4xl mx-auto p-8 sm:p-12 font-sans text-slate-800 leading-relaxed">
            <h1 className="text-3xl font-bold mb-6">Privacy Policy</h1>
            <p className="text-sm text-slate-500 mb-8">Last Updated: {new Date().toLocaleDateString()}</p>

            <section className="space-y-6">
                <div>
                    <h2 className="text-xl font-semibold mb-3">1. Introduction</h2>
                    <p>Welcome to {businessName}. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you visit our website {domain} or interact with our advertisements.</p>
                </div>

                <div>
                    <h2 className="text-xl font-semibold mb-3">2. Information We Collect</h2>
                    <p>We may collect personal information that you voluntarily provide to us when you express an interest in obtaining information about us or our products and services. This includes:</p>
                    <ul className="list-disc pl-5 mt-2 space-y-1 text-slate-600">
                        <li>Name and Contact Data (Phone number, email address)</li>
                        <li>Lead form responses and preferences</li>
                    </ul>
                </div>

                <div>
                    <h2 className="text-xl font-semibold mb-3">3. How We Use Your Information</h2>
                    <p>We use personal information collected to:</p>
                    <ul className="list-disc pl-5 mt-2 space-y-1 text-slate-600">
                        <li>Fulfill and manage your requests</li>
                        <li>Deliver targeted advertising and marketing</li>
                        <li>Communicate with you regarding your inquiries</li>
                    </ul>
                </div>

                <div>
                    <h2 className="text-xl font-semibold mb-3">4. Third-Party Services (Meta / Facebook)</h2>
                    <p>We use Meta (Facebook) lead generation forms and pixels. Information collected through these forms is subject to this privacy policy as well as Meta's privacy policy. We do not sell your personal data to third parties.</p>
                </div>

                <div>
                    <h2 className="text-xl font-semibold mb-3">5. Contact Us</h2>
                    <p>If you have questions or comments about this notice, please contact {businessName} directly.</p>
                </div>
            </section>
        </div>
    );
}
