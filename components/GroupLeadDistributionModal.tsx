'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { 
  X, Plus, Trash2, Users, Layers, ArrowRight, RefreshCw, CheckCircle2, 
  ChevronDown, Sparkles, UserCheck, Shield, SlidersHorizontal, AlertCircle, 
  Search, Megaphone, FileText, Check, Tag
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
  campaign_ids?: string[];
  form_ids?: string[];
  is_active: boolean;
  last_assigned_user_id?: string | null;
  last_assigned_user_name?: string | null;
  last_assigned_at?: string | null;
  db_automation_id?: string;
}

interface SelectableSourceItem {
  id: string;
  name: string;
  type: 'campaign' | 'form' | 'custom';
  status?: string;
  leadsCount?: number;
  ruleValue: string;
  displayLabel: string;
}

interface GroupLeadDistributionModalProps {
  isOpen: boolean;
  onClose: () => void;
  team: any[];
  campaigns?: (string | { id: string; name: string })[];
  forms?: any[];
  leads?: any[];
  targetUserId: string;
  impersonateId?: string | null;
  onLeadsUpdated: () => void;
}

export default function GroupLeadDistributionModal({
  isOpen,
  onClose,
  team = [],
  campaigns = [],
  forms = [],
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

  // Live Meta Sources State
  const [metaCampaigns, setMetaCampaigns] = useState<any[]>([]);
  const [metaForms, setMetaForms] = useState<any[]>([]);
  const [dbCampaigns, setDbCampaigns] = useState<any[]>([]);
  const [loadingSources, setLoadingSources] = useState(false);

  // New Group Modal / Inline Form State
  const [isAddingGroup, setIsAddingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedUserToAdd, setSelectedUserToAdd] = useState<Record<string, string>>({});
  
  // Searchable Campaign & Form Picker State
  const [activePickerGroupId, setActivePickerGroupId] = useState<string | null>(null);
  const [campaignSearchQuery, setCampaignSearchQuery] = useState('');
  const [pickerTab, setPickerTab] = useState<'all' | 'campaigns' | 'forms'>('all');

  // Fetch groups and live meta sources on modal open
  useEffect(() => {
    if (isOpen && targetUserId) {
      fetchGroups();
      fetchMetaSources();
    }
  }, [isOpen, targetUserId, impersonateId]);

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
              campaign_ids: Array.isArray(parsed.campaign_ids) ? parsed.campaign_ids : [],
              form_ids: Array.isArray(parsed.form_ids) ? parsed.form_ids : [],
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

  const fetchMetaSources = async () => {
    setLoadingSources(true);
    try {
      const impParam = impersonateId ? `?impersonate=${impersonateId}` : '';
      
      const [campRes, formsRes, dbCampsRes] = await Promise.allSettled([
        fetch(`/api/meta-ads/campaigns${impParam}`).then(r => r.json()),
        fetch(`/api/facebook/forms${impParam}`).then(r => r.json()),
        supabase
          .from('campaigns')
          .select('id, name, status')
          .eq('user_id', targetUserId)
      ]);

      if (campRes.status === 'fulfilled' && campRes.value?.campaigns) {
        setMetaCampaigns(campRes.value.campaigns);
      }
      if (formsRes.status === 'fulfilled' && formsRes.value?.forms) {
        setMetaForms(formsRes.value.forms);
      }
      if (dbCampsRes.status === 'fulfilled' && dbCampsRes.value.data) {
        setDbCampaigns(dbCampsRes.value.data);
      }
    } catch (err) {
      console.error('Error fetching Meta campaigns/forms:', err);
    } finally {
      setLoadingSources(false);
    }
  };

  // Map of ID -> { name: string; type: 'campaign' | 'form' } and Name -> { id: string; type: 'campaign' | 'form' }
  const sourceResolutionMap = useMemo(() => {
    const idMap = new Map<string, { name: string; type: 'campaign' | 'form' }>();
    const nameMap = new Map<string, { id: string; type: 'campaign' | 'form' }>();

    // 1. Meta campaigns
    metaCampaigns.forEach((c: any) => {
      const id = String(c.id || '').trim();
      const name = c.name?.trim();
      if (id && name) {
        idMap.set(id, { name, type: 'campaign' });
        nameMap.set(name.toLowerCase(), { id, type: 'campaign' });
      }
    });

    // 2. DB campaigns
    dbCampaigns.forEach((c: any) => {
      const id = String(c.id || '').trim();
      const name = c.name?.trim();
      if (id && name) {
        if (!idMap.has(id)) idMap.set(id, { name, type: 'campaign' });
        if (!nameMap.has(name.toLowerCase())) nameMap.set(name.toLowerCase(), { id, type: 'campaign' });
      }
    });

    // 3. Meta forms
    metaForms.forEach((f: any) => {
      const id = String(f.id || '').trim();
      const name = f.name?.trim();
      if (id && name) {
        idMap.set(id, { name, type: 'form' });
        nameMap.set(name.toLowerCase(), { id, type: 'form' });
      }
    });

    // 4. Props campaigns
    (campaigns || []).forEach(c => {
      const id = typeof c === 'object' && c?.id ? String(c.id).trim() : '';
      const name = typeof c === 'string' ? c.trim() : c?.name?.trim();
      if (id && name) {
        const cleanName = name.replace(/^\[(campaign|form)\]\s*/i, '');
        if (!idMap.has(id)) idMap.set(id, { name: cleanName, type: 'campaign' });
        if (!nameMap.has(cleanName.toLowerCase())) nameMap.set(cleanName.toLowerCase(), { id, type: 'campaign' });
      }
    });

    // 5. Props forms
    (forms || []).forEach(f => {
      const id = typeof f === 'object' && f?.id ? String(f.id).trim() : '';
      const name = typeof f === 'string' ? f.trim() : f?.name?.trim();
      if (id && name) {
        const cleanName = name.replace(/^\[(campaign|form)\]\s*/i, '');
        if (!idMap.has(id)) idMap.set(id, { name: cleanName, type: 'form' });
        if (!nameMap.has(cleanName.toLowerCase())) nameMap.set(cleanName.toLowerCase(), { id, type: 'form' });
      }
    });

    // 6. Leads from workspace
    (leads || []).forEach(l => {
      const cId = String(l.campaign_id || '').trim();
      const cName = (l.custom_fields?.meta_ad_origin?.campaign_name || l.campaign_name || l.ad_name)?.trim();
      if (cId && cName && cName !== 'null' && cName !== 'undefined') {
        if (!idMap.has(cId)) idMap.set(cId, { name: cName, type: 'campaign' });
        if (!nameMap.has(cName.toLowerCase())) nameMap.set(cName.toLowerCase(), { id: cId, type: 'campaign' });
      }

      const fId = String(l.form_id || '').trim();
      const fName = (l.form_name)?.trim();
      if (fId && fName && fName !== 'null' && fName !== 'undefined') {
        if (!idMap.has(fId)) idMap.set(fId, { name: fName, type: 'form' });
        if (!nameMap.has(fName.toLowerCase())) nameMap.set(fName.toLowerCase(), { id: fId, type: 'form' });
      }
    });

    return { idMap, nameMap };
  }, [metaCampaigns, dbCampaigns, metaForms, campaigns, forms, leads]);

  // Consolidate all available campaigns & forms into a structured selectable catalog
  const allSelectableSources = useMemo<SelectableSourceItem[]>(() => {
    const items: SelectableSourceItem[] = [];
    const seenRuleValues = new Set<string>();

    // 1. Live Meta Campaigns from API
    metaCampaigns.forEach((c: any) => {
      const name = c.name?.trim() || 'Untitled Campaign';
      const ruleVal = `[Campaign] ${name}`;
      if (!seenRuleValues.has(ruleVal.toLowerCase())) {
        seenRuleValues.add(ruleVal.toLowerCase());
        items.push({
          id: String(c.id || ''),
          name,
          type: 'campaign',
          status: c.status || c.effective_status || 'ACTIVE',
          ruleValue: ruleVal,
          displayLabel: name
        });
      }
    });

    // 2. Database Campaigns (from Supabase campaigns table)
    dbCampaigns.forEach((c: any) => {
      const name = c.name?.trim();
      if (!name) return;
      const ruleVal = `[Campaign] ${name}`;
      if (!seenRuleValues.has(ruleVal.toLowerCase())) {
        seenRuleValues.add(ruleVal.toLowerCase());
        items.push({
          id: String(c.id || ''),
          name,
          type: 'campaign',
          status: c.status || 'ACTIVE',
          ruleValue: ruleVal,
          displayLabel: name
        });
      }
    });

    // 3. Live Meta Lead Forms from API
    metaForms.forEach((f: any) => {
      const name = f.name?.trim() || 'Untitled Form';
      const ruleVal = `[Form] ${name}`;
      if (!seenRuleValues.has(ruleVal.toLowerCase())) {
        seenRuleValues.add(ruleVal.toLowerCase());
        items.push({
          id: String(f.id || ''),
          name,
          type: 'form',
          status: f.status || 'ACTIVE',
          leadsCount: f.leads_count,
          ruleValue: ruleVal,
          displayLabel: name
        });
      }
    });

    // 4. Props campaigns (from parent component)
    (campaigns || []).forEach(c => {
      const name = typeof c === 'string' ? c.trim() : c?.name?.trim();
      if (!name) return;
      const ruleVal = name.startsWith('[') ? name : `[Campaign] ${name}`;
      if (!seenRuleValues.has(ruleVal.toLowerCase()) && !seenRuleValues.has(name.toLowerCase())) {
        seenRuleValues.add(ruleVal.toLowerCase());
        items.push({
          id: typeof c === 'object' && c?.id ? String(c.id) : '',
          name,
          type: 'campaign',
          ruleValue: ruleVal,
          displayLabel: name.replace(/^\[(campaign|form)\]\s*/i, '')
        });
      }
    });

    // 5. Props forms (from parent component)
    (forms || []).forEach(f => {
      const name = typeof f === 'string' ? f.trim() : f?.name?.trim();
      if (!name) return;
      const ruleVal = name.startsWith('[') ? name : `[Form] ${name}`;
      if (!seenRuleValues.has(ruleVal.toLowerCase()) && !seenRuleValues.has(name.toLowerCase())) {
        seenRuleValues.add(ruleVal.toLowerCase());
        items.push({
          id: typeof f === 'object' && f?.id ? String(f.id) : '',
          name,
          type: 'form',
          ruleValue: ruleVal,
          displayLabel: name.replace(/^\[(campaign|form)\]\s*/i, '')
        });
      }
    });

    // 6. Campaign & Form names extracted from existing leads in workspace
    (leads || []).forEach(l => {
      const cName = (l.custom_fields?.meta_ad_origin?.campaign_name || l.campaign_name || l.ad_name)?.trim();
      if (cName && cName !== 'null' && cName !== 'undefined') {
        const ruleVal = `[Campaign] ${cName}`;
        if (!seenRuleValues.has(ruleVal.toLowerCase()) && !seenRuleValues.has(cName.toLowerCase())) {
          seenRuleValues.add(ruleVal.toLowerCase());
          items.push({
            id: String(l.campaign_id || ''),
            name: cName,
            type: 'campaign',
            ruleValue: ruleVal,
            displayLabel: cName
          });
        }
      }

      const fName = (l.form_name)?.trim();
      if (fName && fName !== 'null' && fName !== 'undefined') {
        const ruleVal = `[Form] ${fName}`;
        if (!seenRuleValues.has(ruleVal.toLowerCase()) && !seenRuleValues.has(fName.toLowerCase())) {
          seenRuleValues.add(ruleVal.toLowerCase());
          items.push({
            id: String(l.form_id || ''),
            name: fName,
            type: 'form',
            ruleValue: ruleVal,
            displayLabel: fName
          });
        }
      }
    });

    return items;
  }, [metaCampaigns, dbCampaigns, metaForms, campaigns, forms, leads]);

  const saveGroupRuleToDb = async (group: DistributionGroup) => {
    try {
      const ruleTitle = `Group-Distribution: ${group.group_name.trim()}`;
      const payloadDescription = JSON.stringify({
        id: group.id,
        group_name: group.group_name.trim(),
        members: group.members,
        campaigns: group.campaigns,
        campaign_ids: group.campaign_ids || [],
        form_ids: group.form_ids || [],
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

  // Campaign and Form management inside a group
  const handleAddCampaignToGroup = (
    groupId: string,
    ruleString: string,
    sourceId?: string,
    sourceType?: 'campaign' | 'form' | 'custom'
  ) => {
    if (!ruleString) return;

    setGroups(prev => prev.map(g => {
      if (g.id === groupId) {
        // Prevent exact duplicates or duplicate normalized strings
        const isAlreadyAdded = g.campaigns.some(c => 
          c.toLowerCase() === ruleString.toLowerCase() ||
          c.replace(/^\[(form|campaign)\]\s*/i, '').toLowerCase() === ruleString.replace(/^\[(form|campaign)\]\s*/i, '').toLowerCase()
        );

        if (isAlreadyAdded) {
          toast.error(`"${ruleString}" is already assigned to this group.`);
          return g;
        }

        const updatedCampaigns = [...g.campaigns, ruleString];
        const updatedCampaignIds = [...(g.campaign_ids || [])];
        const updatedFormIds = [...(g.form_ids || [])];

        // Resolve ID if not directly provided
        let targetId = sourceId;
        let targetType = sourceType;
        const cleanName = ruleString.replace(/^\[(form|campaign|ad)\]\s*/i, '').trim();

        if (!targetId) {
          const resolved = sourceResolutionMap.nameMap.get(cleanName.toLowerCase()) || sourceResolutionMap.idMap.get(cleanName);
          if (resolved) {
            targetId = sourceResolutionMap.nameMap.get(cleanName.toLowerCase())?.id || cleanName;
            targetType = resolved.type;
          }
        }

        if (targetId) {
          if (targetType === 'form' || /^\[form\]/i.test(ruleString)) {
            if (!updatedFormIds.includes(targetId)) updatedFormIds.push(targetId);
          } else {
            if (!updatedCampaignIds.includes(targetId)) updatedCampaignIds.push(targetId);
          }
        }

        const updatedGroup: DistributionGroup = {
          ...g,
          campaigns: updatedCampaigns,
          campaign_ids: updatedCampaignIds,
          form_ids: updatedFormIds
        };
        saveGroupRuleToDb(updatedGroup);
        toast.success(`Added "${ruleString}" to "${g.group_name}"`);
        return updatedGroup;
      }
      return g;
    }));
  };

  const handleRemoveCampaign = (groupId: string, ruleString: string) => {
    setGroups(prev => prev.map(g => {
      if (g.id === groupId) {
        const cleanName = ruleString.replace(/^\[(form|campaign|ad)\]\s*/i, '').trim();
        const associatedId = sourceResolutionMap.nameMap.get(cleanName.toLowerCase())?.id || 
                             (sourceResolutionMap.idMap.has(cleanName) ? cleanName : null);

        const updatedCampaigns = g.campaigns.filter(c => c !== ruleString);
        const updatedCampaignIds = (g.campaign_ids || []).filter(id => id !== ruleString && id !== cleanName && id !== associatedId);
        const updatedFormIds = (g.form_ids || []).filter(id => id !== ruleString && id !== cleanName && id !== associatedId);

        const updatedGroup: DistributionGroup = {
          ...g,
          campaigns: updatedCampaigns,
          campaign_ids: updatedCampaignIds,
          form_ids: updatedFormIds
        };
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
      return toast.error(`Please assign at least one campaign or form to group "${group.group_name}".`);
    }

    setIsDistributing(group.id);
    try {
      // 1. Fetch ALL leads from DB for this workspace to ensure full coverage
      const { data: dbLeads, error: fetchErr } = await supabase
        .from('leads')
        .select('id, name, phone, assigned_to, user_id, campaign_id, form_id, ad_name, form_name, custom_fields')
        .eq('user_id', targetUserId)
        .order('created_at', { ascending: true });

      if (fetchErr) throw fetchErr;

      const allWorkspaceLeads = dbLeads || [];

      // Build campaignsMap for ID <-> Name lookup
      const idToName: Record<string, string> = {};
      const nameToId: Record<string, string> = {};
      [...metaCampaigns, ...dbCampaigns].forEach((c: any) => {
        if (c.id && c.name) {
          idToName[c.id] = c.name;
          nameToId[c.name] = c.id;
        }
      });
      const campaignsMap = { idToName, nameToId };

      // 2. Filter leads matching group's campaigns or forms
      const matchingLeads = allWorkspaceLeads.filter(l => {
        // Direct ID match against campaign_ids or form_ids
        if (l.campaign_id && group.campaign_ids?.includes(String(l.campaign_id))) return true;
        if (l.form_id && group.form_ids?.includes(String(l.form_id))) return true;

        const leadCtx = {
          campaignId: l.campaign_id,
          campaignName: l.custom_fields?.meta_ad_origin?.campaign_name || l.ad_name,
          adName: l.ad_name || l.custom_fields?.meta_ad_origin?.ad_name,
          formName: l.form_name,
          formId: l.form_id,
          adCampaignString: l.ad_name
        };

        return group.campaigns.some(gc => matchesCampaignRule(gc, leadCtx, campaignsMap));
      });

      if (matchingLeads.length === 0) {
        return toast.error(`No leads found matching group "${group.group_name}" campaigns or forms.`);
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

  // Render pill for assigned rule (Campaign or Form)
  // Resolves numeric IDs dynamically to full human-readable names
  const renderRulePill = (ruleStr: string, groupId: string) => {
    const isExplicitForm = /^\[form\]/i.test(ruleStr) || /^form:/i.test(ruleStr);
    const isExplicitCamp = /^\[campaign\]/i.test(ruleStr) || /^campaign:/i.test(ruleStr);
    const rawClean = ruleStr.replace(/^\[(form|campaign|ad|rule)\]\s*/i, '').replace(/^(form|campaign|ad|rule):\s*/i, '').trim();

    // Check if rawClean is an ID in our resolution map or numeric
    const resolvedFromId = sourceResolutionMap.idMap.get(rawClean);
    const isNumericId = /^\d{10,}$/.test(rawClean);

    let displayName = rawClean;
    let resolvedType: 'campaign' | 'form' | 'rule' = isExplicitForm ? 'form' : isExplicitCamp ? 'campaign' : 'rule';
    let idSubtitle = '';

    if (resolvedFromId) {
      displayName = resolvedFromId.name;
      resolvedType = resolvedFromId.type;
      idSubtitle = `ID: ${rawClean}`;
    } else if (isNumericId) {
      // Unresolved numeric ID - show clean label with ID badge
      displayName = `Meta ID: ${rawClean}`;
      idSubtitle = rawClean;
    } else {
      // It's a name; check if we know its ID
      const resolvedFromName = sourceResolutionMap.nameMap.get(rawClean.toLowerCase());
      if (resolvedFromName) {
        resolvedType = resolvedFromName.type;
        idSubtitle = `ID: ${resolvedFromName.id}`;
      }
    }

    const isForm = resolvedType === 'form';
    const isCamp = resolvedType === 'campaign';

    return (
      <span
        key={ruleStr}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[11px] font-bold border shadow-2xs ${
          isForm 
            ? 'bg-purple-50 text-purple-900 border-purple-200' 
            : isCamp
            ? 'bg-blue-50 text-blue-900 border-blue-200'
            : 'bg-emerald-50 text-emerald-800 border-emerald-200/80'
        }`}
        title={idSubtitle ? `${displayName} (${idSubtitle})` : displayName}
      >
        <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md flex items-center gap-0.5 ${
          isForm ? 'bg-purple-200 text-purple-800' : isCamp ? 'bg-blue-200 text-blue-800' : 'bg-emerald-200 text-emerald-800'
        }`}>
          {isForm ? <FileText size={10} /> : isCamp ? <Megaphone size={10} /> : <Tag size={10} />}
          <span>{isForm ? 'Lead Form' : isCamp ? 'Campaign' : 'Rule'}</span>
        </span>
        <span className="max-w-[240px] truncate">{displayName}</span>
        <button
          onClick={() => handleRemoveCampaign(groupId, ruleStr)}
          className="text-slate-400 hover:text-red-600 transition-colors cursor-pointer ml-0.5"
          title="Remove"
        >
          <X size={12} />
        </button>
      </span>
    );
  };

  if (!isOpen) return null;

  return (
    <div 
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/70 backdrop-blur-md p-2 sm:p-4 overflow-y-auto animate-in fade-in duration-200"
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full max-w-6xl rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-100 overflow-hidden flex flex-col my-auto max-h-[85vh] sm:max-h-[90vh]"
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
                  Weighted Round-Robin
                </span>
              </div>
              <p className="text-[10px] sm:text-xs text-slate-400 font-medium hidden sm:block">
                Assign team members, set weightage ratios & link Facebook ad campaigns or lead forms
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <button
              onClick={() => fetchMetaSources()}
              disabled={loadingSources}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 sm:py-2 rounded-xl text-xs font-bold flex items-center gap-1 border border-slate-700 transition-all cursor-pointer active:scale-95 disabled:opacity-50"
              title="Sync latest campaigns and forms from Meta"
            >
              <RefreshCw size={13} className={loadingSources ? 'animate-spin text-blue-400' : ''} />
              <span className="hidden sm:inline">Refresh Meta</span>
            </button>
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

        {/* Modal Body */}
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
                  placeholder="Enter Group Name (e.g. Luxury Team, 2BHK Sales Reps)..."
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
              <p className="text-xs text-slate-500 max-w-md">Create your first employee distribution group to assign specific campaigns or forms and set lead weightage frequency per team member.</p>
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

                      {/* Mobile Section 2: Selected Campaigns / Forms */}
                      <div className="space-y-1.5 pt-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">
                          Selected Campaigns & Forms ({group.campaigns.length})
                        </label>
                        <div className="flex flex-wrap gap-1.5 items-center">
                          {group.campaigns.length === 0 ? (
                            <span className="text-slate-400 text-xs italic block">No campaigns or forms assigned</span>
                          ) : (
                            group.campaigns.map((camp) => renderRulePill(camp, group.id))
                          )}

                          <div className="w-full pt-1">
                            <button
                              onClick={() => {
                                setActivePickerGroupId(group.id);
                                setCampaignSearchQuery('');
                                setPickerTab('all');
                              }}
                              className="w-full bg-blue-50 hover:bg-blue-100 border border-blue-300 text-blue-900 text-xs font-extrabold rounded-xl px-3 py-2 cursor-pointer transition-all shadow-xs flex items-center justify-center gap-1.5"
                            >
                              <Search size={13} />
                              <span>+ Add / Select Campaigns & Forms</span>
                            </button>
                          </div>
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
                        <th className="py-3.5 px-4">Assigned Campaigns & Forms</th>
                        <th className="py-3.5 px-4 w-48 text-center">Last Lead Assigned To</th>
                        <th className="py-3.5 px-4 w-32 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {groups.map((group) => {
                        const availableUsers = team.filter(t => !group.members.some(m => m.userId === t.id));

                        return (
                          <tr key={group.id} className="hover:bg-slate-50/60 transition-colors">
                            
                            {/* 1. Group Name */}
                            <td className="py-4 px-4 font-black text-slate-800 align-top">
                              <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                                <span className="text-sm font-black text-slate-900">{group.group_name}</span>
                              </div>
                              <div className="text-[10px] font-bold text-slate-400 mt-1">
                                {group.members.length} member(s) • {group.campaigns.length} rule(s)
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

                            {/* 3. Selected Campaigns & Forms */}
                            <td className="py-4 px-4 align-top">
                              <div className="flex flex-wrap gap-1.5 items-center">
                                {group.campaigns.length === 0 ? (
                                  <span className="text-slate-400 text-xs italic">No campaigns or forms assigned</span>
                                ) : (
                                  group.campaigns.map((camp) => renderRulePill(camp, group.id))
                                )}

                                <button
                                  onClick={() => {
                                    setActivePickerGroupId(group.id);
                                    setCampaignSearchQuery('');
                                    setPickerTab('all');
                                  }}
                                  className="inline-flex items-center gap-1 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-900 text-xs font-extrabold rounded-xl px-3 py-1 cursor-pointer transition-all shadow-xs"
                                >
                                  <Search size={13} />
                                  <span>+ Add / Select Campaigns & Forms</span>
                                </button>
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
            <span>Incoming leads from Meta webhooks and sync automatically follow these group rules.</span>
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

      {/* SEARCHABLE CAMPAIGN & FORM PICKER MODAL POPOVER */}
      {activePickerGroupId && (() => {
        const targetGrp = groups.find(g => g.id === activePickerGroupId);
        if (!targetGrp) return null;

        // Filter out items already in the group
        const availItems = allSelectableSources.filter(item => {
          return !targetGrp.campaigns.some(c => 
            c.toLowerCase() === item.ruleValue.toLowerCase() ||
            c.toLowerCase() === item.name.toLowerCase() ||
            c.replace(/^\[(form|campaign)\]\s*/i, '').toLowerCase() === item.name.toLowerCase()
          );
        });

        // Filter by tab
        const tabItems = availItems.filter(item => {
          if (pickerTab === 'campaigns') return item.type === 'campaign';
          if (pickerTab === 'forms') return item.type === 'form';
          return true;
        });

        // Filter by search query
        const q = campaignSearchQuery.toLowerCase().trim();
        const filteredItems = tabItems.filter(item => {
          if (!q) return true;
          return item.name.toLowerCase().includes(q) || 
                 item.id.toLowerCase().includes(q) || 
                 item.ruleValue.toLowerCase().includes(q);
        });

        const totalCampaignsCount = availItems.filter(i => i.type === 'campaign').length;
        const totalFormsCount = availItems.filter(i => i.type === 'form').length;

        return (
          <div 
            onClick={() => setActivePickerGroupId(null)}
            className="fixed inset-0 z-[110] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150"
          >
            <div 
              onClick={(e) => e.stopPropagation()}
              className="bg-white w-full max-w-xl rounded-2xl sm:rounded-3xl shadow-2xl border border-slate-200 p-4 sm:p-5 space-y-4 animate-in zoom-in-95 max-h-[85vh] flex flex-col overflow-hidden"
            >
              {/* Picker Header */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 shrink-0">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-blue-100 text-blue-700 rounded-xl">
                    <Layers size={18} />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-900">Add Campaign or Form to "{targetGrp.group_name}"</h3>
                    <p className="text-[10px] font-bold text-slate-400">
                      {availItems.length} available items ({totalCampaignsCount} campaigns, {totalFormsCount} forms)
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => fetchMetaSources()}
                    disabled={loadingSources}
                    className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all cursor-pointer"
                    title="Reload from Meta"
                  >
                    <RefreshCw size={16} className={loadingSources ? 'animate-spin text-blue-600' : ''} />
                  </button>
                  <button 
                    onClick={() => setActivePickerGroupId(null)} 
                    className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl cursor-pointer"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              {/* Tabs: All / Campaigns / Lead Forms */}
              <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl shrink-0 text-xs font-extrabold">
                <button
                  onClick={() => setPickerTab('all')}
                  className={`flex-1 py-1.5 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    pickerTab === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <span>All</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-200 text-slate-700 font-bold">
                    {availItems.length}
                  </span>
                </button>
                <button
                  onClick={() => setPickerTab('campaigns')}
                  className={`flex-1 py-1.5 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    pickerTab === 'campaigns' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Megaphone size={12} />
                  <span>Campaigns</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                    pickerTab === 'campaigns' ? 'bg-blue-500 text-white' : 'bg-slate-200 text-slate-700'
                  }`}>
                    {totalCampaignsCount}
                  </span>
                </button>
                <button
                  onClick={() => setPickerTab('forms')}
                  className={`flex-1 py-1.5 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    pickerTab === 'forms' ? 'bg-purple-600 text-white shadow-xs' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <FileText size={12} />
                  <span>Lead Forms</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                    pickerTab === 'forms' ? 'bg-purple-500 text-white' : 'bg-slate-200 text-slate-700'
                  }`}>
                    {totalFormsCount}
                  </span>
                </button>
              </div>

              {/* Search Input */}
              <div className="relative shrink-0">
                <Search size={16} className="absolute left-3.5 top-3 text-slate-400" />
                <input
                  type="text"
                  autoFocus
                  placeholder="Search by campaign name, form name, or ID..."
                  value={campaignSearchQuery}
                  onChange={(e) => setCampaignSearchQuery(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2.5 pl-10 pr-8 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/30"
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

              {/* Custom Write-In Option if query typed */}
              {campaignSearchQuery.trim() && (
                <div className="bg-blue-50/80 border border-blue-200 rounded-xl p-2.5 shrink-0 flex items-center justify-between gap-2 text-xs">
                  <span className="font-bold text-blue-900 truncate">
                    Add custom: <span className="underline font-black">"{campaignSearchQuery.trim()}"</span>
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => {
                        handleAddCampaignToGroup(targetGrp.id, `[Campaign] ${campaignSearchQuery.trim()}`);
                        setCampaignSearchQuery('');
                      }}
                      className="bg-blue-600 hover:bg-blue-500 text-white px-2.5 py-1 rounded-lg text-[10px] font-black cursor-pointer shadow-xs"
                    >
                      + As Campaign
                    </button>
                    <button
                      onClick={() => {
                        handleAddCampaignToGroup(targetGrp.id, `[Form] ${campaignSearchQuery.trim()}`);
                        setCampaignSearchQuery('');
                      }}
                      className="bg-purple-600 hover:bg-purple-500 text-white px-2.5 py-1 rounded-lg text-[10px] font-black cursor-pointer shadow-xs"
                    >
                      + As Form
                    </button>
                  </div>
                </div>
              )}

              {/* Items List */}
              <div className="flex-1 overflow-y-auto space-y-1.5 custom-scrollbar pr-1 min-h-[220px]">
                {loadingSources ? (
                  <div className="py-12 text-center text-slate-400 font-bold text-xs flex flex-col items-center justify-center gap-2">
                    <RefreshCw size={20} className="animate-spin text-blue-600" />
                    <span>Loading campaigns and forms from Meta...</span>
                  </div>
                ) : filteredItems.length === 0 ? (
                  <div className="py-12 text-center text-xs font-bold text-slate-400 space-y-2">
                    <p>No matching campaigns or forms found for "{campaignSearchQuery}"</p>
                    <p className="text-[11px] font-normal text-slate-400">You can add it directly using the "+ As Campaign" or "+ As Form" buttons above.</p>
                  </div>
                ) : (
                  filteredItems.map((item) => {
                    const isForm = item.type === 'form';
                    return (
                      <button
                        key={item.ruleValue + (item.id || '')}
                        onClick={() => {
                          handleAddCampaignToGroup(targetGrp.id, item.ruleValue, item.id, item.type);
                        }}
                        title={item.name}
                        className={`w-full text-left border rounded-xl px-3.5 py-2.5 text-xs transition-all flex items-center justify-between gap-3 group cursor-pointer ${
                          isForm 
                            ? 'bg-slate-50 hover:bg-purple-50 hover:border-purple-300 border-slate-200/80 text-slate-800' 
                            : 'bg-slate-50 hover:bg-blue-50 hover:border-blue-300 border-slate-200/80 text-slate-800'
                        }`}
                      >
                        <div className="min-w-0 flex-1 flex items-start gap-2.5">
                          <span className={`p-1.5 rounded-lg mt-0.5 shrink-0 ${
                            isForm ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                          }`}>
                            {isForm ? <FileText size={14} /> : <Megaphone size={14} />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-extrabold text-slate-900 truncate">{item.displayLabel}</span>
                              <span className={`text-[9px] font-black uppercase px-1.5 py-0.2 rounded-md ${
                                isForm ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                              }`}>
                                {isForm ? 'Lead Form' : 'Campaign'}
                              </span>
                              {item.status && (
                                <span className={`text-[9px] font-black uppercase px-1.5 py-0.2 rounded-md ${
                                  item.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                                }`}>
                                  {item.status}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-[10px] text-slate-400 font-bold mt-0.5">
                              {item.id && <span>ID: {item.id}</span>}
                              {typeof item.leadsCount === 'number' && <span>• {item.leadsCount} leads</span>}
                            </div>
                          </div>
                        </div>

                        <div className="shrink-0 flex items-center">
                          <span className="w-7 h-7 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-400 group-hover:bg-blue-600 group-hover:text-white group-hover:border-blue-600 transition-all shadow-2xs">
                            <Plus size={15} />
                          </span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              {/* Picker Footer */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-[11px] font-bold text-slate-400 shrink-0">
                <span>Showing {filteredItems.length} of {tabItems.length} items</span>
                <button 
                  onClick={() => setActivePickerGroupId(null)} 
                  className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-extrabold cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
