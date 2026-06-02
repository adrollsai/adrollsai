import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

type RouteProps = {
    params: Promise<{ user_id: string, slug: string }>
}

export async function GET(request: Request, { params }: RouteProps) {
    try {
        const supabase = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        )
        const resolvedParams = await params
        const identifier = resolvedParams.user_id
        const slug = resolvedParams.slug

        console.log(`[Shared Route GET] Starting diagnostics... identifier="${identifier}", slug="${slug}"`)

        // 1. Resolve business profile
        let profileQuery = supabase.from('profiles').select('id, business_name, logo_url, custom_domain, pixel_id')
        if (identifier.includes('.')) {
            profileQuery = profileQuery.eq('custom_domain', identifier)
        } else {
            profileQuery = profileQuery.eq('id', identifier)
        }
        const { data: profile, error: profileErr } = await profileQuery.maybeSingle()
        if (profileErr) {
            console.error("[Shared Route] Profile Query Error:", profileErr)
        }
        console.log("[Shared Route] Resolved profile:", profile)

        if (!profile) {
            console.log("[Shared Route] Bailing out: Profile Not Found (404)")
            return new Response("Profile Not Found", { status: 404 })
        }

        // 2. Resolve landing page listing
        const { data: page, error: pageErr } = await supabase
            .from('landing_pages')
            .select(`
                id,
                title,
                product_name,
                html_content,
                form_id
            `)
            .eq('user_id', profile.id)
            .eq('slug', slug)
            .maybeSingle()

        if (pageErr) {
            console.error("[Shared Route] Page Query Error:", pageErr)
        }
        console.log("[Shared Route] Resolved page:", page ? { id: page.id, title: page.title } : null)

        if (!page) {
            console.log("[Shared Route] Bailing out: Page Not Found (404)")
            return new Response("Lander Not Found", { status: 404 })
        }

        // 3. Resolve qualification form details if connected
        let form: any = null
        if (page.form_id) {
            const { data: formData } = await supabase
                .from('qualification_forms')
                .select('*')
                .eq('id', page.form_id)
                .maybeSingle()
            form = formData
        }

        let finalHtml = page.html_content

        // Construct form HTML
        let formHtml = ''
        if (form) {
            const customQuestions = form.custom_questions || []

            formHtml = `
                <form class="dynamic-landing-form" style="max-width: 500px; margin: 2rem auto; padding: 2rem; background: #ffffff; border-radius: 1.5rem; border: 1px solid #e2e8f0; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05); font-family: system-ui, -apple-system, sans-serif; text-align: left;">
                    <h3 style="margin-top: 0; margin-bottom: 1.5rem; color: #0f172a; font-size: 1.5rem; font-weight: 800; letter-spacing: -0.025em; text-align: center;">Get Instant Details</h3>
                    <input type="hidden" name="landing_page_id" value="${page.id}" />
                    <input type="hidden" name="user_id" value="${profile.id}" />
                    <input type="hidden" name="slug" value="${slug}" />

                    <div class="form-group" style="margin-bottom: 1.25rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-size: 0.875rem; font-weight: 700; color: #475569;">Full Name</label>
                        <input type="text" name="name" required placeholder="John Doe" style="width: 100%; padding: 0.75rem 1rem; border-radius: 0.75rem; border: 1px solid #cbd5e1; outline: none; font-size: 0.875rem; box-sizing: border-box; transition: all 0.2s;" />
                    </div>

                    <div class="form-group" style="margin-bottom: 1.25rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-size: 0.875rem; font-weight: 700; color: #475569;">WhatsApp Number</label>
                        <input type="tel" name="phone" required placeholder="+91 98765 43210" style="width: 100%; padding: 0.75rem 1rem; border-radius: 0.75rem; border: 1px solid #cbd5e1; outline: none; font-size: 0.875rem; box-sizing: border-box; transition: all 0.2s;" />
                    </div>

                    <div class="form-group" style="margin-bottom: 1.25rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-size: 0.875rem; font-weight: 700; color: #475569;">City</label>
                        <input type="text" name="city" required placeholder="Mohali" style="width: 100%; padding: 0.75rem 1rem; border-radius: 0.75rem; border: 1px solid #cbd5e1; outline: none; font-size: 0.875rem; box-sizing: border-box; transition: all 0.2s;" />
                    </div>
            `

            // Inject custom questions
            customQuestions.forEach((q: any, index: number) => {
                const fieldName = `custom_question_${index}`
                formHtml += `
                    <div class="form-group" style="margin-bottom: 1.25rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-size: 0.875rem; font-weight: 700; color: #475569;">${q.label}</label>
                `
                if (q.type === 'MULTIPLE_CHOICE' && Array.isArray(q.options)) {
                    formHtml += `<select name="${fieldName}" required style="width: 100%; padding: 0.75rem 1rem; border-radius: 0.75rem; border: 1px solid #cbd5e1; outline: none; font-size: 0.875rem; box-sizing: border-box; background: #fff; transition: all 0.2s;">`
                    q.options.forEach((opt: string) => {
                        formHtml += `<option value="${opt}">${opt}</option>`
                    })
                    formHtml += `</select>`
                } else {
                    formHtml += `<input type="text" name="${fieldName}" required placeholder="Your answer" style="width: 100%; padding: 0.75rem 1rem; border-radius: 0.75rem; border: 1px solid #cbd5e1; outline: none; font-size: 0.875rem; box-sizing: border-box; transition: all 0.2s;" />`
                }
                formHtml += `</div>`
            })

            formHtml += `
                    <button type="submit" class="submit-btn" style="width: 100%; padding: 0.875rem; background: #2563eb; color: #ffffff; border: none; border-radius: 0.75rem; font-size: 0.875rem; font-weight: 700; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.2);">Submit & Continue</button>
                    <p class="form-message" style="margin-top: 1rem; font-size: 0.875rem; font-weight: 600; text-align: center; display: none;"></p>
                </form>

                <script>
                    document.querySelectorAll('.dynamic-landing-form').forEach(function(form) {
                        form.addEventListener('submit', async function(e) {
                            e.preventDefault();
                            const submitBtn = this.querySelector('.submit-btn');
                            const messageEl = this.querySelector('.form-message');
                            
                            if (submitBtn) {
                                submitBtn.disabled = true;
                                submitBtn.textContent = 'Submitting...';
                            }
                            if (messageEl) messageEl.style.display = 'none';

                            const formData = new FormData(this);
                            const payload = {};
                            formData.forEach((value, key) => { payload[key] = value; });

                            try {
                                const res = await fetch('/api/shared/landing-page/lead', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(payload)
                                });

                                const resData = await res.json();
                                if (resData.success) {
                                    if (messageEl) {
                                        messageEl.style.color = '#15803d';
                                        messageEl.textContent = 'Thank you! Your details have been submitted.';
                                        messageEl.style.display = 'block';
                                    }
                                    this.reset();
                                    
                                    // Trigger Meta Pixel Event
                                    if (window.fbq) {
                                        window.fbq('track', 'Lead', {
                                            content_name: '${page.product_name}',
                                            status: 'QualifiedPending'
                                        });
                                    }
                                } else {
                                    throw new Error(resData.error || 'Submission failed');
                                }
                            } catch(err) {
                                if (messageEl) {
                                    messageEl.style.color = '#b91c1c';
                                    messageEl.textContent = err.message || 'Something went wrong. Please try again.';
                                    messageEl.style.display = 'block';
                                }
                            } finally {
                                if (submitBtn) {
                                    submitBtn.disabled = false;
                                    submitBtn.textContent = 'Submit & Continue';
                                }
                            }
                        });
                    });
                </script>
            `
        }

        // Meta Pixel tracking code
        let pixelScript = ''
        if (profile.pixel_id) {
            pixelScript = `
                <!-- Meta Pixel Code -->
                <script>
                !function(f,b,e,v,n,t,s)
                {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
                n.callMethod.apply(n,arguments):n.queue.push(arguments)};
                if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
                n.queue=[];t=b.createElement(e);t.async=!0;
                t.src=v;s=b.getElementsByTagName(e)[0];
                s.parentNode.insertBefore(t,s)}(window, document,'script',
                'https://connect.facebook.net/en_US/fbevents.js');
                fbq('init', '${profile.pixel_id}');
                fbq('track', 'PageView');
                </script>
                <noscript><img height="1" width="1" style="display:none"
                src="https://www.facebook.com/tr?id=${profile.pixel_id}&ev=PageView&noscript=1"
                /></noscript>
                <!-- End Meta Pixel Code -->
            `
        }

        const containerRegex = /<div\s+[^>]*id="qualification-form-container"[^>]*><\/div>/gi
        if (finalHtml.match(containerRegex)) {
            finalHtml = finalHtml.replace(containerRegex, formHtml)
        }

        // Inject Meta Pixel script inside head
        if (pixelScript) {
            if (finalHtml.includes('</head>')) {
                finalHtml = finalHtml.replace('</head>', `${pixelScript}</head>`)
            } else if (finalHtml.includes('<body>')) {
                finalHtml = finalHtml.replace('<body>', `<body>${pixelScript}`)
            }
        }

        return new Response(finalHtml, {
            headers: {
                'content-type': 'text/html; charset=utf-8'
            }
        })
    } catch (e: any) {
        console.error("Shared Route Handler Error:", e)
        return new Response(`Internal Server Error: ${e.message}\nStack: ${e.stack}`, { status: 500 })
    }
}
