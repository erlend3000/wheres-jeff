import { supabase } from './supabase.js';

// ── Seasons ──

export async function getSeasons() {
    const { data, error } = await supabase
        .from('seasons')
        .select('*, season_members(user_id), mysteries(id)')
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
}

export async function createSeason(name) {
    const { data, error } = await supabase
        .from('seasons')
        .insert({ name })
        .select()
        .single();
    if (error) throw error;
    return data;
}

export async function updateSeason(id, updates) {
    const { data, error } = await supabase
        .from('seasons')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
    if (error) throw error;
    return data;
}

export async function endSeason(id) {
    return updateSeason(id, { active: false, ends_at: new Date().toISOString() });
}

export async function deleteSeason(id) {
    const { error } = await supabase.from('seasons').delete().eq('id', id);
    if (error) throw error;
}

// ── Season Members ──

export async function getSeasonMembers(seasonId) {
    const { data, error } = await supabase
        .from('season_members')
        .select('user_id, profiles(id, name, email)')
        .eq('season_id', seasonId);
    if (error) throw error;
    return data;
}

export async function addSeasonMember(seasonId, userId) {
    const { error } = await supabase
        .from('season_members')
        .insert({ season_id: seasonId, user_id: userId });
    if (error) throw error;
}

export async function removeSeasonMember(seasonId, userId) {
    const { error } = await supabase
        .from('season_members')
        .delete()
        .eq('season_id', seasonId)
        .eq('user_id', userId);
    if (error) throw error;
}

// ── Mysteries ──

export async function getMysteries() {
    const { data, error } = await supabase
        .from('mysteries')
        .select('*, seasons(name)')
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
}

export async function getMysteriesBySeason(seasonId) {
    const { data, error } = await supabase
        .from('mysteries')
        .select('*')
        .eq('season_id', seasonId)
        .order('published_at', { ascending: false, nullsFirst: false });
    if (error) throw error;
    return data;
}

export async function getSeasonScores(seasonId) {
    const mysteries = await getMysteriesBySeason(seasonId);
    if (!mysteries.length) return {};
    const mysteryIds = mysteries.map(m => m.id);
    const { data: guesses, error } = await supabase
        .from('guesses')
        .select('user_id, mystery_id, score')
        .in('mystery_id', mysteryIds);
    if (error) throw error;

    const scores = {};
    const bestByMystery = {};
    for (const g of (guesses || [])) {
        if (!scores[g.user_id]) scores[g.user_id] = { score: 0, wins: 0 };
        scores[g.user_id].score += g.score;
        if (!bestByMystery[g.mystery_id] || g.score > bestByMystery[g.mystery_id].score) {
            bestByMystery[g.mystery_id] = g;
        }
    }
    for (const best of Object.values(bestByMystery)) {
        if (scores[best.user_id]) scores[best.user_id].wins++;
    }
    return scores;
}

export async function createMysteryInstances(content, gameEntries) {
    const templateId = crypto.randomUUID();
    const rows = gameEntries.map(g => ({
        ...content,
        template_id: templateId,
        season_id: g.season_id,
        published_at: g.published_at,
        reveals_at: g.reveals_at
    }));
    const { data, error } = await supabase
        .from('mysteries')
        .insert(rows)
        .select();
    if (error) throw error;
    return data;
}

export async function updateMysteryContent(templateId, content) {
    const { data, error } = await supabase
        .from('mysteries')
        .update(content)
        .eq('template_id', templateId)
        .select();
    if (error) throw error;
    return data;
}

export async function updateMysteryTiming(id, timing) {
    const { data, error } = await supabase
        .from('mysteries')
        .update(timing)
        .eq('id', id)
        .select()
        .single();
    if (error) throw error;
    return data;
}

export async function deleteGuessesForMystery(mysteryId) {
    const { error } = await supabase
        .from('guesses')
        .delete()
        .eq('mystery_id', mysteryId);
    if (error) throw error;
}

export async function addMysteryToGame(templateId, content, gameEntry) {
    const { data, error } = await supabase
        .from('mysteries')
        .insert({
            ...content,
            template_id: templateId,
            season_id: gameEntry.season_id,
            published_at: gameEntry.published_at,
            reveals_at: gameEntry.reveals_at
        })
        .select()
        .single();
    if (error) throw error;
    return data;
}

export async function deleteMysteryTemplate(templateId) {
    const { error } = await supabase.from('mysteries').delete().eq('template_id', templateId);
    if (error) throw error;
}

export function groupByTemplate(mysteries) {
    const map = {};
    for (const m of mysteries) {
        const tid = m.template_id || m.id;
        if (!map[tid]) map[tid] = { ...m, template_id: tid, instances: [] };
        map[tid].instances.push(m);
    }
    function latestPublish(t) {
        const dates = t.instances.map(i => i.published_at).filter(Boolean).map(d => new Date(d));
        return dates.length ? Math.max(...dates) : 0;
    }
    return Object.values(map).sort((a, b) => latestPublish(b) - latestPublish(a));
}

// ── App Settings ──

export async function getSetting(key) {
    const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', key)
        .maybeSingle();
    if (error) throw error;
    return data?.value ?? null;
}

export async function setSetting(key, value) {
    const { error } = await supabase
        .from('app_settings')
        .upsert({ key, value });
    if (error) throw error;
}

export async function uploadWaitingImage(type, file) {
    const ext = file.name?.split('.').pop() || 'webp';
    const contentType = file.type || (ext === 'webp' ? 'image/webp' : `image/${ext}`);
    const path = `waiting-${type}.${ext}`;
    const { error: upErr } = await supabase.storage
        .from('mystery-images')
        .upload(path, file, { contentType, upsert: true });
    if (upErr) throw upErr;
    const { data } = supabase.storage.from('mystery-images').getPublicUrl(path);
    const url = data.publicUrl + '?v=' + Date.now();
    await setSetting(`waiting_image_${type}`, url);
    return url;
}

// ── Pending Members ──

export async function getPendingMembers(seasonId) {
    const { data, error } = await supabase
        .from('pending_members')
        .select('*')
        .eq('season_id', seasonId);
    if (error) throw error;
    return data ?? [];
}

export async function addPendingMember(seasonId, email) {
    const { error } = await supabase
        .from('pending_members')
        .insert({ season_id: seasonId, email });
    if (error) throw error;
}

export async function removePendingMember(seasonId, email) {
    const { error } = await supabase
        .from('pending_members')
        .delete()
        .eq('season_id', seasonId)
        .eq('email', email);
    if (error) throw error;
}

// ── Image Upload ──



export async function uploadMysteryImage(file) {
    const ext = file.name?.split('.').pop() || 'webp';
    const contentType = file.type || (ext === 'webp' ? 'image/webp' : `image/${ext}`);
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage
        .from('mystery-images')
        .upload(path, file, { contentType });
    if (error) throw error;
    const { data } = supabase.storage.from('mystery-images').getPublicUrl(path);
    return data.publicUrl;
}

// ── Users ──

export async function getUsers() {
    const { data: profiles, error: pErr } = await supabase
        .from('profiles')
        .select('*')
        .order('name');
    if (pErr) throw pErr;

    const { data: guesses, error: gErr } = await supabase
        .from('guesses')
        .select('user_id, mystery_id, score');
    if (gErr) throw gErr;

    const bestByMystery = {};
    for (const g of (guesses || [])) {
        const key = g.mystery_id;
        if (!bestByMystery[key] || g.score > bestByMystery[key].score) {
            bestByMystery[key] = g;
        }
    }

    const totals = {};
    for (const g of (guesses || [])) {
        if (!totals[g.user_id]) totals[g.user_id] = { score: 0, wins: 0 };
        totals[g.user_id].score += g.score;
    }
    for (const best of Object.values(bestByMystery)) {
        if (totals[best.user_id]) totals[best.user_id].wins++;
    }

    return profiles.map(p => ({
        ...p,
        total_score: totals[p.id]?.score ?? 0,
        wins: totals[p.id]?.wins ?? 0
    }));
}

export async function updateUserName(userId, name) {
    const { error } = await supabase
        .from('profiles')
        .update({ name })
        .eq('id', userId);
    if (error) throw error;
}

export async function deleteUser(userId) {
    const { error } = await supabase.rpc('delete_user_completely', { p_user_id: userId });
    if (error) throw error;
}

// ── Helpers ──

export function mysteryStatus(mystery) {
    const now = new Date();
    if (!mystery.published_at) return 'draft';
    if (new Date(mystery.published_at) > now) return 'scheduled';
    if (!mystery.reveals_at || new Date(mystery.reveals_at) > now) return 'live';
    return 'revealed';
}

export function formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('no-NO', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

export function toDatetimeLocal(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
