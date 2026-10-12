'use client'

import React, { useState, useEffect } from 'react'
import { 
  FileText, CheckCircle2, ShieldCheck, Sparkles, Plus, X, 
  Settings2, ChevronDown, ChevronUp, Layers, HelpCircle, 
  Phone, Mail, User, MapPin, Eye, ExternalLink, ArrowRight, Check
} from 'lucide-react'

export interface CustomFormQuestion {
  label: string
  type: 'SHORT_ANSWER' | 'MULTIPLE_CHOICE'
  options?: string[]
}

export interface InstantFormConfig {
  mode: 'new' | 'existing'
  existingFormId?: string
  formType: 'HIGHER_INTENT' | 'MORE_VOLUME'
  name: string
  headline: string
  greetingText: string
  includeCity: boolean
  questions: CustomFormQuestion[]
  privacyPolicyUrl: string
  privacyPolicyLinkText: string
  completionTitle: string
  completionBody: string
  completionButtonText: string
  completionAction: 'website' | 'whatsapp'
}

interface InstantFormCustomizerProps {
  config: InstantFormConfig
  onChange: (config: InstantFormConfig) => void
  existingForms: any[]
  isLoadingForms?: boolean
  businessName?: string
  defaultPrivacyUrl?: string
  defaultWebsiteUrl?: string
  whatsappNumber?: string
}

const PRESET_QUESTIONS: { key: string; label: string; question: CustomFormQuestion }[] = [
  {
    key: 'budget',
    label: 'Budget Range',
    question: {
      label: 'What is your budget range?',
      type: 'MULTIPLE_CHOICE',
      options: ['Under ₹50 Lakh', '₹50 Lakh - ₹1 Crore', '₹1 Crore - ₹2 Crore', '₹2 Crore+']
    }
  },
  {
    key: 'type',
    label: 'Property Type',
    question: {
      label: 'What property type are you looking for?',
      type: 'MULTIPLE_CHOICE',
      options: ['2 BHK Apartment', '3 BHK Apartment', 'Luxury Villa / Penthouse', 'Plot / Land']
    }
  },
  {
    key: 'timeline',
    label: 'Purchase Timeline',
    question: {
      label: 'When are you planning to buy?',
      type: 'MULTIPLE_CHOICE',
      options: ['Immediately (Within 30 days)', '1 - 3 Months', '3 - 6 Months', 'Just exploring']
    }
  },
  {
    key: 'visit',
    label: 'Site Visit Day',
    question: {
      label: 'When would you prefer a site visit?',
      type: 'MULTIPLE_CHOICE',
      options: ['This Weekend (Sat/Sun)', 'Next Weekday', 'Send details on WhatsApp first']
    }
  }
]

export default function InstantFormCustomizer({
  config,
  onChange,
  existingForms = [],
  isLoadingForms = false,
  businessName = 'Our Business',
  defaultPrivacyUrl = 'https://adrolls.in/privacy',
  defaultWebsiteUrl = 'https://adrolls.in',
  whatsappNumber = ''
}: InstantFormCustomizerProps) {
  const [activeTab, setActiveTab] = useState<'type' | 'intro' | 'questions' | 'privacy' | 'completion'>('type')
  const [isAddingQuestion, setIsAddingQuestion] = useState(false)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [newQuestion, setNewQuestion] = useState<CustomFormQuestion>({
    label: '',
    type: 'SHORT_ANSWER',
    options: ['']
  })

  const update = (partial: Partial<InstantFormConfig>) => {
    onChange({ ...config, ...partial })
  }

  const handleAddPreset = (preset: typeof PRESET_QUESTIONS[0]) => {
    if (!config.questions.some(q => q.label === preset.question.label)) {
      update({ questions: [...config.questions, preset.question] })
    }
  }

  const handleSaveQuestion = () => {
    if (!newQuestion.label.trim()) return
    const validOptions = (newQuestion.options || []).filter(o => o.trim() !== '')

    const finalizedQuestion: CustomFormQuestion = {
      label: newQuestion.label.trim(),
      type: newQuestion.type,
      ...(newQuestion.type === 'MULTIPLE_CHOICE' ? { options: validOptions.length > 0 ? validOptions : ['Yes', 'No'] } : {})
    }

    if (editingIdx !== null) {
      const updated = [...config.questions]
      updated[editingIdx] = finalizedQuestion
      update({ questions: updated })
    } else {
      update({ questions: [...config.questions, finalizedQuestion] })
    }

    setIsAddingQuestion(false)
    setEditingIdx(null)
    setNewQuestion({ label: '', type: 'SHORT_ANSWER', options: [''] })
  }

  return (
    <div className="bg-slate-50 border border-slate-200/80 rounded-[2rem] p-5 space-y-5">
      {/* Top Selector: New vs Existing */}
      <div className="flex items-center justify-between border-b border-slate-200/60 pb-4">
        <div>
          <label className="text-xs font-bold text-slate-800 uppercase tracking-widest flex items-center gap-2">
            <FileText size={16} className="text-blue-600" /> Meta Instant Form Customization
          </label>
          <p className="text-[11px] text-slate-500 font-medium mt-0.5">
            Configure native lead forms that open instantly on Instagram & Facebook.
          </p>
        </div>

        <div className="flex bg-slate-200/80 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => update({ mode: 'new' })}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
              config.mode === 'new' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Create New Form
          </button>
          <button
            type="button"
            onClick={() => update({ mode: 'existing' })}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
              config.mode === 'existing' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Select Existing ({existingForms.length})
          </button>
        </div>
      </div>

      {/* Mode 1: Select Existing Page Form */}
      {config.mode === 'existing' ? (
        <div className="space-y-3 bg-white p-4 rounded-2xl border border-slate-200">
          <label className="text-xs font-bold text-slate-700 block">Choose an Active Form from your Facebook Page</label>
          {isLoadingForms ? (
            <div className="text-xs text-slate-500 py-3">Fetching forms from Meta Page...</div>
          ) : existingForms.length === 0 ? (
            <div className="text-xs text-amber-700 bg-amber-50 p-3 rounded-xl border border-amber-200">
              No existing forms found on this Meta Page. Switch to <strong>Create New Form</strong> to publish one directly.
            </div>
          ) : (
            <div className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar">
              {existingForms.map(f => {
                const isSelected = config.existingFormId === f.id
                return (
                  <div
                    key={f.id}
                    onClick={() => update({ existingFormId: f.id })}
                    className={`p-3.5 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                      isSelected
                        ? 'bg-blue-50 border-blue-300 text-blue-900 shadow-xs'
                        : 'bg-white border-slate-200 hover:border-slate-300 text-slate-800'
                    }`}
                  >
                    <div>
                      <div className="text-xs font-bold truncate max-w-sm">{f.name}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        Status: <span className="font-semibold text-emerald-600">{f.status || 'ACTIVE'}</span> {f.leads_count !== undefined && `• ${f.leads_count} leads generated`}
                      </div>
                    </div>
                    {isSelected && <Check size={16} className="text-blue-600" />}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : (
        /* Mode 2: Create New Custom High-Intent Form */
        <div className="space-y-4">
          {/* Sub-tabs like Ads Manager */}
          <div className="flex border-b border-slate-200 text-xs font-bold gap-1 overflow-x-auto custom-scrollbar pb-1">
            <button
              type="button"
              onClick={() => setActiveTab('type')}
              className={`px-3 py-2 border-b-2 transition-all shrink-0 ${
                activeTab === 'type' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              1. Form Type (High Intent)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('intro')}
              className={`px-3 py-2 border-b-2 transition-all shrink-0 ${
                activeTab === 'intro' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              2. Intro & Greeting
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('questions')}
              className={`px-3 py-2 border-b-2 transition-all shrink-0 ${
                activeTab === 'questions' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              3. Questions ({config.questions.length + (config.includeCity ? 4 : 3)})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('privacy')}
              className={`px-3 py-2 border-b-2 transition-all shrink-0 ${
                activeTab === 'privacy' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              4. Privacy Policy
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('completion')}
              className={`px-3 py-2 border-b-2 transition-all shrink-0 ${
                activeTab === 'completion' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              5. Completion Screen
            </button>
          </div>

          {/* TAB 1: FORM TYPE */}
          {activeTab === 'type' && (
            <div className="space-y-3 bg-white p-4 rounded-2xl border border-slate-200 animate-in fade-in duration-200">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800">Form Submission Intent</span>
                <span className="text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <ShieldCheck size={12} /> Meta Recommended
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div
                  onClick={() => update({ formType: 'HIGHER_INTENT' })}
                  className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                    config.formType === 'HIGHER_INTENT'
                      ? 'border-blue-600 bg-blue-50/40 shadow-xs'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-slate-900">Higher Intent</span>
                    <input type="radio" checked={config.formType === 'HIGHER_INTENT'} readOnly className="accent-blue-600" />
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed">
                    Adds a confirmation review step with <strong>"Slide to Submit"</strong>. Gives leads a chance to verify their contact details before submitting, significantly reducing accidental clicks and junk leads.
                  </p>
                </div>

                <div
                  onClick={() => update({ formType: 'MORE_VOLUME' })}
                  className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                    config.formType === 'MORE_VOLUME'
                      ? 'border-blue-600 bg-blue-50/40 shadow-xs'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold text-slate-900">More Volume</span>
                    <input type="radio" checked={config.formType === 'MORE_VOLUME'} readOnly className="accent-blue-600" />
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed">
                    Quick form that can be submitted in one tap. Maximizes submission volume for broader reach.
                  </p>
                </div>
              </div>

              <div className="pt-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Form Name</label>
                <input
                  type="text"
                  value={config.name}
                  onChange={(e) => update({ name: e.target.value })}
                  placeholder="E.g. Luxury 3BHK - High Intent Lead Form"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>
          )}

          {/* TAB 2: INTRO & GREETING */}
          {activeTab === 'intro' && (
            <div className="space-y-3 bg-white p-4 rounded-2xl border border-slate-200 animate-in fade-in duration-200">
              <div>
                <label className="text-xs font-bold text-slate-800 block mb-1">Headline</label>
                <input
                  type="text"
                  value={config.headline}
                  onChange={(e) => update({ headline: e.target.value })}
                  placeholder="E.g. Get Pricing, Floor Plans & Exclusive Offers"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-800 block mb-1">Greeting & Offer Details</label>
                <textarea
                  value={config.greetingText}
                  onChange={(e) => update({ greetingText: e.target.value })}
                  placeholder="Explain why the customer should share their info and what they receive (brochure, price sheet, discount coupon)..."
                  rows={3}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
                />
              </div>
            </div>
          )}

          {/* TAB 3: QUESTIONS */}
          {activeTab === 'questions' && (
            <div className="space-y-4 bg-white p-4 rounded-2xl border border-slate-200 animate-in fade-in duration-200">
              {/* Standard Meta Pre-filled Contact Fields */}
              <div>
                <label className="text-xs font-bold text-slate-800 block mb-2">Pre-filled Contact Fields (from User Profile)</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="flex items-center gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700">
                    <CheckCircle2 size={14} className="text-blue-600" /> Full Name
                  </div>
                  <div className="flex items-center gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700">
                    <CheckCircle2 size={14} className="text-blue-600" /> Phone Number
                  </div>
                  <div className="flex items-center gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700">
                    <CheckCircle2 size={14} className="text-blue-600" /> Email
                  </div>
                  <label className="flex items-center gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={config.includeCity}
                      onChange={(e) => update({ includeCity: e.target.checked })}
                      className="accent-blue-600 rounded"
                    />
                    City / Location
                  </label>
                </div>
              </div>

              {/* Custom Qualifying Questions */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-slate-800">Custom Qualifying Questions</label>
                  <span className="text-[10px] text-slate-400 font-medium">Increases lead intent</span>
                </div>

                {config.questions.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {config.questions.map((q, idx) => (
                      <div key={idx} className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                        <div>
                          <div className="text-xs font-bold text-slate-800">{q.label}</div>
                          <div className="text-[10px] text-slate-400 flex items-center gap-2 mt-0.5">
                            <span className="bg-blue-100 text-blue-700 font-bold px-1.5 py-0.2 rounded uppercase">
                              {q.type === 'MULTIPLE_CHOICE' ? 'Multiple Choice' : 'Short Answer'}
                            </span>
                            {q.options && q.options.length > 0 && (
                              <span>Options: {q.options.join(', ')}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingIdx(idx)
                              setNewQuestion(q)
                              setIsAddingQuestion(true)
                            }}
                            className="p-1 text-slate-400 hover:text-blue-600"
                          >
                            <Settings2 size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => update({ questions: config.questions.filter((_, i) => i !== idx) })}
                            className="p-1 text-slate-400 hover:text-red-600"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add Question Dialog / Inline Form */}
                {isAddingQuestion ? (
                  <div className="p-3.5 bg-blue-50/50 border border-blue-200 rounded-xl space-y-3">
                    <div>
                      <label className="text-[10px] font-bold text-blue-900 block mb-1">Question Title</label>
                      <input
                        type="text"
                        value={newQuestion.label}
                        onChange={(e) => setNewQuestion({ ...newQuestion, label: e.target.value })}
                        placeholder="E.g. What is your purchase budget?"
                        className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs font-medium"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-blue-900 block mb-1">Question Format</label>
                      <select
                        value={newQuestion.type}
                        onChange={(e) => setNewQuestion({ ...newQuestion, type: e.target.value as any })}
                        className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs font-medium cursor-pointer"
                      >
                        <option value="SHORT_ANSWER">Short Answer (User types response)</option>
                        <option value="MULTIPLE_CHOICE">Multiple Choice (Dropdown / Buttons)</option>
                      </select>
                    </div>

                    {newQuestion.type === 'MULTIPLE_CHOICE' && (
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-blue-900 block">Choices</label>
                        {(newQuestion.options || []).map((opt, oIdx) => (
                          <div key={oIdx} className="flex gap-2">
                            <input
                              type="text"
                              value={opt}
                              onChange={(e) => {
                                const updated = [...(newQuestion.options || [])]
                                updated[oIdx] = e.target.value
                                setNewQuestion({ ...newQuestion, options: updated })
                              }}
                              placeholder={`Option ${oIdx + 1}`}
                              className="flex-1 bg-white border border-slate-200 rounded-lg p-1.5 text-xs font-medium"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const updated = (newQuestion.options || []).filter((_, i) => i !== oIdx)
                                setNewQuestion({ ...newQuestion, options: updated })
                              }}
                              className="text-slate-400 hover:text-red-500 p-1"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => setNewQuestion({ ...newQuestion, options: [...(newQuestion.options || []), ''] })}
                          className="text-[11px] font-bold text-blue-600 hover:underline pt-1 flex items-center gap-1"
                        >
                          <Plus size={12} /> Add another choice
                        </button>
                      </div>
                    )}

                    <div className="flex gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setIsAddingQuestion(false)
                          setEditingIdx(null)
                        }}
                        className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-600"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveQuestion}
                        className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold"
                      >
                        {editingIdx !== null ? 'Update Question' : 'Save Question'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      {PRESET_QUESTIONS.map(p => (
                        <button
                          key={p.key}
                          type="button"
                          onClick={() => handleAddPreset(p)}
                          className="text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1.5 rounded-xl hover:bg-blue-100 transition-colors flex items-center gap-1"
                        >
                          <Plus size={12} /> {p.label}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          setEditingIdx(null)
                          setNewQuestion({ label: '', type: 'SHORT_ANSWER', options: [''] })
                          setIsAddingQuestion(true)
                        }}
                        className="text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200 px-3 py-1.5 rounded-xl hover:bg-slate-200 transition-colors flex items-center gap-1"
                      >
                        <Plus size={12} /> Custom Question
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: PRIVACY POLICY */}
          {activeTab === 'privacy' && (
            <div className="space-y-3 bg-white p-4 rounded-2xl border border-slate-200 animate-in fade-in duration-200">
              <div>
                <label className="text-xs font-bold text-slate-800 block mb-1">Privacy Policy URL</label>
                <input
                  type="url"
                  value={config.privacyPolicyUrl}
                  onChange={(e) => update({ privacyPolicyUrl: e.target.value })}
                  placeholder="https://yourdomain.com/privacy"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/20"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Required by Meta Ads Policy for all Lead Gen Instant Forms.
                </p>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-800 block mb-1">Link Text</label>
                <input
                  type="text"
                  value={config.privacyPolicyLinkText}
                  onChange={(e) => update({ privacyPolicyLinkText: e.target.value })}
                  placeholder="Privacy Policy"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>
          )}

          {/* TAB 5: COMPLETION SCREEN */}
          {activeTab === 'completion' && (
            <div className="space-y-3 bg-white p-4 rounded-2xl border border-slate-200 animate-in fade-in duration-200">
              <div>
                <label className="text-xs font-bold text-slate-800 block mb-1">Completion Headline</label>
                <input
                  type="text"
                  value={config.completionTitle}
                  onChange={(e) => update({ completionTitle: e.target.value })}
                  placeholder="E.g. Thanks! You're all set."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-800 block mb-1">Completion Message</label>
                <textarea
                  value={config.completionBody}
                  onChange={(e) => update({ completionBody: e.target.value })}
                  placeholder="E.g. Our property specialist will share the floor plans & brochure on WhatsApp shortly."
                  rows={2}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-800 block mb-1.5">Action Button</label>
                <div className="flex bg-slate-100 p-1 rounded-xl mb-2">
                  <button
                    type="button"
                    onClick={() => update({ completionAction: 'website', completionButtonText: 'Visit Website' })}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${
                      config.completionAction === 'website' ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-500'
                    }`}
                  >
                    Visit Website
                  </button>
                  <button
                    type="button"
                    onClick={() => update({ completionAction: 'whatsapp', completionButtonText: 'Chat on WhatsApp' })}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${
                      config.completionAction === 'whatsapp' ? 'bg-white text-emerald-600 shadow-xs' : 'text-slate-500'
                    }`}
                  >
                    Chat on WhatsApp
                  </button>
                </div>

                <input
                  type="text"
                  value={config.completionButtonText}
                  onChange={(e) => update({ completionButtonText: e.target.value })}
                  placeholder="Call to Action Button Label"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
