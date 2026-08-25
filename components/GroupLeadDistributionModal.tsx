'use client';

import React, { useState, useEffect } from 'react';
import { 
  X, Plus, Trash2, Users, Layers, ArrowRight, RefreshCw, CheckCircle2, 
  ChevronDown, Sparkles, UserCheck, Shield, SlidersHorizontal, AlertCircle, Search
} from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/utils/supabase/client';
import { matchesCampaignRule } from '@/utils/campaign-matcher';

export interface DistributionGroupMember {
  userId: string;
  name: string;
  weight: number;
}

export interface DistributionGroup {
  id: string;
  group_name: string;
  members: DistributionGroupMember[];
  campaigns: string[];
  is_active: boolean;
  last_assigned_user_id?: string | null;
  last_assigned_user_name?: string | null;
  last_assigned_at?: string | null;
  db_automation_id?: string;
}

interface GroupLeadDistributionModalProps {
  isOpen: boolean;
  onClose: () => void;
  team: any[];
  campaigns: (string | { id: string; name: string })[];
  leads: any[];
  targetUserId: string;
  impersonateId?: string | null;
  onLeadsUpdated: () => void;
}

export default function GroupLeadDistributionModal({
  isOpen,
  onClose,
  team = [],
  campaigns = [],
  leads = [],
  targetUserId,
  impersonateId,
  onLeadsUpdated
}: GroupLeadDistributionModalProps) {
  const supabase = createClient();
  const [groups, setGroups] = useState<DistributionGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDistributing, setIsDistributing] = useState<string | null>(null);

  // New Group Modal / Inline Form State
  const [isAddingGroup, setIsAddingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedUserToAdd, setSelectedUserToAdd] = useState<Record<string, string>>({});
  
  // Searchable Campaign Picker State
  const [activePickerGroupId, setActivePickerGroupId] = useState<string | null>(null);
  const [campaignSearchQuery, setCampaignSearchQuery] = useState('');

  // Flatten campaign names list
  const campaignNamesList = Array.from(new Set(
    campaigns.map(c => typeof c === 'string' ? c : (c?.name || '')).filter(Boolean)
  ));

  // Fetch saved groups from automations table on load
  useEffect(() => {
    if (isOpen && targetUserId) {
      fetchGroups();
    }
  }, [isOpen, targetUserId]);

  const fetchGroups = async () => {
    setLoading(true);
    try {
      const { data: automations, error } = await supabase
        .from('automations')
        .select('*')
        .eq('user_id', targetUserId)
        .like('title', 'Group-Distribution:%');

      if (error) throw error;

      const loadedGroups: DistributionGroup[] = [];

      if (automations && automations.length > 0) {
        for (const aut of automations) {
          try {
            const parsed = JSON.parse(aut.description || '{}');
            const gName = aut.title.replace('Group-Distribution:', '').trim();
            loadedGroups.push({
              id: parsed.id || aut.id,
              group_name: parsed.group_name || gName,
              members: Array.isArray(parsed.members) ? parsed.members : [],
              campaigns: Array.isArray(parsed.campaigns) ? parsed.campaigns : [],
              is_active: aut.is_active ?? true,
              last_assigned_user_id: parsed.last_assigned_user_id || null,
              last_assigned_user_name: parsed.last_assigned_user_name || null,
              last_assigned_at: parsed.last_assigned_at || null,
              db_automation_id: aut.id
            });
          } catch (e) {
            console.error('Error parsing group automation rule:', e);
          }
        }
      }

      setGroups(loadedGroups);
    } catch (err: any) {
      console.error('Failed to load distribution groups:', err);
      toast.error('Failed to load distribution groups: ' + (err.message || String(err)));
    } finally {
      setLoading(false);
    }
  };

  const saveGroupRuleToDb = async (group: DistributionGroup) => {
    try {
      const ruleTitle = `Group-Distribution: ${group.group_name.trim()}`;
      const payloadDescription = JSON.stringify({
        id: group.id,
        group_name: group.group_name.trim(),
        members: group.members,
        campaigns: group.campaigns,
        last_assigned_user_id: group.last_assigned_user_id || null,
        last_assigned_user_name: group.last_assigned_user_name || null,
        last_assigned_at: group.last_assigned_at || null
      });

      if (group.db_automation_id) {
        await supabase
          .from('automations')
          .update({
            title: ruleTitle,
            description: payloadDescription,
            is_active: group.is_active
          })
          .eq('id', group.db_automation_id);
      } else {
        const { data: inserted } = await supabase
          .from('automations')
          .insert({
            user_id: targetUserId,
            title: ruleTitle,
            description: payloadDescription,
            is_active: group.is_active
          })
          .select('id')
          .single();

        if (inserted) {
          group.db_automation_id = inserted.id;
        }
      }
    } catch (err) {
      console.error('Error saving group rule to DB:', err);
    }
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) {
      return toast.error('Please enter a group name.');
    }

    const nameClean = newGroupName.trim();
    if (groups.some(g => g.group_name.toLowerCase() === nameClean.toLowerCase())) {
      return toast.error('A group with this name already exists.');
    }

    setIsSaving(true);
    try {
      const newGroupObj: DistributionGroup = {
        id: 'grp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        group_name: nameClean,
        members: [],
        campaigns: [],
        is_active: true
      };

      await saveGroupRuleToDb(newGroupObj);
      setGroups(prev => [...prev, newGroupObj]);
      setNewGroupName('');
      setIsAddingGroup(false);
      toast.success(`Group "${nameClean}" created successfully!`);
    } catch (err: any) {
      toast.error('Failed to create group: ' + (err.message || String(err)));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteGroup = async (groupId: string, groupName: string) => {
    if (!confirm(`Are you sure you want to delete group "${groupName}"?`)) return;

    try {
      const targetGroup = groups.find(g => g.id === groupId);
      if (targetGroup?.db_automation_id) {
        await supabase
          .from('automations')
          .delete()
          .eq('id', targetGroup.db_automation_id);
      } else {
        await supabase
          .from('automations')
          .delete()
          .eq('user_id', targetUserId)
          .eq('title', `Group-Distribution: ${groupName}`);
      }

      setGroups(prev => prev.filter(g => g.id !== groupId));
      toast.success(`Group "${groupName}" deleted.`);
    } catch (err: any) {
      toast.error('Failed to delete group: ' + (err.message || String(err)));
    }
  };

  // Member management inside a group
  const handleAddMemberToGroup = (groupId: string, userId: string) => {
    if (!userId) return;
    const teamMember = team.find(t => t.id === userId);
    if (!teamMember) return;

    const memberName = teamMember.business_name || teamMember.full_name || teamMember.email || 'Agent';

    setGroups(prev => prev.map(g => {
      if (g.id === groupId) {
        if (g.members.some(m => m.userId === userId)) {
          toast.error(`${memberName} is already in this group.`);
          return g;
        }
        const updatedMembers = [...g.members, { userId, name: memberName, weight: 1 }];
        const updatedGroup = { ...g, members: updatedMembers };
        saveGroupRuleToDb(updatedGroup);
        return updatedGroup;
      }
      return g;
    }));

    setSelectedUserToAdd(prev => ({ ...prev, [groupId]: '' }));
  };

  const handleUpdateMemberWeight = (groupId: string, userId: string, delta: number) => {
    setGroups(prev => prev.map(g => {
      if (g.id === groupId) {
        const updatedMembers = g.members.map(m => {
          if (m.userId === userId) {
            const newWeight = Math.max(1, m.weight + delta);
            return { ...m, weight: newWeight };
          }
          return m;
        });
        const updatedGroup = { ...g, members: updatedMembers };
        saveGroupRuleToDb(updatedGroup);
        return updatedGroup;
      }
      return g;
    }));
  };

  const handleRemoveMember = (groupId: string, userId: string) => {
    setGroups(prev => prev.map(g => {
      if (g.id === groupId) {
        const updatedMembers = g.members.filter(m => m.userId !== userId);
        const updatedGroup = { ...g, members: updatedMembers };
        saveGroupRuleToDb(updatedGroup);
        return updatedGroup;
      }
      return g;
    }));
  };

  // Campaign management inside a group
  const handleAddCampaignToGroup = (groupId: string, campaignName: string) => {
    if (!campaignName) return;

    setGroups(prev => prev.map(g => {
      if (g.id === groupId) {
        if (g.campaigns.includes(campaignName)) {
          toast.error(`Campaign "${campaignName}" is already assigned to this group.`);
          return g;
        }
        const updatedCampaigns = [...g.campaigns, campaignName];
        const updatedGroup = { ...g, campaigns: updatedCampaigns };
        saveGroupRuleToDb(updatedGroup);
        return updatedGroup;
      }
      return g;
    }));
  };

  const handleRemoveCampaign = (groupId: string, campaignName: string) => {
    setGroups(prev => prev.map(g => {
      if (g.id === groupId) {
        const updatedCampaigns = g.campaigns.filter(c => c !== campaignName);
        const updatedGroup = { ...g, campaigns: updatedCampaigns };
        saveGroupRuleToDb(updatedGroup);
        return updatedGroup;
      }
      return g;
    }));
  };

  // Distribute All Matching Leads for a group using weighted ratio algorithm
  const handleDistributeGroupLeads = async (group: DistributionGroup) => {
    if (group.members.length === 0) {
      return toast.error(`Please add at least one team member to group "${group.group_name}".`);
    }
    if (group.campaigns.length === 0) {
      return toast.error(`Please assign at least one campaign to group "${group.group_name}".`);
    }

    setIsDistributing(group.id);
    try {
      // 1. Fetch ALL leads from DB for this workspace to ensure full coverage
      const { data: dbLeads, error: fetchErr } = await supabase
        .from('leads')
        .select('id, name, phone, assigned_to, user_id, campaign_id, ad_name, form_name, custom_fields')
        .eq('user_id', targetUserId)
        .order('created_at', { ascending: true });

      if (fetchErr) throw fetchErr;

      const allWorkspaceLeads = dbLeads || [];

      // 2. Filter leads matching group's campaigns
      const matchingLeads = allWorkspaceLeads.filter(l => {
        const leadCtx = {
          campaignId: l.campaign_id,
          campaignName: l.custom_fields?.meta_ad_origin?.campaign_name || l.ad_name,
          adName: l.ad_name || l.custom_fields?.meta_ad_origin?.ad_name,
          formName: l.form_name,
          adCampaignString: l.ad_name
        };

        return group.campaigns.some(gc => matchesCampaignRule(gc, leadCtx));
      });

      if (matchingLeads.length === 0) {
        return toast.error(`No leads found matching group "${group.group_name}" campaigns.`);
      }

      // 3. Build weighted sequence pool
      const weightedPool: DistributionGroupMember[] = [];
      group.members.forEach(m => {
        for (let i = 0; i < Math.max(1, m.weight); i++) {
          weightedPool.push(m);
        }
      });

      let currentPointer = 0;
      if (group.last_assigned_user_id) {
        const lastIdx = weightedPool.findIndex(m => m.userId === group.last_assigned_user_id);
        if (lastIdx !== -1) {
          currentPointer = (lastIdx + 1) % weightedPool.length;
        }
      }

      let lastAssignedMember: DistributionGroupMember = weightedPool[currentPointer];
      const updatesByAgent: Record<string, string[]> = {};
      group.members.forEach(m => { updatesByAgent[m.userId] = []; });

      for (const lead of matchingLeads) {
        const assignedMember = weightedPool[currentPointer];
        updatesByAgent[assignedMember.userId].push(lead.id);

        lastAssignedMember = assignedMember;
        currentPointer = (currentPointer + 1) % weightedPool.length;
      }

      // 4. Batch update leads in database by agent
      const updatePromises = Object.entries(updatesByAgent).map(async ([agentId, leadIds]) => {
        if (leadIds.length === 0) return;
        // Chunk into batches of 100
        for (let i = 0; i < leadIds.length; i += 100) {
          const chunk = leadIds.slice(i, i + 100);
          await supabase
            .from('leads')
            .update({ assigned_to: agentId })
            .in('id', chunk);
        }
      });

      await Promise.all(updatePromises);

      // 5. Update group rule with last assigned user
      const updatedGroup: DistributionGroup = {
        ...group,
        last_assigned_user_id: lastAssignedMember.userId,
        last_assigned_user_name: lastAssignedMember.name,
        last_assigned_at: new Date().toISOString()
      };

      await saveGroupRuleToDb(updatedGroup);
      setGroups(prev => prev.map(g => g.id === group.id ? updatedGroup : g));

      toast.success(`Distributed ${matchingLeads.length} leads across ${group.members.length} agents in "${group.group_name}"!`);
      onLeadsUpdated();
    } catch (err: any) {
      console.error('Failed to distribute group leads:', err);
      toast.error('Failed to distribute group leads: ' + (err.message || String(err)));
    } finally {
      setIsDistributing(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/70 backdrop-blur-md p-2 sm:p-4 overflow-y-auto animate-in fade-in duration-200"
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full max-w-6xl rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-100 overflow-hidden flex flex-col my-auto max-h-[80vh] sm:max-h-[90vh]"
      >
        
        {/* Header */}
        <div className="bg-slate-900 text-white px-4 sm:px-6 py-3.5 sm:py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <div className="p-2 sm:p-2.5 bg-blue-500/20 text-blue-400 rounded-xl sm:rounded-2xl border border-blue-400/30 shrink-0">
              <SlidersHorizontal size={18} className="sm:w-5 sm:h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-black tracking-tight text-white">
                  Lead Distribution Groups
                </h2>
                <span className="text-[9px] sm:text-xs bg-blue-500 text-white px-2 py-0.5 rounded-full font-black uppercase tracking-wider">
                  Weighted
                </span>
              </div>
              <p className="text-[10px] sm:text-xs text-slate-400 font-medium hidden sm:block">
                Set employee lead weightage & link Facebook ad campaigns
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              onClick={() => setIsAddingGroup(true)}
              className="bg-blue-600 hover:bg-blue-500 text-white px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl text-xs font-bold flex items-center gap-1 shadow-md shadow-blue-600/30 transition-all cursor-pointer active:scale-98"
            >
              <Plus size={15} /> <span className="hidden sm:inline">Create Group</span><span className="sm:hidden">Create</span>
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-xl text-xs font-black flex items-center gap-1 border border-slate-700 transition-all cursor-pointer active:scale-95"
              title="Close Modal"
            >
              <X size={16} />
              <span className="hidden sm:inline">Close</span>
            </button>
          </div>
        </div>

        {/* Modal Body - Touch Pan Scroll Enabled */}
        <div className="p-3 sm:p-6 overflow-y-auto space-y-4 sm:space-y-6 flex-1 bg-slate-50/50 custom-scrollbar touch-pan-y">

          {/* Inline Create Group Banner */}
          {isAddingGroup && (
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200/80 rounded-2xl p-3.5 sm:p-4 animate-in slide-in-from-top-2">
              <div className="flex items-center justify-between mb-2 sm:mb-3">
                <span className="text-xs font-extrabold text-blue-900 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles size={14} className="text-blue-600" /> Create New Distribution Group
                </span>
                <button onClick={() => setIsAddingGroup(false)} className="text-slate-400 hover:text-slate-600 p-1">
                  <X size={16} />
                </button>
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
                <input
                  type="text"
                  placeholder="Enter Group Name (e.g. all1, Luxury Projects Team)..."
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  className="flex-1 bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/30 shadow-xs"
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateGroup()}
                />
                <button
                  onClick={handleCreateGroup}
                  disabled={isSaving}
                  className="bg-blue-600 text-white px-5 py-2 rounded-xl text-xs font-bold shadow-sm hover:bg-blue-500 transition-all cursor-pointer disabled:opacity-50"
                >
                  {isSaving ? 'Creating...' : 'Save Group'}
                </button>
              </div>
            </div>
          )}

          {/* Content Loading & Empty States */}
          {loading ? (
            <div className="py-16 text-center text-slate-400 font-bold text-xs flex flex-col items-center justify-center gap-3">
              <RefreshCw size={24} className="animate-spin text-blue-600" />
              <span>Loading Lead Distribution Groups...</span>
            </div>
          ) : groups.length === 0 ? (
            <div className="py-12 sm:py-16 bg-white rounded-2xl sm:rounded-3xl border border-dashed border-slate-200 text-center flex flex-col items-center justify-center gap-3 p-4">
              <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
                <Users size={24} />
              </div>
              <h3 className="text-sm font-extrabold text-slate-800">No Distribution Groups Configured</h3>
              <p className="text-xs text-slate-500 max-w-md">Create your first employee distribution group to assign specific campaigns and set lead weightage frequency per team member.</p>
              <button
                onClick={() => setIsAddingGroup(true)}
                className="mt-2 bg-blue-600 text-white px-5 py-2.5 rounded-xl text-xs font-bold hover:bg-blue-500 shadow-sm transition-all"
              >
                + Create Group Now
              </button>
            </div>
          ) : (
            <>
              {/* MOBILE CARDS VIEW (md:hidden) */}
              <div className="block md:hidden space-y-3">
                {groups.map((group) => {
                  const availableUsers = team.filter(t => !group.members.some(m => m.userId === t.id));
                  const availableCampaigns = campaignNamesList.filter(c => !group.campaigns.includes(c));

                  return (
                    <div key={group.id} className="bg-white rounded-2xl border border-slate-200/80 p-3.5 space-y-3 shadow-xs">
                      
                      {/* Mobile Card Header */}
                      <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                          <span className="font-black text-slate-900 text-sm">{group.group_name}</span>
                          <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md">
                            {group.members.length} member(s)
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleDistributeGroupLeads(group)}
                            disabled={isDistributing === group.id}
                            className="bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 px-2.5 py-1 rounded-xl text-[11px] font-extrabold flex items-center gap-1 transition-all cursor-pointer disabled:opacity-50"
                          >
                            <RefreshCw size={12} className={isDistributing === group.id ? 'animate-spin' : ''} />
                            <span>{isDistributing === group.id ? '...' : 'Distribute'}</span>
                          </button>
                          <button
                            onClick={() => handleDeleteGroup(group.id, group.group_name)}
                            className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg transition-colors cursor-pointer"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>

                      {/* Mobile Section 1: Selected Users & Weightage */}
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">
                          Selected Users & Weightage Ratio
                        </label>
                        <div className="space-y-1.5">
                          {group.members.length === 0 ? (
                            <span className="text-slate-400 text-xs italic block">No team members added</span>
                          ) : (
                            group.members.map((m) => (
                              <div key={m.userId} className="flex items-center justify-between bg-slate-50 border border-slate-200/80 px-2.5 py-1.5 rounded-xl text-xs">
                                <div className="flex items-center gap-1.5 font-bold text-slate-800 truncate max-w-[170px]">
                                  <UserCheck size={13} className="text-blue-600 shrink-0" />
                                  <span className="truncate">{m.name}</span>
                                  <span className="text-red-500 font-extrabold">({m.weight})</span>
                                </div>

                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    onClick={() => handleUpdateMemberWeight(group.id, m.userId, 1)}
                                    className="w-6 h-6 bg-white hover:bg-slate-200 border border-slate-300 rounded-lg font-black text-slate-700 flex items-center justify-center text-xs cursor-pointer active:scale-95"
                                  >
                                    +
                                  </button>
                                  <button
                                    onClick={() => handleUpdateMemberWeight(group.id, m.userId, -1)}
                                    className="w-6 h-6 bg-white hover:bg-slate-200 border border-slate-300 rounded-lg font-black text-slate-700 flex items-center justify-center text-xs cursor-pointer active:scale-95"
                                  >
                                    -
                                  </button>
                                  <button
                                    onClick={() => handleRemoveMember(group.id, m.userId)}
                                    className="p-1 text-slate-400 hover:text-red-600 ml-1 cursor-pointer"
                                  >
                                    <X size={14} />
                                  </button>
                                </div>
                              </div>
                            ))
                          )}

                          {availableUsers.length > 0 && (
                            <div className="pt-0.5">
                              <select
                                value={selectedUserToAdd[group.id] || ''}
                                onChange={(e) => handleAddMemberToGroup(group.id, e.target.value)}
                                className="w-full appearance-none bg-blue-50/70 hover:bg-blue-100 border border-blue-200 text-blue-800 text-xs font-extrabold rounded-xl px-2.5 py-1.5 cursor-pointer outline-none transition-all"
                              >
                                <option value="">+ Add User</option>
                                {availableUsers.map(u => (
                                  <option key={u.id} value={u.id}>
                                    {u.business_name || u.full_name || u.email}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Mobile Section 2: Selected Integrations / Campaigns */}
                      <div className="space-y-1.5 pt-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">
                          Selected Campaigns ({group.campaigns.length})
                        </label>
                        <div className="flex flex-wrap gap-1.5 items-center">
                          {group.campaigns.length === 0 ? (
                            <span className="text-slate-400 text-xs italic block">No campaigns assigned</span>
                          ) : (
                            group.campaigns.map((camp) => (
                              <span
                                key={camp}
                                className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-800 border border-emerald-200 px-2.5 py-1 rounded-xl text-[11px] font-bold"
                              >
                                <span className="max-w-[180px] truncate" title={camp}>{camp}</span>
                                <button
                                  onClick={() => handleRemoveCampaign(group.id, camp)}
                                  className="text-emerald-500 hover:text-emerald-900 cursor-pointer"
                                >
                                  <X size={12} />
                                </button>
                              </span>
                            ))
                          )}

                          {availableCampaigns.length > 0 && (
                            <div className="w-full pt-1">
                              <button
                                onClick={() => {
                                  setActivePickerGroupId(group.id);
                                  setCampaignSearchQuery('');
                                }}
                                className="w-full bg-emerald-100/80 hover:bg-emerald-200 border border-emerald-300 text-emerald-900 text-xs font-extrabold rounded-xl px-3 py-1.5 cursor-pointer transition-all shadow-xs flex items-center justify-center gap-1.5"
                              >
                                <Search size={13} />
                                <span>+ Add / Search Campaigns ({availableCampaigns.length} available)</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Mobile Section 3: Last Assigned Agent */}
                      {group.last_assigned_user_name && (
                        <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[10px]">
                          <span className="font-bold text-slate-400">Last Lead Assigned To:</span>
                          <span className="bg-slate-100 text-slate-800 border border-slate-200 px-2.5 py-0.5 rounded-full font-black">
                            {group.last_assigned_user_name}
                          </span>
                        </div>
                      )}

                    </div>
                  );
                })}
              </div>

              {/* DESKTOP TABLE VIEW (hidden md:block) */}
              <div className="hidden md:block bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[850px]">
                    <thead>
                      <tr className="bg-slate-100/80 border-b border-slate-200/80 text-[10px] font-black text-slate-500 uppercase tracking-wider">
                        <th className="py-3.5 px-4 w-44">Group Name</th>
                        <th className="py-3.5 px-4 w-72">Selected Users & Weightage</th>
                        <th className="py-3.5 px-4">Selected Integrations / Campaigns</th>
                        <th className="py-3.5 px-4 w-48 text-center">Last Lead Assigned To</th>
                        <th className="py-3.5 px-4 w-32 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {groups.map((group) => {
                        const availableUsers = team.filter(t => !group.members.some(m => m.userId === t.id));
                        const availableCampaigns = campaignNamesList.filter(c => !group.campaigns.includes(c));

                        return (
                          <tr key={group.id} className="hover:bg-slate-50/60 transition-colors">
                            
                            {/* 1. Group Name */}
                            <td className="py-4 px-4 font-black text-slate-800 align-top">
                              <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                                <span className="text-sm font-black text-slate-900">{group.group_name}</span>
                              </div>
                              <div className="text-[10px] font-bold text-slate-400 mt-1">
                                {group.members.length} member(s) • {group.campaigns.length} campaign(s)
                              </div>
                            </td>

                            {/* 2. Selected Users & Weightage */}
                            <td className="py-4 px-4 align-top">
                              <div className="space-y-2">
                                {group.members.length === 0 ? (
                                  <span className="text-slate-400 text-xs italic">No team members added</span>
                                ) : (
                                  group.members.map((m) => (
                                    <div key={m.userId} className="flex items-center justify-between bg-slate-50 border border-slate-200/80 px-2.5 py-1.5 rounded-xl text-xs">
                                      <div className="flex items-center gap-1.5 font-bold text-slate-800 truncate max-w-[130px]">
                                        <UserCheck size={13} className="text-blue-600 shrink-0" />
                                        <span className="truncate">{m.name}</span>
                                        <span className="text-red-500 font-extrabold">({m.weight})</span>
                                      </div>
                                      
                                      <div className="flex items-center gap-1 shrink-0">
                                        <button
                                          onClick={() => handleUpdateMemberWeight(group.id, m.userId, 1)}
                                          className="w-5 h-5 bg-white hover:bg-slate-200 border border-slate-300 rounded font-black text-slate-700 flex items-center justify-center text-xs cursor-pointer"
                                          title="Increase Weight"
                                        >
                                          +
                                        </button>
                                        <button
                                          onClick={() => handleUpdateMemberWeight(group.id, m.userId, -1)}
                                          className="w-5 h-5 bg-white hover:bg-slate-200 border border-slate-300 rounded font-black text-slate-700 flex items-center justify-center text-xs cursor-pointer"
                                          title="Decrease Weight"
                                        >
                                          -
                                        </button>
                                        <button
                                          onClick={() => handleRemoveMember(group.id, m.userId)}
                                          className="w-5 h-5 text-slate-400 hover:text-red-600 flex items-center justify-center ml-1 cursor-pointer"
                                          title="Remove User"
                                        >
                                          <X size={14} />
                                        </button>
                                      </div>
                                    </div>
                                  ))
                                )}

                                {availableUsers.length > 0 && (
                                  <div className="pt-1">
                                    <select
                                      value={selectedUserToAdd[group.id] || ''}
                                      onChange={(e) => handleAddMemberToGroup(group.id, e.target.value)}
                                      className="w-full appearance-none bg-blue-50/60 hover:bg-blue-100/60 border border-blue-200 text-blue-800 text-xs font-extrabold rounded-xl px-2.5 py-1.5 cursor-pointer outline-none transition-all"
                                    >
                                      <option value="">+ Add User</option>
                                      {availableUsers.map(u => (
                                        <option key={u.id} value={u.id}>
                                          {u.business_name || u.full_name || u.email}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                )}
                              </div>
                            </td>

                            {/* 3. Selected Integrations / Campaigns (Pills + Search Button) */}
                            <td className="py-4 px-4 align-top">
                              <div className="flex flex-wrap gap-1.5 items-center">
                                {group.campaigns.length === 0 ? (
                                  <span className="text-slate-400 text-xs italic">No campaigns assigned</span>
                                ) : (
                                  group.campaigns.map((camp) => (
                                    <span
                                      key={camp}
                                      className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-800 border border-emerald-200/80 px-2.5 py-1 rounded-xl text-[11px] font-bold shadow-2xs"
                                    >
                                      <span className="max-w-[220px] truncate" title={camp}>{camp}</span>
                                      <button
                                        onClick={() => handleRemoveCampaign(group.id, camp)}
                                        className="text-emerald-500 hover:text-emerald-900 cursor-pointer"
                                      >
                                        <X size={13} />
                                      </button>
                                    </span>
                                  ))
                                )}

                                {availableCampaigns.length > 0 && (
                                  <button
                                    onClick={() => {
                                      setActivePickerGroupId(group.id);
                                      setCampaignSearchQuery('');
                                    }}
                                    className="inline-flex items-center gap-1 bg-emerald-100/80 hover:bg-emerald-200 border border-emerald-300 text-emerald-900 text-xs font-extrabold rounded-xl px-3 py-1 cursor-pointer transition-all shadow-xs"
                                  >
                                    <Search size={13} />
                                    <span>+ Add / Search Campaigns</span>
                                  </button>
                                )}
                              </div>
                            </td>

                            {/* 4. Last Lead Assigned To */}
                            <td className="py-4 px-4 align-top text-center">
                              {group.last_assigned_user_name ? (
                                <div className="inline-flex flex-col items-center">
                                  <span className="bg-slate-100 text-slate-800 border border-slate-200 px-3 py-1 rounded-full text-xs font-black">
                                    {group.last_assigned_user_name}
                                  </span>
                                  {group.last_assigned_at && (
                                    <span className="text-[9px] text-slate-400 font-bold mt-1">
                                      {new Date(group.last_assigned_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-slate-400 text-xs italic">-</span>
                              )}
                            </td>

                            {/* 5. Actions */}
                            <td className="py-4 px-4 align-top text-right space-y-2">
                              <button
                                onClick={() => handleDistributeGroupLeads(group)}
                                disabled={isDistributing === group.id}
                                className="w-full bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 px-3 py-1.5 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1 transition-all cursor-pointer disabled:opacity-50"
                                title="Batch distribute unassigned leads matching this group"
                              >
                                <RefreshCw size={13} className={isDistributing === group.id ? 'animate-spin' : ''} />
                                <span>{isDistributing === group.id ? 'Assigning...' : 'Distribute'}</span>
                              </button>
                              <button
                                onClick={() => handleDeleteGroup(group.id, group.group_name)}
                                className="w-full text-red-500 hover:text-red-700 hover:bg-red-50 py-1 rounded-lg text-[11px] font-bold flex items-center justify-end gap-1 transition-colors cursor-pointer"
                              >
                                <Trash2 size={13} /> Delete
                              </button>
                            </td>

                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

        </div>

        {/* Footer */}
        <div className="bg-slate-50 px-4 sm:px-6 py-3 border-t border-slate-200/80 flex flex-col sm:flex-row items-center justify-between shrink-0 gap-2.5">
          <div className="hidden sm:flex items-center gap-2 text-xs font-medium text-slate-500">
            <AlertCircle size={14} className="text-blue-600 shrink-0" />
            <span>Facebook webhooks follow these group distribution rules.</span>
          </div>

          <button
            onClick={onClose}
            className="w-full sm:w-auto bg-slate-900 hover:bg-slate-800 text-white px-6 py-2.5 rounded-xl text-xs font-black transition-all cursor-pointer shrink-0 flex items-center justify-center gap-2 active:scale-95 shadow-md"
          >
            <X size={16} />
            <span>Close Modal</span>
          </button>
        </div>

      </div>

      {/* SEARCHABLE CAMPAIGN PICKER MODAL POPOVER */}
      {activePickerGroupId && (() => {
        const targetGrp = groups.find(g => g.id === activePickerGroupId);
        if (!targetGrp) return null;
        const availCamps = campaignNamesList.filter(c => !targetGrp.campaigns.includes(c));
        const filteredCamps = availCamps.filter(c => c.toLowerCase().includes(campaignSearchQuery.toLowerCase().trim()));

        return (
          <div 
            onClick={() => setActivePickerGroupId(null)}
            className="fixed inset-0 z-[110] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
          >
            <div 
              onClick={(e) => e.stopPropagation()}
              className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 p-4 sm:p-5 space-y-3.5 animate-in zoom-in-95"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-emerald-100 text-emerald-700 rounded-xl">
                    <Layers size={18} />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-900">Add Campaign to "{targetGrp.group_name}"</h3>
                    <p className="text-[10px] font-bold text-slate-400">{availCamps.length} available campaign(s)</p>
                  </div>
                </div>
                <button 
                  onClick={() => setActivePickerGroupId(null)} 
                  className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Search Input */}
              <div className="relative">
                <Search size={16} className="absolute left-3.5 top-3 text-slate-400" />
                <input
                  type="text"
                  autoFocus
                  placeholder="Type to search (e.g. Ananta, Penthouse, Vintage, August)..."
                  value={campaignSearchQuery}
                  onChange={(e) => setCampaignSearchQuery(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 pl-10 pr-8 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500/30"
                />
                {campaignSearchQuery && (
                  <button 
                    onClick={() => setCampaignSearchQuery('')} 
                    className="absolute right-3 top-3 text-slate-400 hover:text-slate-600"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Campaign List */}
              <div className="max-h-64 overflow-y-auto space-y-1.5 custom-scrollbar pr-1">
                {filteredCamps.length === 0 ? (
                  <div className="py-8 text-center text-xs font-bold text-slate-400">
                    No matching campaigns found for "{campaignSearchQuery}"
                  </div>
                ) : (
                  filteredCamps.map((camp) => (
                    <button
                      key={camp}
                      onClick={() => {
                        handleAddCampaignToGroup(targetGrp.id, camp);
                        setActivePickerGroupId(null);
                        setCampaignSearchQuery('');
                      }}
                      title={camp}
                      className="w-full text-left bg-slate-50 hover:bg-emerald-50 hover:border-emerald-300 border border-slate-200/80 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-700 hover:text-emerald-900 transition-all flex items-start justify-between gap-2.5 group cursor-pointer"
                    >
                      <span className="whitespace-normal break-words leading-relaxed text-left flex-1">{camp}</span>
                      <Plus size={14} className="text-slate-400 group-hover:text-emerald-600 shrink-0 mt-0.5" />
                    </button>
                  ))
                )}
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-[11px] font-bold text-slate-400">
                <span>Showing {filteredCamps.length} of {availCamps.length} campaigns</span>
                <button 
                  onClick={() => setActivePickerGroupId(null)} 
                  className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-extrabold cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
