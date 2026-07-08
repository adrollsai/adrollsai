import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic';

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
        let profileQuery = supabase.from('profiles').select('id, business_name, logo_url, custom_domain, pixel_id, brand_color, google_refresh_token, google_booking_enabled, contact_number, business_landing_show_products')
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
                form_id,
                booking_enabled,
                pixel_id
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

        const bookingEnabled = !!(page?.booking_enabled && profile?.google_refresh_token && profile?.google_booking_enabled)

        let finalHtml = page.html_content
        const isSurveyPage = finalHtml.includes('data-page-type="survey"') || finalHtml.includes('id="survey-form-container"')

        // Extract customized values from LLM HTML attributes
        let buttonText = "Start Eligibility Check"
        let cardTitle = "Apply & Check Eligibility"
        let cardDesc = "Answer a few quick questions to see if you qualify and get instant details."

        const containerMatch = finalHtml.match(/<div\s+[^>]*id="qualification-form-container"([^>]*?)>/i)
        if (containerMatch && containerMatch[1]) {
            const attrs = containerMatch[1]
            const btnTextMatch = attrs.match(/data-button-text="([^"]+)"/i) || attrs.match(/data-button-text='([^']+)'/i)
            if (btnTextMatch) buttonText = btnTextMatch[1]

            const titleMatch = attrs.match(/data-title="([^"]+)"/i) || attrs.match(/data-title='([^']+)'/i)
            if (titleMatch) cardTitle = titleMatch[1]

            const descMatch = attrs.match(/data-description="([^"]+)"/i) || attrs.match(/data-description='([^']+)'/i)
            if (descMatch) cardDesc = descMatch[1]
        }

        // Construct form HTML
        let formHtml = ''
        const customQuestions = form?.custom_questions || []
        const brandColor = profile?.brand_color || '#2563eb'

        function getContrastColor(hexColor: string): string {
            if (!hexColor) return '#ffffff';
            let hex = hexColor.trim().replace('#', '');
            if (hex.length === 3) {
                hex = hex.split('').map(char => char + char).join('');
            }
            if (hex.length !== 6) return '#ffffff';
            const r = parseInt(hex.substring(0, 2), 16);
            const g = parseInt(hex.substring(2, 4), 16);
            const b = parseInt(hex.substring(4, 6), 16);
            const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
            return (yiq >= 128) ? '#0f172a' : '#ffffff';
        }

        const isBrandLight = getContrastColor(brandColor) === '#0f172a';
        const buttonBgColor = isBrandLight ? '#0B0F19' : brandColor;
        const buttonTextColor = '#ffffff';

        if (isSurveyPage) {
            formHtml = `
                <div id="survey-wizard-container" style="width: 100%; max-width: 500px; background: #ffffff; border-radius: 1.5rem; padding: 2.25rem 2rem; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05), 0 8px 10px -6px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; box-sizing: border-box; display: flex; flex-direction: column; gap: 1.5rem; margin: 0 auto;">
                    <!-- Back Button & Progress -->
                    <div id="survey-progress-container" style="display: flex; align-items: center; gap: 0.75rem; width: 100%; box-sizing: border-box;">
                        <button id="survey-back-btn" style="display: none; background: #f1f5f9; border: none; border-radius: 50%; width: 2rem; height: 2rem; cursor: pointer; display: flex; align-items: center; justify-content: center; color: #64748b; font-weight: bold; font-size: 1.25rem; transition: background 0.2s;">←</button>
                        <div style="flex: 1; height: 6px; background: #e2e8f0; border-radius: 3px; overflow: hidden;">
                            <div id="survey-progress-bar" style="width: 0%; height: 100%; background: ${brandColor}; border-radius: 3px; transition: width 0.3s ease-out;"></div>
                        </div>
                        <span id="survey-progress-text" style="font-size: 0.75rem; font-weight: 700; color: #64748b; white-space: nowrap;">Step 1 of 3</span>
                    </div>
                    <!-- Steps Content Container -->
                    <div id="survey-steps-container" style="width: 100%; box-sizing: border-box; text-align: left;">
                        <!-- JS generated content -->
                    </div>
                </div>
            `
        } else {
            formHtml = `
                <div class="qualification-trigger-card" style="max-width: 500px; margin: 2rem auto; padding: 1.5rem 0; background: transparent; font-family: inherit; text-align: center; box-sizing: border-box;">
                    <div style="width: 3.5rem; height: 3.5rem; background: color-mix(in srgb, ${brandColor} 15%, transparent); border-radius: 1rem; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.25rem;">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${brandColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/></svg>
                    </div>
                    <h3 style="margin-top: 0; margin-bottom: 0.5rem; color: inherit; font-size: 1.5rem; font-weight: 800; letter-spacing: -0.025em; font-family: inherit;">${cardTitle}</h3>
                    <p style="color: inherit; opacity: 0.8; font-size: 0.875rem; margin-bottom: 1.5rem; line-height: 1.5; font-family: inherit;">${cardDesc}</p>
                    <button class="open-eligibility-modal-btn" style="width: 100%; padding: 0.875rem 1.25rem; background: ${buttonBgColor} !important; color: ${buttonTextColor} !important; border: none; border-radius: 0.75rem; font-size: 0.875rem; font-weight: 700; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.15); font-family: inherit;">${buttonText}</button>
                </div>
 
                <!-- Full-Screen Eligibility Modal Overlay -->
                <div id="eligibility-modal-overlay" style="display: none; position: fixed; inset: 0; z-index: 999999; background: rgba(15, 23, 42, 0.75); backdrop-filter: blur(8px); align-items: center; justify-content: center; font-family: system-ui, -apple-system, sans-serif; padding: 1rem; box-sizing: border-box;">
                    <div id="eligibility-modal-card" style="position: relative; width: 100%; max-width: 500px; background: #ffffff; border-radius: 1.5rem; padding: 2.25rem 2rem; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25); box-sizing: border-box; overflow: hidden; display: flex; flex-direction: column; gap: 1.5rem;">
                        <!-- Back Button -->
                        <button id="eligibility-modal-back" style="display: none; position: absolute; top: 1.25rem; left: 1.25rem; background: #f1f5f9; border: none; border-radius: 50%; width: 2rem; height: 2rem; cursor: pointer; display: flex; align-items: center; justify-content: center; color: #64748b; font-weight: bold; font-size: 1.25rem; transition: background 0.2s;">←</button>
 
                        <!-- Close Button -->
                        <button id="eligibility-modal-close" style="position: absolute; top: 1.25rem; right: 1.25rem; background: #f1f5f9; border: none; border-radius: 50%; width: 2rem; height: 2rem; cursor: pointer; display: flex; align-items: center; justify-content: center; color: #64748b; font-weight: bold; font-size: 1.25rem; transition: background 0.2s;">×</button>
                        
                        <!-- Progress Container -->
                        <div id="eligibility-modal-progress-container" style="display: flex; align-items: center; gap: 0.75rem; width: 100%; box-sizing: border-box; margin-bottom: 0.25rem;">
                            <div style="flex: 1; height: 6px; background: #e2e8f0; border-radius: 3px; overflow: hidden;">
                                <div id="eligibility-modal-progress-bar" style="width: 0%; height: 100%; background: ${brandColor}; border-radius: 3px; transition: width 0.3s ease-out;"></div>
                            </div>
                            <span id="eligibility-modal-progress-text" style="font-size: 0.75rem; font-weight: 700; color: #64748b; white-space: nowrap;">Step 1 of 3</span>
                        </div>
 
                        <!-- Steps Content Container -->
                        <div id="eligibility-modal-steps-container" style="width: 100%; box-sizing: border-box; text-align: left;">
                            <!-- JS generated content -->
                        </div>
                    </div>
                </div>
            `
        }
 
        formHtml += `
            <style>
            @keyframes survey-step-in {
                from { opacity: 0; transform: translateY(8px); }
                to { opacity: 1; transform: translateY(0); }
            }
            .survey-step-active {
                animation: survey-step-in 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
            }
            @keyframes eligibility-scale-in {
                from { opacity: 0; transform: scale(0.96) translateY(8px); }
                to { opacity: 1; transform: scale(1) translateY(0); }
            }
            #eligibility-modal-card {
                animation: eligibility-scale-in 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
            }
            #eligibility-modal-back:hover {
                background: #e2e8f0;
                color: #0f172a;
            }
            #eligibility-modal-close:hover {
                background: #e2e8f0;
                color: #0f172a;
            }
            .eligibility-opt-btn {
                width: 100%;
                padding: 1rem 1.25rem;
                background: #f8fafc !important;
                border: 1px solid #e2e8f0;
                border-radius: 0.75rem;
                font-size: 0.875rem;
                font-weight: 600;
                color: #334155 !important;
                text-align: left;
                cursor: pointer;
                transition: all 0.2s;
                box-sizing: border-box;
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 0.75rem;
            }
            .eligibility-opt-btn:hover {
                background: #f1f5f9 !important;
                border-color: #cbd5e1;
                color: #0f172a !important;
                transform: translateY(-1px);
            }
            .eligibility-opt-btn:active {
                transform: translateY(0);
            }
            .eligibility-opt-btn-chevron {
                color: #94a3b8;
                font-size: 1rem;
                font-weight: bold;
                transition: transform 0.2s;
            }
            .eligibility-opt-btn:hover .eligibility-opt-btn-chevron {
                color: #475569;
                transform: translateX(2px);
            }
            .eligibility-input {
                width: 100%;
                padding: 0.875rem 1rem;
                border-radius: 0.75rem;
                border: 1px solid #cbd5e1;
                outline: none;
                font-size: 0.875rem;
                box-sizing: border-box;
                transition: all 0.2s;
                color: #0f172a !important;
                background-color: #ffffff !important;
            }
            .eligibility-input:focus {
                border-color: ${brandColor};
                box-shadow: 0 0 0 3px color-mix(in srgb, ${brandColor} 15%, transparent);
            }
            .eligibility-submit-btn {
                width: 100%;
                padding: 0.875rem;
                background: ${buttonBgColor} !important;
                color: ${buttonTextColor} !important;
                border: none;
                border-radius: 0.75rem;
                font-size: 0.875rem;
                font-weight: 700;
                cursor: pointer;
                transition: all 0.2s;
                box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
                box-sizing: border-box;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 0.5rem;
            }
            .eligibility-submit-btn:hover {
                background: ${buttonBgColor} !important;
                filter: brightness(0.9);
                box-shadow: 0 6px 12px -1px rgba(0, 0, 0, 0.15);
            }
            .eligibility-submit-btn:disabled {
                opacity: 0.6;
                cursor: not-allowed;
            }
            .calendar-days-grid {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 0.5rem;
                margin-bottom: 1.25rem;
            }
            .calendar-day-btn {
                padding: 0.625rem 0.5rem;
                background: #f8fafc !important;
                border: 1px solid #e2e8f0;
                border-radius: 0.5rem;
                font-size: 0.75rem;
                font-weight: 700;
                color: #475569 !important;
                text-align: center;
                cursor: pointer;
                transition: all 0.2s;
                box-sizing: border-box;
            }
            .calendar-day-btn.active {
                background: ${brandColor} !important;
                color: #ffffff !important;
                border-color: ${brandColor};
            }
            .calendar-day-btn:hover:not(.active) {
                background: #f1f5f9 !important;
                border-color: #cbd5e1;
                color: #0f172a !important;
            }
            .calendar-slots-grid {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 0.5rem;
                max-height: 200px;
                overflow-y: auto;
                padding-right: 0.25rem;
            }
            .calendar-slot-btn {
                padding: 0.625rem;
                background: #ffffff !important;
                border: 1px solid #cbd5e1;
                border-radius: 0.5rem;
                font-size: 0.8125rem;
                font-weight: 600;
                color: #1e293b !important;
                text-align: center;
                cursor: pointer;
                transition: all 0.2s;
                box-sizing: border-box;
            }
            .calendar-slot-btn:hover {
                background: color-mix(in srgb, ${brandColor} 8%, #ffffff) !important;
                border-color: ${brandColor};
                color: ${brandColor} !important;
            }
            .calendar-slot-btn.active {
                background: ${brandColor} !important;
                color: #ffffff !important;
                border-color: ${brandColor};
            }
            </style>
 
            <script>
            (function() {
                const bookingEnabled = ${bookingEnabled};
                const userId = '${profile.id}';
                const brandColor = '${brandColor}';
                const fields = ${JSON.stringify(form?.fields && form.fields.length > 0 ? form.fields : [
                    { name: 'name', type: 'text', label: 'Full Name' },
                    { name: 'phone', type: 'tel', label: 'WhatsApp Number' },
                    { name: 'city', type: 'text', label: 'City' }
                ])};
                const questions = ${JSON.stringify(customQuestions)};
                let currentStep = 0;
                const answers = {};
                const contactInfo = { name: '', phone: '', city: '' };
                
                const isSurvey = ${isSurveyPage};
                const overlay = document.getElementById('eligibility-modal-overlay');
                const closeBtn = document.getElementById('eligibility-modal-close');
                const backBtn = isSurvey ? document.getElementById('survey-back-btn') : document.getElementById('eligibility-modal-back');
                const progressContainer = isSurvey ? document.getElementById('survey-progress-container') : document.getElementById('eligibility-modal-progress-container');
                const progressBar = isSurvey ? document.getElementById('survey-progress-bar') : document.getElementById('eligibility-modal-progress-bar');
                const progressText = isSurvey ? document.getElementById('survey-progress-text') : document.getElementById('eligibility-modal-progress-text');
                const stepsContainer = isSurvey ? document.getElementById('survey-steps-container') : document.getElementById('eligibility-modal-steps-container');
                
                const catalogueLink = window.location.hostname.includes('.') && !window.location.hostname.includes('localhost') && !window.location.hostname.includes('adrolls.in') && !window.location.hostname.includes('vercel.app') && !window.location.hostname.includes('ngrok-free.dev')
                    ? window.location.origin + '/'
                    : window.location.origin + '/shared/' + userId;
 
                if (overlay && overlay.parentNode !== document.body) {
                    document.body.appendChild(overlay);
                }
                
                function openModal() {
                    if (!overlay) return;
                    overlay.style.display = 'flex';
                    currentStep = 0;
                    for (let k in answers) delete answers[k];
                    contactInfo.name = '';
                    contactInfo.phone = '';
                    contactInfo.city = '';
                    renderStep();
                }
                
                function closeModal() {
                    if (!overlay) return;
                    overlay.style.display = 'none';
                }
                
                if (closeBtn) closeBtn.addEventListener('click', closeModal);
                
                if (backBtn) {
                    backBtn.addEventListener('click', function() {
                        if (currentStep > 0) {
                            currentStep--;
                            renderStep();
                        }
                    });
                }
                
                const card = document.getElementById('eligibility-modal-card');
                if (card) {
                    card.addEventListener('click', function(e) {
                        e.stopPropagation();
                    });
                }
                if (overlay) {
                    overlay.addEventListener('click', closeModal);
                }
                
                function renderStep() {
                    stepsContainer.innerHTML = '';
                    progressContainer.style.display = 'flex';
                    
                    if (backBtn) {
                        if (currentStep > 0) {
                            backBtn.style.display = 'flex';
                        } else {
                            backBtn.style.display = 'none';
                        }
                    }
                    
                    const totalSteps = questions.length + 1;
                    const percent = Math.round((currentStep / totalSteps) * 100);
                    if (progressBar) progressBar.style.width = percent + '%';
                    if (progressText) progressText.textContent = 'Step ' + (currentStep + 1) + ' of ' + totalSteps;
                    
                    if (currentStep < questions.length) {
                        const q = questions[currentStep];
                        
                        const wrapper = document.createElement('div');
                        wrapper.className = 'survey-step-active';
                        wrapper.style.display = 'flex';
                        wrapper.style.flexDirection = 'column';
                        wrapper.style.gap = '1.25rem';
                        
                        const questionLabel = document.createElement('h4');
                        questionLabel.style.margin = '0';
                        questionLabel.style.color = '#0f172a';
                        questionLabel.style.fontSize = '1.25rem';
                        questionLabel.style.fontWeight = '800';
                        questionLabel.style.lineHeight = '1.4';
                        questionLabel.textContent = q.label;
                        wrapper.appendChild(questionLabel);
                        
                        if (q.type === 'MULTIPLE_CHOICE') {
                            const optsContainer = document.createElement('div');
                            optsContainer.style.display = 'flex';
                            optsContainer.style.flexDirection = 'column';
                            optsContainer.style.gap = '0.5rem';
                            
                            var displayOpts = (q.options || []).slice();
                            if (q.disqualify_options && Array.isArray(q.disqualify_options)) {
                                q.disqualify_options.forEach(function(disqOpt) {
                                    var trimmed = disqOpt.trim();
                                    var alreadyExists = false;
                                    for (var i = 0; i < displayOpts.length; i++) {
                                        if (displayOpts[i].trim().toLowerCase() === trimmed.toLowerCase()) {
                                            alreadyExists = true;
                                            break;
                                        }
                                    }
                                    if (trimmed && !alreadyExists) {
                                        displayOpts.push(trimmed);
                                    }
                                });
                            }
                            
                            displayOpts.forEach(function(opt) {
                                const btn = document.createElement('button');
                                btn.className = 'eligibility-opt-btn';
                                btn.innerHTML = '<span>' + opt + '</span><span class="eligibility-opt-btn-chevron">→</span>';
                                btn.addEventListener('click', function() {
                                    handleAnswer(q, opt);
                                });
                                optsContainer.appendChild(btn);
                            });
                            wrapper.appendChild(optsContainer);
                        } else {
                            const inputGroup = document.createElement('div');
                            inputGroup.style.display = 'flex';
                            inputGroup.style.flexDirection = 'column';
                            inputGroup.style.gap = '0.75rem';
                            
                            const input = document.createElement('input');
                            input.type = 'text';
                            input.className = 'eligibility-input';
                            input.placeholder = 'Type your answer here...';
                            input.required = true;
                            input.value = answers[q.label] || '';
                            
                            input.addEventListener('input', function() {
                                answers[q.label] = input.value;
                            });
                            
                            const nextBtn = document.createElement('button');
                            nextBtn.className = 'eligibility-submit-btn';
                            nextBtn.textContent = 'Next';
                            
                            function submitTextAnswer() {
                                const val = input.value.trim();
                                if (!val) {
                                    input.style.borderColor = '#b91c1c';
                                    return;
                                }
                                handleAnswer(q, val);
                            }
                            
                            nextBtn.addEventListener('click', submitTextAnswer);
                            input.addEventListener('keypress', function(e) {
                                if (e.key === 'Enter') submitTextAnswer();
                            });
                            
                            inputGroup.appendChild(input);
                            inputGroup.appendChild(nextBtn);
                            wrapper.appendChild(inputGroup);
                            
                            setTimeout(function() { input.focus(); }, 50);
                        }
                        
                        stepsContainer.appendChild(wrapper);
                    } else {
                        const wrapper = document.createElement('div');
                        wrapper.className = 'survey-step-active';
                        wrapper.style.display = 'flex';
                        wrapper.style.flexDirection = 'column';
                        wrapper.style.gap = '1.25rem';
                        
                        const title = document.createElement('h4');
                        title.style.margin = '0';
                        title.style.color = '#0f172a';
                        title.style.fontSize = '1.25rem';
                        title.style.fontWeight = '800';
                        title.style.textAlign = 'center';
                        title.textContent = 'Almost There! Enter Details';
                        wrapper.appendChild(title);
                        
                        const desc = document.createElement('p');
                        desc.style.margin = '0';
                        desc.style.color = '#64748b';
                        desc.style.fontSize = '0.875rem';
                        desc.style.textAlign = 'center';
                        desc.style.lineHeight = '1.5';
                        desc.textContent = 'Please fill out your contact details to complete your application.';
                        wrapper.appendChild(desc);
                        
                        const form = document.createElement('form');
                        form.style.display = 'flex';
                        form.style.flexDirection = 'column';
                        form.style.gap = '1rem';
                        
                        const inputs = {};
                        fields.forEach(function(f) {
                            let placeholder = 'Your answer';
                            if (f.name === 'name') placeholder = 'John Doe';
                            else if (f.name === 'phone') placeholder = '+91 98765 43210';
                            else if (f.name === 'city') placeholder = 'Mohali';

                            const group = createInputGroup(f.label, f.type, f.name, placeholder);
                            group.input.value = contactInfo[f.name] || '';
                            group.input.addEventListener('input', function() {
                                contactInfo[f.name] = group.input.value;
                            });
                            form.appendChild(group.container);
                            inputs[f.name] = group.input;
                        });
                        
                        const submitBtn = document.createElement('button');
                        submitBtn.type = 'submit';
                        submitBtn.className = 'eligibility-submit-btn';
                        submitBtn.textContent = 'Submit Details';
                        form.appendChild(submitBtn);
                        
                        const errMsg = document.createElement('p');
                        errMsg.style.margin = '0';
                        errMsg.style.fontSize = '0.875rem';
                        errMsg.style.color = '#b91c1c';
                        errMsg.style.fontWeight = '600';
                        errMsg.style.textAlign = 'center';
                        errMsg.style.display = 'none';
                        form.appendChild(errMsg);
                        
                        form.addEventListener('submit', async function(e) {
                            e.preventDefault();
                            submitBtn.disabled = true;
                            submitBtn.textContent = 'Submitting...';
                            errMsg.style.display = 'none';
                            
                            const eventId = 'evt_lead_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);
                            const payload = {
                                landing_page_id: '${page.id}',
                                user_id: '${profile.id}',
                                slug: '${slug}',
                                name: inputs.name ? inputs.name.value.trim() : '',
                                phone: inputs.phone ? inputs.phone.value.trim() : '',
                                city: inputs.city ? inputs.city.value.trim() : '',
                                eventId: eventId
                            };
                            
                            questions.forEach(function(q, idx) {
                                payload['custom_question_' + idx] = answers[q.label];
                            });
                            
                            try {
                                const res = await fetch('/api/shared/landing-page/lead', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(payload)
                                });
                                
                                const resData = await res.json();
                                if (!res.ok || !resData.success) {
                                    throw new Error(resData.error || 'Submission failed');
                                }
                                
                                if (window.fbq) {
                                    window.fbq('track', 'Lead', {
                                        content_name: '${page.product_name.replace(/'/g, "\\'")}',
                                        status: 'Qualified'
                                    }, { eventID: eventId });
                                }
                                
                                showSuccess(resData.leadId);
                            } catch(err) {
                                errMsg.textContent = err.message || 'Something went wrong. Please try again.';
                                errMsg.style.display = 'block';
                                submitBtn.disabled = false;
                                submitBtn.textContent = 'Submit Details';
                            }
                        });
                        
                        wrapper.appendChild(form);
                        stepsContainer.appendChild(wrapper);
                        
                        setTimeout(function() {
                            const keys = Object.keys(inputs);
                            if (keys.length > 0 && inputs[keys[0]]) {
                                inputs[keys[0]].focus();
                            }
                        }, 50);
                    }
                }
                
                function createInputGroup(labelVal, type, name, placeholder) {
                    const container = document.createElement('div');
                    container.style.display = 'flex';
                    container.style.flexDirection = 'column';
                    container.style.gap = '0.375rem';
                    
                    const label = document.createElement('label');
                    label.style.fontSize = '0.75rem';
                    label.style.fontWeight = '700';
                    label.style.color = '#475569';
                    label.style.textTransform = 'uppercase';
                    label.style.letterSpacing = '0.05em';
                    label.textContent = labelVal;
                    
                    const input = document.createElement('input');
                    input.type = type;
                    input.name = name;
                    input.className = 'eligibility-input';
                    input.placeholder = placeholder;
                    input.required = true;
                    
                    container.appendChild(label);
                    container.appendChild(input);
                    
                    return { container: container, input: input };
                }
                
                function handleAnswer(q, option) {
                    answers[q.label] = option;
                    
                    if (q.type === 'MULTIPLE_CHOICE' && q.disqualify_options && Array.isArray(q.disqualify_options)) {
                        const isDisqualified = q.disqualify_options.some(function(disqOpt) {
                            return disqOpt.trim().toLowerCase() === option.trim().toLowerCase();
                        });
                        
                        if (isDisqualified) {
                            showDisqualified(q.disqualify_message || 'Based on your response, you do not meet the eligibility criteria.');
                            return;
                        }
                    }
                    
                    currentStep++;
                    renderStep();
                }
                
                function showDisqualified(message) {
                    progressContainer.style.display = 'none';
                    if (backBtn) backBtn.style.display = 'none';
                    stepsContainer.innerHTML = '';
                    
                    const wrapper = document.createElement('div');
                    wrapper.className = 'survey-step-active';
                    wrapper.style.display = 'flex';
                    wrapper.style.flexDirection = 'column';
                    wrapper.style.alignItems = 'center';
                    wrapper.style.textAlign = 'center';
                    wrapper.style.gap = '1.25rem';
                    wrapper.style.padding = '1.5rem 0';
                    
                    const iconContainer = document.createElement('div');
                    iconContainer.style.width = '4rem';
                    iconContainer.style.height = '4rem';
                    iconContainer.style.background = '#fef2f2';
                    iconContainer.style.borderRadius = '50%';
                    iconContainer.style.display = 'flex';
                    iconContainer.style.alignItems = 'center';
                    iconContainer.style.justifyContent = 'center';
                    iconContainer.style.color = '#ef4444';
                    iconContainer.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>';
                    wrapper.appendChild(iconContainer);
                    
                    const title = document.createElement('h4');
                    title.style.margin = '0';
                    title.style.color = '#991b1b';
                    title.style.fontSize = '1.5rem';
                    title.style.fontWeight = '900';
                    title.textContent = 'Not Eligible';
                    wrapper.appendChild(title);
                    
                    const msgText = document.createElement('p');
                    msgText.style.margin = '0';
                    msgText.style.color = '#4b5563';
                    msgText.style.fontSize = '0.95rem';
                    msgText.style.lineHeight = '1.6';
                    msgText.style.fontWeight = '600';
                    msgText.textContent = message;
                    wrapper.appendChild(msgText);
                    
                    const btnContainer = document.createElement('div');
                    btnContainer.style.display = 'flex';
                    btnContainer.style.width = '100%';
                    btnContainer.style.gap = '0.75rem';
                    btnContainer.style.marginTop = '0.5rem';
                    
                    const backBtnDisq = document.createElement('button');
                    backBtnDisq.className = 'eligibility-submit-btn';
                    backBtnDisq.style.setProperty('background', '${buttonBgColor}', 'important');
                    backBtnDisq.style.setProperty('color', '${buttonTextColor}', 'important');
                    backBtnDisq.style.boxShadow = 'none';
                    backBtnDisq.textContent = 'Go Back & Edit';
                    backBtnDisq.addEventListener('click', function() {
                        renderStep();
                    });
                    btnContainer.appendChild(backBtnDisq);
                    
                    const closeBtn2 = document.createElement('button');
                    closeBtn2.className = 'eligibility-submit-btn';
                    closeBtn2.style.setProperty('background', '#6b7280', 'important');
                    closeBtn2.style.setProperty('color', '#ffffff', 'important');
                    closeBtn2.style.boxShadow = 'none';
                    closeBtn2.textContent = 'Close';
                    closeBtn2.addEventListener('click', function() {
                        if (isSurvey) {
                            window.location.href = catalogueLink;
                        } else {
                            closeModal();
                        }
                    });
                    btnContainer.appendChild(closeBtn2);
                    
                    wrapper.appendChild(btnContainer);
                    stepsContainer.appendChild(wrapper);
                }
                
                function getNextBookingDays() {
                    const days = [];
                    const current = new Date();
                    // Generate next 6 calendar days, excluding Sundays (0)
                    while (days.length < 6) {
                        const dayOfWeek = current.getDay();
                        if (dayOfWeek !== 0) {
                            const yyyy = current.getFullYear();
                            const mm = String(current.getMonth() + 1).padStart(2, '0');
                            const dd = String(current.getDate()).padStart(2, '0');
                            days.push({
                                dateStr: yyyy + '-' + mm + '-' + dd,
                                label: current.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                            });
                        }
                        current.setDate(current.getDate() + 1);
                    }
                    return days;
                }
 
                function showSuccess(leadId) {
                    if (bookingEnabled && leadId) {
                        renderCalendarBooking(leadId);
                    } else {
                        showSuccessDirect();
                    }
                }
 
                function showSuccessDirect() {
                    progressContainer.style.display = 'none';
                    if (backBtn) backBtn.style.display = 'none';
                    stepsContainer.innerHTML = '';
                    
                    const wrapper = document.createElement('div');
                    wrapper.className = 'survey-step-active';
                    wrapper.style.display = 'flex';
                    wrapper.style.flexDirection = 'column';
                    wrapper.style.alignItems = 'center';
                    wrapper.style.textAlign = 'center';
                    wrapper.style.gap = '1.25rem';
                    wrapper.style.padding = '1.5rem 0';
                    
                    const iconContainer = document.createElement('div');
                    iconContainer.style.width = '4rem';
                    iconContainer.style.height = '4rem';
                    iconContainer.style.background = '#f0fdf4';
                    iconContainer.style.borderRadius = '50%';
                    iconContainer.style.display = 'flex';
                    iconContainer.style.alignItems = 'center';
                    iconContainer.style.justifyContent = 'center';
                    iconContainer.style.color = '#22c55e';
                    iconContainer.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m9 12 2 2 4-4"/></svg>';
                    wrapper.appendChild(iconContainer);
                    
                    const title = document.createElement('h4');
                    title.style.margin = '0';
                    title.style.color = '#166534';
                    title.style.fontSize = '1.5rem';
                    title.style.fontWeight = '900';
                    title.textContent = 'Application Submitted!';
                    wrapper.appendChild(title);
                    
                    const msgText = document.createElement('p');
                    msgText.style.margin = '0';
                    msgText.style.color = '#4b5563';
                    msgText.style.fontSize = '0.95rem';
                    msgText.style.lineHeight = '1.6';
                    msgText.style.fontWeight = '600';
                    msgText.textContent = 'Thank you! Your details have been submitted successfully. We will get in touch with you shortly.';
                    wrapper.appendChild(msgText);
                    
                    const btnContainer = document.createElement('div');
                    btnContainer.style.display = 'flex';
                    btnContainer.style.flexDirection = 'column';
                    btnContainer.style.width = '100%';
                    btnContainer.style.gap = '0.75rem';
                    btnContainer.style.marginTop = '0.5rem';
                    
                    const catBtn = document.createElement('a');
                    catBtn.className = 'eligibility-submit-btn';
                    catBtn.href = catalogueLink;
                    catBtn.target = '_blank';
                    catBtn.style.setProperty('background', brandColor, 'important');
                    catBtn.style.setProperty('color', '#ffffff', 'important');
                    catBtn.style.textDecoration = 'none';
                    catBtn.style.display = 'flex';
                    catBtn.style.alignItems = 'center';
                    catBtn.style.justifyContent = 'center';
                    catBtn.style.gap = '0.5rem';
                    catBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg> View Catalogue Inventory';
                    btnContainer.appendChild(catBtn);
                    
                    let phone = '${profile.contact_number || ""}';
                    let cleanPhone = phone.replace(/[^0-9]/g, '');
                    if (cleanPhone.length === 10) {
                        cleanPhone = '91' + cleanPhone;
                    }
                    if (cleanPhone) {
                        const whatsappUrl = 'https://wa.me/' + cleanPhone;
                        const waBtn = document.createElement('a');
                        waBtn.className = 'eligibility-submit-btn';
                        waBtn.href = whatsappUrl;
                        waBtn.target = '_blank';
                        waBtn.style.setProperty('background', '#25D366', 'important');
                        waBtn.style.setProperty('color', '#ffffff', 'important');
                        waBtn.style.textDecoration = 'none';
                        waBtn.style.display = 'flex';
                        waBtn.style.alignItems = 'center';
                        waBtn.style.justifyContent = 'center';
                        waBtn.style.gap = '0.5rem';
                        waBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.458 5.704 1.459h.008c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413"/></svg> Connect on WhatsApp';
                        btnContainer.appendChild(waBtn);
                    }
                    
                    const closeBtn2 = document.createElement('button');
                    closeBtn2.className = 'eligibility-submit-btn';
                    closeBtn2.style.setProperty('background', '#f1f5f9', 'important');
                    closeBtn2.style.setProperty('color', '#475569', 'important');
                    closeBtn2.style.border = '1px solid #e2e8f0';
                    closeBtn2.style.boxShadow = 'none';
                    closeBtn2.textContent = 'Close';
                    closeBtn2.addEventListener('click', function() {
                        if (isSurvey) {
                            window.location.href = catalogueLink;
                        } else {
                            closeModal();
                        }
                    });
                    btnContainer.appendChild(closeBtn2);
                    
                    wrapper.appendChild(btnContainer);
                    stepsContainer.appendChild(wrapper);
                }
 
                function renderCalendarBooking(leadId) {
                    stepsContainer.innerHTML = '';
                    progressContainer.style.display = 'none';
                    if (backBtn) backBtn.style.display = 'none';
 
                    const wrapper = document.createElement('div');
                    wrapper.style.display = 'flex';
                    wrapper.style.flexDirection = 'column';
                    wrapper.style.gap = '1.25rem';
                    wrapper.style.textAlign = 'left';
 
                    const title = document.createElement('h4');
                    title.style.margin = '0';
                    title.style.color = '#0f172a';
                    title.style.fontSize = '1.25rem';
                    title.style.fontWeight = '800';
                    title.textContent = 'Schedule Your Session';
                    wrapper.appendChild(title);
 
                    const desc = document.createElement('p');
                    desc.style.margin = '0';
                    desc.style.color = '#64748b';
                    desc.style.fontSize = '0.875rem';
                    desc.style.lineHeight = '1.5';
                    desc.textContent = 'Pick a convenient date and time to book your slots on Google Calendar.';
                    wrapper.appendChild(desc);
 
                    const daysGrid = document.createElement('div');
                    daysGrid.className = 'calendar-days-grid';
                    wrapper.appendChild(daysGrid);
 
                    const slotsTitle = document.createElement('h5');
                    slotsTitle.style.margin = '0 0 0.5rem';
                    slotsTitle.style.fontSize = '0.875rem';
                    slotsTitle.style.fontWeight = '700';
                    slotsTitle.style.color = '#475569';
                    slotsTitle.textContent = 'Available Slots:';
                    wrapper.appendChild(slotsTitle);
 
                    const slotsContainer = document.createElement('div');
                    slotsContainer.className = 'calendar-slots-grid';
                    wrapper.appendChild(slotsContainer);
 
                    const loadingIndicator = document.createElement('div');
                    loadingIndicator.style.fontSize = '0.875rem';
                    loadingIndicator.style.color = '#64748b';
                    loadingIndicator.style.padding = '1rem 0';
                    loadingIndicator.style.textAlign = 'center';
                    loadingIndicator.textContent = 'Loading slots...';
 
                    const days = getNextBookingDays();
                    let selectedDateStr = days[0].dateStr;
 
                    days.forEach(function(day, index) {
                        const dayBtn = document.createElement('button');
                        dayBtn.className = 'calendar-day-btn' + (index === 0 ? ' active' : '');
                        dayBtn.textContent = day.label;
                        dayBtn.addEventListener('click', function() {
                            const activeBtns = daysGrid.querySelectorAll('.calendar-day-btn');
                            activeBtns.forEach(btn => btn.classList.remove('active'));
                            dayBtn.classList.add('active');
                            selectedDateStr = day.dateStr;
                            loadSlots(day.dateStr);
                        });
                        daysGrid.appendChild(dayBtn);
                    });
 
                    async function loadSlots(dateStr) {
                        slotsContainer.innerHTML = '';
                        slotsContainer.appendChild(loadingIndicator);
                        try {
                            const res = await fetch('/api/shared/booking/slots?userId=' + encodeURIComponent(userId) + '&date=' + encodeURIComponent(dateStr));
                            const data = await res.json();
                            slotsContainer.innerHTML = '';
 
                            if (!res.ok) throw new Error(data.error || 'Failed to fetch slots');
 
                            const slots = data.slots || [];
                            if (slots.length === 0) {
                                const noSlots = document.createElement('div');
                                noSlots.style.gridColumn = 'span 2';
                                noSlots.style.fontSize = '0.875rem';
                                noSlots.style.color = '#64748b';
                                noSlots.style.padding = '1.5rem 0';
                                noSlots.style.textAlign = 'center';
                                noSlots.textContent = 'No slots available for this day.';
                                slotsContainer.appendChild(noSlots);
                                return;
                            }
 
                            slots.forEach(function(slotIso) {
                                const slotDate = new Date(slotIso);
                                const timeLabel = slotDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                
                                const slotBtn = document.createElement('button');
                                slotBtn.className = 'calendar-slot-btn';
                                slotBtn.textContent = timeLabel;
                                slotBtn.addEventListener('click', function() {
                                    showConfirmBooking(slotIso, timeLabel, dateStr);
                                });
                                slotsContainer.appendChild(slotBtn);
                            });
                        } catch (err) {
                            slotsContainer.innerHTML = '';
                            const errEl = document.createElement('div');
                            errEl.style.gridColumn = 'span 2';
                            errEl.style.fontSize = '0.875rem';
                            errEl.style.color = '#ef4444';
                            errEl.style.padding = '1.5rem 0';
                            errEl.style.textAlign = 'center';
                            errEl.style.fontWeight = '600';
                            errEl.textContent = 'Error loading slots: ' + err.message;
                            slotsContainer.appendChild(errEl);
                        }
                    }
 
                    const footer = document.createElement('div');
                    footer.style.display = 'flex';
                    footer.style.justifyContent = 'center';
                    footer.style.marginTop = '1rem';
                    footer.style.borderTop = '1px solid #e2e8f0';
                    footer.style.paddingTop = '1rem';
 
                    const skipBtn = document.createElement('button');
                    skipBtn.style.background = 'none';
                    skipBtn.style.border = 'none';
                    skipBtn.style.color = '#64748b';
                    skipBtn.style.fontSize = '0.875rem';
                    skipBtn.style.fontWeight = '600';
                    skipBtn.style.cursor = 'pointer';
                    skipBtn.textContent = 'Skip for now';
                    skipBtn.addEventListener('click', function() {
                        showSuccessDirect();
                    });
                    footer.appendChild(skipBtn);
                    wrapper.appendChild(footer);
 
                    stepsContainer.appendChild(wrapper);
 
                    // Load slots for first day
                    loadSlots(selectedDateStr);
 
                    function showConfirmBooking(slotIso, timeLabel, dateStr) {
                        stepsContainer.innerHTML = '';
                        
                        const confirmWrapper = document.createElement('div');
                        confirmWrapper.style.display = 'flex';
                        confirmWrapper.style.flexDirection = 'column';
                        confirmWrapper.style.gap = '1.25rem';
                        confirmWrapper.style.textAlign = 'center';
                        confirmWrapper.style.padding = '1rem 0';
 
                        const confirmTitle = document.createElement('h4');
                        confirmTitle.style.margin = '0';
                        confirmTitle.style.color = '#0f172a';
                        confirmTitle.style.fontSize = '1.25rem';
                        confirmTitle.style.fontWeight = '800';
                        confirmTitle.textContent = 'Confirm Your Appointment';
                        confirmWrapper.appendChild(confirmTitle);
 
                        const detailBox = document.createElement('div');
                        detailBox.style.background = '#f8fafc';
                        detailBox.style.border = '1px solid #e2e8f0';
                        detailBox.style.borderRadius = '0.75rem';
                        detailBox.style.padding = '1.25rem';
                        detailBox.style.display = 'flex';
                        detailBox.style.flexDirection = 'column';
                        detailBox.style.gap = '0.5rem';
 
                        const formattedDate = new Date(slotIso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
 
                        const dateEl = document.createElement('div');
                        dateEl.style.fontSize = '0.95rem';
                        dateEl.style.fontWeight = '700';
                        dateEl.style.color = '#1e293b';
                        dateEl.textContent = '📅  ' + formattedDate;
                        detailBox.appendChild(dateEl);
 
                        const timeEl = document.createElement('div');
                        timeEl.style.fontSize = '1.1rem';
                        timeEl.style.fontWeight = '800';
                        timeEl.style.color = brandColor;
                        timeEl.textContent = '⏰  ' + timeLabel;
                        detailBox.appendChild(timeEl);
 
                        confirmWrapper.appendChild(detailBox);
 
                        const actionBtn = document.createElement('button');
                        actionBtn.className = 'eligibility-submit-btn';
                        actionBtn.textContent = 'Confirm Booking';
                        confirmWrapper.appendChild(actionBtn);
 
                        const cancelBtn = document.createElement('button');
                        cancelBtn.className = 'eligibility-submit-btn';
                        cancelBtn.style.setProperty('background', '#f1f5f9', 'important');
                        cancelBtn.style.setProperty('color', '#475569', 'important');
                        cancelBtn.style.boxShadow = 'none';
                        cancelBtn.style.border = '1px solid #e2e8f0';
                        cancelBtn.textContent = 'Change Date/Time';
                        cancelBtn.addEventListener('click', function() {
                            renderCalendarBooking(leadId);
                        });
                        confirmWrapper.appendChild(cancelBtn);
 
                        const errorMsg = document.createElement('p');
                        errorMsg.style.margin = '0';
                        errorMsg.style.fontSize = '0.875rem';
                        errorMsg.style.color = '#ef4444';
                        errorMsg.style.fontWeight = '600';
                        errorMsg.style.display = 'none';
                        confirmWrapper.appendChild(errorMsg);
 
                        actionBtn.addEventListener('click', async function() {
                            actionBtn.disabled = true;
                            actionBtn.textContent = 'Booking...';
                            errorMsg.style.display = 'none';
                            cancelBtn.style.display = 'none';
 
                            try {
                                const eventId = 'evt_sched_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);
                                const bookingRes = await fetch('/api/shared/booking/create', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        lead_id: leadId,
                                        slot: slotIso,
                                        user_id: userId,
                                        eventId: eventId
                                    })
                                });
 
                                const bookingData = await bookingRes.json();
                                if (!bookingRes.ok || !bookingData.success) {
                                    throw new Error(bookingData.error || 'Booking failed');
                                }
 
                                showBookedSuccess(formattedDate, timeLabel);
                            } catch (err) {
                                errorMsg.textContent = err.message || 'Something went wrong. Please try again.';
                                errorMsg.style.display = 'block';
                                actionBtn.disabled = false;
                                actionBtn.textContent = 'Confirm Booking';
                                cancelBtn.style.display = 'block';
                            }
                        });
 
                        stepsContainer.appendChild(confirmWrapper);
                    }
 
                    function showBookedSuccess(dateLabel, timeLabel) {
                        stepsContainer.innerHTML = '';
 
                        const wrapper = document.createElement('div');
                        wrapper.style.display = 'flex';
                        wrapper.style.flexDirection = 'column';
                        wrapper.style.alignItems = 'center';
                        wrapper.style.textAlign = 'center';
                        wrapper.style.gap = '1.25rem';
                        wrapper.style.padding = '1.5rem 0';
 
                        const iconContainer = document.createElement('div');
                        iconContainer.style.width = '4rem';
                        iconContainer.style.height = '4rem';
                        iconContainer.style.background = '#f0fdf4';
                        iconContainer.style.borderRadius = '50%';
                        iconContainer.style.display = 'flex';
                        iconContainer.style.alignItems = 'center';
                        iconContainer.style.justifyContent = 'center';
                        iconContainer.style.color = '#22c55e';
                        iconContainer.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m9 12 2 2 4-4"/></svg>';
                        wrapper.appendChild(iconContainer);
 
                        const title = document.createElement('h4');
                        title.style.margin = '0';
                        title.style.color = '#166534';
                        title.style.fontSize = '1.5rem';
                        title.style.fontWeight = '900';
                        title.textContent = 'Booking Confirmed!';
                        wrapper.appendChild(title);
 
                        const msgText = document.createElement('p');
                        msgText.style.margin = '0';
                        msgText.style.color = '#4b5563';
                        msgText.style.fontSize = '0.95rem';
                        msgText.style.lineHeight = '1.6';
                        msgText.style.fontWeight = '600';
                        msgText.innerHTML = 'Your appointment is scheduled for <br><span style="color:#0f172a; font-weight:800;">' + dateLabel + ' at ' + timeLabel + '</span>.<br>A Google Calendar invitation has been sent to your email.';
                        wrapper.appendChild(msgText);
 
                        const closeBtn2 = document.createElement('button');
                        closeBtn2.className = 'eligibility-submit-btn';
                        closeBtn2.style.setProperty('background', '#166534', 'important');
                        closeBtn2.style.setProperty('color', '#ffffff', 'important');
                        closeBtn2.style.boxShadow = 'none';
                        closeBtn2.textContent = 'Done';
                        closeBtn2.addEventListener('click', function() {
                            if (isSurvey) {
                                window.location.href = catalogueLink;
                            } else {
                                closeModal();
                            }
                        });
                        wrapper.appendChild(closeBtn2);
 
                        stepsContainer.appendChild(wrapper);
                    }
                }
                


                function renderCalendarBooking(leadId) {
                    stepsContainer.innerHTML = '';
                    progressContainer.style.display = 'none';
                    if (backBtn) backBtn.style.display = 'none';

                    const wrapper = document.createElement('div');
                    wrapper.className = 'survey-step-active';
                    wrapper.style.display = 'flex';
                    wrapper.style.flexDirection = 'column';
                    wrapper.style.gap = '1.25rem';
                    wrapper.style.textAlign = 'left';

                    const title = document.createElement('h4');
                    title.style.margin = '0';
                    title.style.color = '#0f172a';
                    title.style.fontSize = '1.25rem';
                    title.style.fontWeight = '800';
                    title.textContent = 'Schedule Your Session';
                    wrapper.appendChild(title);

                    const desc = document.createElement('p');
                    desc.style.margin = '0';
                    desc.style.color = '#64748b';
                    desc.style.fontSize = '0.875rem';
                    desc.style.lineHeight = '1.5';
                    desc.textContent = 'Pick a convenient date and time to book your slots on Google Calendar.';
                    wrapper.appendChild(desc);

                    const daysGrid = document.createElement('div');
                    daysGrid.className = 'calendar-days-grid';
                    wrapper.appendChild(daysGrid);

                    const slotsTitle = document.createElement('h5');
                    slotsTitle.style.margin = '0 0 0.5rem';
                    slotsTitle.style.fontSize = '0.875rem';
                    slotsTitle.style.fontWeight = '700';
                    slotsTitle.style.color = '#475569';
                    slotsTitle.textContent = 'Available Slots:';
                    wrapper.appendChild(slotsTitle);

                    const slotsContainer = document.createElement('div');
                    slotsContainer.className = 'calendar-slots-grid';
                    wrapper.appendChild(slotsContainer);

                    const loadingIndicator = document.createElement('div');
                    loadingIndicator.style.fontSize = '0.875rem';
                    loadingIndicator.style.color = '#64748b';
                    loadingIndicator.style.padding = '1rem 0';
                    loadingIndicator.style.textAlign = 'center';
                    loadingIndicator.textContent = 'Loading slots...';

                    const days = getNextBookingDays();
                    let selectedDateStr = days[0].dateStr;

                    days.forEach(function(day, index) {
                        const dayBtn = document.createElement('button');
                        dayBtn.className = 'calendar-day-btn' + (index === 0 ? ' active' : '');
                        dayBtn.textContent = day.label;
                        dayBtn.addEventListener('click', function() {
                            const activeBtns = daysGrid.querySelectorAll('.calendar-day-btn');
                            activeBtns.forEach(btn => btn.classList.remove('active'));
                            dayBtn.classList.add('active');
                            selectedDateStr = day.dateStr;
                            loadSlots(day.dateStr);
                        });
                        daysGrid.appendChild(dayBtn);
                    });

                    async function loadSlots(dateStr) {
                        slotsContainer.innerHTML = '';
                        slotsContainer.appendChild(loadingIndicator);
                        try {
                            const res = await fetch('/api/shared/booking/slots?userId=' + encodeURIComponent(userId) + '&date=' + encodeURIComponent(dateStr));
                            const data = await res.json();
                            slotsContainer.innerHTML = '';

                            if (!res.ok) throw new Error(data.error || 'Failed to fetch slots');

                            const slots = data.slots || [];
                            if (slots.length === 0) {
                                const noSlots = document.createElement('div');
                                noSlots.style.gridColumn = 'span 2';
                                noSlots.style.fontSize = '0.875rem';
                                noSlots.style.color = '#64748b';
                                noSlots.style.padding = '1.5rem 0';
                                noSlots.style.textAlign = 'center';
                                noSlots.textContent = 'No slots available for this day.';
                                slotsContainer.appendChild(noSlots);
                                return;
                            }

                            slots.forEach(function(slotIso) {
                                const slotDate = new Date(slotIso);
                                const timeLabel = slotDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                
                                const slotBtn = document.createElement('button');
                                slotBtn.className = 'calendar-slot-btn';
                                slotBtn.textContent = timeLabel;
                                slotBtn.addEventListener('click', function() {
                                    showConfirmBooking(slotIso, timeLabel, dateStr);
                                });
                                slotsContainer.appendChild(slotBtn);
                            });
                        } catch (err) {
                            slotsContainer.innerHTML = '';
                            const errEl = document.createElement('div');
                            errEl.style.gridColumn = 'span 2';
                            errEl.style.fontSize = '0.875rem';
                            errEl.style.color = '#ef4444';
                            errEl.style.padding = '1.5rem 0';
                            errEl.style.textAlign = 'center';
                            errEl.style.fontWeight = '600';
                            errEl.textContent = 'Error loading slots: ' + err.message;
                            slotsContainer.appendChild(errEl);
                        }
                    }

                    const footer = document.createElement('div');
                    footer.style.display = 'flex';
                    footer.style.justifyContent = 'center';
                    footer.style.marginTop = '1rem';
                    footer.style.borderTop = '1px solid #e2e8f0';
                    footer.style.paddingTop = '1rem';

                    const skipBtn = document.createElement('button');
                    skipBtn.style.background = 'none';
                    skipBtn.style.border = 'none';
                    skipBtn.style.color = '#64748b';
                    skipBtn.style.fontSize = '0.875rem';
                    skipBtn.style.fontWeight = '600';
                    skipBtn.style.cursor = 'pointer';
                    skipBtn.textContent = 'Skip for now';
                    skipBtn.addEventListener('click', function() {
                        showSuccessDirect();
                    });
                    footer.appendChild(skipBtn);
                    wrapper.appendChild(footer);

                    stepsContainer.appendChild(wrapper);

                    // Load slots for first day
                    loadSlots(selectedDateStr);

                    function showConfirmBooking(slotIso, timeLabel, dateStr) {
                        stepsContainer.innerHTML = '';
                        
                        const confirmWrapper = document.createElement('div');
                        confirmWrapper.className = 'survey-step-active';
                        confirmWrapper.style.display = 'flex';
                        confirmWrapper.style.flexDirection = 'column';
                        confirmWrapper.style.gap = '1.25rem';
                        confirmWrapper.style.textAlign = 'center';
                        confirmWrapper.style.padding = '1rem 0';

                        const confirmTitle = document.createElement('h4');
                        confirmTitle.style.margin = '0';
                        confirmTitle.style.color = '#0f172a';
                        confirmTitle.style.fontSize = '1.25rem';
                        confirmTitle.style.fontWeight = '800';
                        confirmTitle.textContent = 'Confirm Your Appointment';
                        confirmWrapper.appendChild(confirmTitle);

                        const detailBox = document.createElement('div');
                        detailBox.style.background = '#f8fafc';
                        detailBox.style.border = '1px solid #e2e8f0';
                        detailBox.style.borderRadius = '0.75rem';
                        detailBox.style.padding = '1.25rem';
                        detailBox.style.display = 'flex';
                        detailBox.style.flexDirection = 'column';
                        detailBox.style.gap = '0.5rem';

                        const formattedDate = new Date(slotIso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

                        const dateEl = document.createElement('div');
                        dateEl.style.fontSize = '0.95rem';
                        dateEl.style.fontWeight = '700';
                        dateEl.style.color = '#1e293b';
                        dateEl.textContent = '📅  ' + formattedDate;
                        detailBox.appendChild(dateEl);

                        const timeEl = document.createElement('div');
                        timeEl.style.fontSize = '1.1rem';
                        timeEl.style.fontWeight = '800';
                        timeEl.style.color = brandColor;
                        timeEl.textContent = '⏰  ' + timeLabel;
                        detailBox.appendChild(timeEl);

                        confirmWrapper.appendChild(detailBox);

                        const actionBtn = document.createElement('button');
                        actionBtn.className = 'eligibility-submit-btn';
                        actionBtn.textContent = 'Confirm Booking';
                        confirmWrapper.appendChild(actionBtn);

                        const cancelBtn = document.createElement('button');
                        cancelBtn.className = 'eligibility-submit-btn';
                        cancelBtn.style.setProperty('background', '#f1f5f9', 'important');
                        cancelBtn.style.setProperty('color', '#475569', 'important');
                        cancelBtn.style.boxShadow = 'none';
                        cancelBtn.style.border = '1px solid #e2e8f0';
                        cancelBtn.textContent = 'Change Date/Time';
                        cancelBtn.addEventListener('click', function() {
                            renderCalendarBooking(leadId);
                        });
                        confirmWrapper.appendChild(cancelBtn);

                        const errorMsg = document.createElement('p');
                        errorMsg.style.margin = '0';
                        errorMsg.style.fontSize = '0.875rem';
                        errorMsg.style.color = '#ef4444';
                        errorMsg.style.fontWeight = '600';
                        errorMsg.style.display = 'none';
                        confirmWrapper.appendChild(errorMsg);

                        actionBtn.addEventListener('click', async function() {
                            actionBtn.disabled = true;
                            actionBtn.textContent = 'Booking...';
                            errorMsg.style.display = 'none';
                            cancelBtn.style.display = 'none';

                            try {
                                const eventId = 'evt_sched_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);
                                const bookingRes = await fetch('/api/shared/booking/create', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        lead_id: leadId,
                                        slot: slotIso,
                                        user_id: userId,
                                        eventId: eventId
                                    })
                                });

                                const bookingData = await bookingRes.json();
                                if (!bookingRes.ok || !bookingData.success) {
                                    throw new Error(bookingData.error || 'Booking failed');
                                }

                                showBookedSuccess(formattedDate, timeLabel);
                            } catch (err) {
                                errorMsg.textContent = err.message || 'Something went wrong. Please try again.';
                                errorMsg.style.display = 'block';
                                actionBtn.disabled = false;
                                actionBtn.textContent = 'Confirm Booking';
                                cancelBtn.style.display = 'block';
                            }
                        });

                        stepsContainer.appendChild(confirmWrapper);
                    }

                    function showBookedSuccess(dateLabel, timeLabel) {
                        stepsContainer.innerHTML = '';

                        const wrapper = document.createElement('div');
                        wrapper.className = 'survey-step-active';
                        wrapper.style.display = 'flex';
                        wrapper.style.flexDirection = 'column';
                        wrapper.style.alignItems = 'center';
                        wrapper.style.textAlign = 'center';
                        wrapper.style.gap = '1.25rem';
                        wrapper.style.padding = '1.5rem 0';

                        const iconContainer = document.createElement('div');
                        iconContainer.style.width = '4rem';
                        iconContainer.style.height = '4rem';
                        iconContainer.style.background = '#f0fdf4';
                        iconContainer.style.borderRadius = '50%';
                        iconContainer.style.display = 'flex';
                        iconContainer.style.alignItems = 'center';
                        iconContainer.style.justifyContent = 'center';
                        iconContainer.style.color = '#22c55e';
                        iconContainer.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m9 12 2 2 4-4"/></svg>';
                        wrapper.appendChild(iconContainer);

                        const title = document.createElement('h4');
                        title.style.margin = '0';
                        title.style.color = '#166534';
                        title.style.fontSize = '1.5rem';
                        title.style.fontWeight = '900';
                        title.textContent = 'Booking Confirmed!';
                        wrapper.appendChild(title);

                        const msgText = document.createElement('p');
                        msgText.style.margin = '0';
                        msgText.style.color = '#4b5563';
                        msgText.style.fontSize = '0.95rem';
                        msgText.style.lineHeight = '1.6';
                        msgText.style.fontWeight = '600';
                        msgText.innerHTML = 'Your appointment is scheduled for <br><span style="color:#0f172a; font-weight:800;">' + dateLabel + ' at ' + timeLabel + '</span>.<br>A Google Calendar invitation has been sent to your email.';
                        wrapper.appendChild(msgText);

                        const closeBtn2 = document.createElement('button');
                        closeBtn2.className = 'eligibility-submit-btn';
                        closeBtn2.style.setProperty('background', '#166534', 'important');
                        closeBtn2.style.setProperty('color', '#ffffff', 'important');
                        closeBtn2.style.boxShadow = 'none';
                        closeBtn2.textContent = 'Done';
                        closeBtn2.addEventListener('click', closeModal);
                        wrapper.appendChild(closeBtn2);

                        stepsContainer.appendChild(wrapper);
                    }
                }
                
                if (isSurvey) {
                    currentStep = 0;
                    renderStep();
                } else {
                    document.addEventListener('click', function(e) {
                        const target = e.target.closest('a');
                        if (target) {
                            const href = target.getAttribute('href') || '';
                            if (href === '#qualification-form-container') {
                                e.preventDefault();
                                openModal();
                                return;
                            }
                        }
                        
                        const btn = e.target.closest('.open-eligibility-modal-btn');
                        if (btn) {
                            e.preventDefault();
                            openModal();
                        }
                    });
                }
            })();
            </script>
        `

        // Meta Pixel tracking code
        let pixelScript = ''
        const pagePixelId = page.pixel_id || profile.pixel_id
        if (pagePixelId) {
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
                fbq('init', '${pagePixelId}');
                fbq('track', 'PageView');

                // Fire server-side CAPI PageView event via proxy
                fetch('/api/shared/capi-event', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId: '${profile.id}',
                        pixelId: '${pagePixelId}',
                        eventName: 'PageView',
                        eventID: 'evt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11),
                        sourceUrl: window.location.href
                    })
                }).catch(err => console.error('[CAPI Proxy Error]', err));
                </script>
                <noscript><img height="1" width="1" style="display:none"
                src="https://www.facebook.com/tr?id=${pagePixelId}&ev=PageView&noscript=1"
                /></noscript>
                <!-- End Meta Pixel Code -->
            `
        }

        // Fix any hallucinated "open-shared-space" portal links dynamically, converting them to ?catalog=true and forcing breakout target="_parent"
        const openSpaceRegex = /(<a\s+[^>]*href=["'])(?:https?:\/\/[^\/]+)?\/?(?:shared\/)?(?:open-shared-space|bc63c065-9bcc-4793-bedc-f0960406425b)(?:[\w\/-]*)?\/?(["'][^>]*>)/gi;
        finalHtml = finalHtml.replace(openSpaceRegex, (match: string, p1: string, p2: string) => {
            let tag = `${p1}/shared/${profile.id}?catalog=true${p2}`
            if (tag.includes('target="_blank"')) {
                tag = tag.replace('target="_blank"', 'target="_parent"')
            } else if (!tag.includes('target=')) {
                tag = tag.replace('<a ', '<a target="_parent" ')
            }
            return tag
        })

        const prodContainerRegex = /<div\s+[^>]*id="business-products-container"[^>]*>([\s\S]*?)<\/div>/gi
        if (finalHtml.match(prodContainerRegex) || slug === 'index') {
            let productsHtml = ''
            if (profile.business_landing_show_products !== false) {
                const { data: propertiesData } = await supabase
                    .from('properties')
                    .select('*')
                    .eq('user_id', profile.id)
                    .neq('show_on_landing_page', false)

                if (propertiesData && propertiesData.length > 0) {
                    productsHtml = `
                        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16" style="font-family: system-ui, -apple-system, sans-serif;">
                            <h2 class="text-3xl font-black text-slate-900 text-center mb-10">Our Featured Listings</h2>
                            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                                ${propertiesData.map(p => `
                                    <div class="bg-white rounded-3xl overflow-hidden shadow-md hover:shadow-xl transition-all border border-slate-100 flex flex-col h-full" style="box-sizing: border-box; display: flex; flex-direction: column;">
                                        <div class="relative aspect-[16/10] bg-slate-100" style="position: relative; aspect-ratio: 1.6; overflow: hidden;">
                                            <img src="${p.image_url || 'https://i.ibb.co/NdSPkfxQ/3bhk.webp'}" alt="${p.title}" class="w-full h-full object-cover" style="width: 100%; height: 100%; object-fit: cover;" />
                                            ${p.price ? `<span class="absolute bottom-4 left-4 bg-white/90 backdrop-blur text-slate-900 font-extrabold text-xs px-3 py-1.5 rounded-full shadow-sm" style="position: absolute; bottom: 1rem; left: 1rem; background: rgba(255, 255, 255, 0.9); font-weight: 800; font-size: 0.75rem; padding: 0.375rem 0.75rem; border-radius: 9999px;">${p.price}</span>` : ''}
                                        </div>
                                        <div class="p-6 flex-1 flex flex-col" style="padding: 1.5rem; display: flex; flex-direction: column; flex-grow: 1;">
                                            <h3 class="font-extrabold text-slate-900 text-lg mb-2" style="font-weight: 800; font-size: 1.125rem; margin: 0 0 0.5rem; color: #0f172a;">${p.title}</h3>
                                            <p class="text-slate-500 font-medium text-xs mb-4" style="color: #64748b; font-size: 0.75rem; line-height: 1.5; margin: 0 0 1rem; flex-grow: 1;">${p.description || ''}</p>
                                            ${p.address ? `
                                                <div class="flex items-center gap-1.5 text-slate-400 text-xs mb-4" style="display: flex; align-items: center; gap: 0.375rem; color: #94a3b8; font-size: 0.75rem; margin-bottom: 1rem;">
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>
                                                    <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${p.address}</span>
                                                </div>
                                            ` : ''}
                                            <div class="mt-auto pt-4 border-t border-slate-100" style="margin-top: auto; padding-top: 1rem; border-top: 1px solid #f1f5f9; display: flex;">
                                                <a href="/shared/${profile.id}?property=${p.id}" target="_parent" class="flex-1 bg-slate-900 text-white font-extrabold text-xs text-center py-2.5 rounded-xl hover:bg-slate-800 transition-colors" style="flex: 1; background: #0f172a; color: #ffffff; font-weight: 800; font-size: 0.75rem; text-align: center; text-decoration: none; padding: 0.625rem; border-radius: 0.75rem; display: block;">
                                                    View Listing
                                                </a>
                                            </div>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `
                }
            }

            if (finalHtml.match(prodContainerRegex)) {
                finalHtml = finalHtml.replace(prodContainerRegex, `<div id="business-products-container">${productsHtml}</div>`)
            } else if (finalHtml.includes('</body>')) {
                finalHtml = finalHtml.replace('</body>', `<div id="business-products-container">${productsHtml}</div></body>`)
            }
        }

        const containerRegex = /<div\s+[^>]*id="qualification-form-container"[^>]*>([\s\S]*?)<\/div>/gi
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
                'content-type': 'text/html; charset=utf-8',
                'cache-control': 'no-cache, no-store, must-revalidate',
                'pragma': 'no-cache',
                'expires': '0'
            }
        })
    } catch (e: any) {
        console.error("Shared Route Handler Error:", e)
        return new Response(`Internal Server Error: ${e.message}\nStack: ${e.stack}`, { status: 500 })
    }
}
