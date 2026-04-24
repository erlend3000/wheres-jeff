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
    const mysteries = await getMysteriesBySeason(id);
    const now = new Date();
    const hasLive = mysteries.some(m =>
        m.published_at && new Date(m.published_at) <= now &&
        m.reveals_at && new Date(m.reveals_at) > now
    );

    const futureIds = mysteries
        .filter(m => m.published_at && new Date(m.published_at) > now)
        .map(m => m.id);
    if (futureIds.length) {
        for (const fid of futureIds) {
            await supabase.from('mysteries').delete().eq('id', fid);
        }
    }

    if (hasLive) {
        return updateSeason(id, { active: false, ending: true, ends_at: now.toISOString() });
    }
    return updateSeason(id, { active: false, ending: false, ends_at: now.toISOString() });
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
        .order('sort_order', { ascending: true });
    if (error) throw error;
    return data;
}

export async function getSeasonScores(seasonId) {
    const mysteries = await getMysteriesBySeason(seasonId);
    if (!mysteries.length) return {};
    const mysteryIds = mysteries.map(m => m.id);
    const mysteriesMap = {};
    for (const m of mysteries) mysteriesMap[m.id] = m;

    const { data: guesses, error } = await supabase
        .from('guesses')
        .select('user_id, mystery_id, score, distance_m, submitted_at, guess')
        .in('mystery_id', mysteryIds);
    if (error) throw error;

    const scores = {};
    const bestByMystery = {};
    const guessesByUser = {};
    const allGuessesByMystery = {};
    for (const g of (guesses || [])) {
        if (!scores[g.user_id]) scores[g.user_id] = { score: 0, wins: 0, karma: 0 };
        scores[g.user_id].score += g.score;
        if (!bestByMystery[g.mystery_id] || g.score > bestByMystery[g.mystery_id].score) {
            bestByMystery[g.mystery_id] = g;
        }
        if (!guessesByUser[g.user_id]) guessesByUser[g.user_id] = [];
        guessesByUser[g.user_id].push(g);
        if (!allGuessesByMystery[g.mystery_id]) allGuessesByMystery[g.mystery_id] = [];
        allGuessesByMystery[g.mystery_id].push(g);
    }
    for (const best of Object.values(bestByMystery)) {
        if (scores[best.user_id]) scores[best.user_id].wins++;
    }
    const cumulativeScores = {};
    for (const [uid, s] of Object.entries(scores)) cumulativeScores[uid] = s.score;
    for (const [uid, userGuesses] of Object.entries(guessesByUser)) {
        if (scores[uid]) scores[uid].karma = calculateKarma(userGuesses, mysteriesMap, allGuessesByMystery, cumulativeScores);
    }
    return scores;
}

function calculateKarma(userGuesses, mysteriesMap, allGuessesByMystery, cumulativeScores) {
    let karma = 0, streak = 0;
    const scores = [];
    const userId = userGuesses[0]?.user_id;

    const sorted = [...userGuesses].sort((a, b) =>
        new Date(mysteriesMap[a.mystery_id]?.reveals_at ?? 0) - new Date(mysteriesMap[b.mystery_id]?.reveals_at ?? 0)
    );
    for (const g of sorted) {
        const m = mysteriesMap[g.mystery_id];
        if (!m) continue;
        const pub = new Date(m.published_at), rev = new Date(m.reveals_at), sub = new Date(g.submitted_at);
        const totalMs = rev - pub, elapsedMs = sub - pub;
        const elapsedSec = Math.max(0, Math.floor(elapsedMs / 1000));
        const isAuto = g.guess?.auto_guess === true;
        const isAutoSubmit = g.guess?.auto_submit === true;
        if (isAuto) {
            karma -= 1000 + Math.round(totalMs / 86400000);
            streak = 0;
        } else if (isAutoSubmit) {
            karma += Math.round((500 + Math.min(299, elapsedSec)) * 0.5);
            streak = 0;
        } else {
            karma += 500 + Math.min(299, elapsedSec);
            streak++;
            karma += 200;
            if (elapsedMs > totalMs * 0.90) karma -= 300 + Math.max(0, Math.floor((rev - sub) / 3600000)) * 5;
            if (elapsedSec < 5) karma -= 500 + Math.min(999, Math.round((g.distance_m ?? 0) / 1000));

            const mysteryGuesses = allGuessesByMystery[g.mystery_id];
            if (mysteryGuesses && mysteryGuesses.length > 1) {
                const rankedScores = mysteryGuesses.map(x => x.score).sort((a, b) => b - a);
                const rank = rankedScores.indexOf(g.score) + 1;
                const total = rankedScores.length;
                const basePlacement = 100 * (total - rank);
                const multiplier = rank > total / 2 ? 1.5 : 0.7;
                karma += Math.round(basePlacement * multiplier);
            }

            if (cumulativeScores && mysteryGuesses) {
                const myOverall = cumulativeScores[userId] ?? 0;
                let killed = 0;
                for (const other of mysteryGuesses) {
                    if (other.user_id === userId) continue;
                    const theirOverall = cumulativeScores[other.user_id] ?? 0;
                    if (theirOverall > myOverall && g.score > other.score) killed++;
                }
                karma += Math.min(600, killed * 150);
            }
        }

        scores.push(g.score);

        if (scores.length >= 2) {
            const priorAvg = scores.slice(0, -1).reduce((a, b) => a + b, 0) / (scores.length - 1);
            if (g.score > priorAvg) {
                karma += 300 + Math.round(g.score - priorAvg);
            } else if (g.score < priorAvg * 0.5) {
                karma -= 200;
            }
        }

        if (scores.length >= 3) {
            const recent = scores.slice(-3, -1);
            const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
            if (g.score > avg) karma += 500 + Math.round(g.score - avg);
            else if (g.score < Math.min(...recent)) karma -= 800 + Math.round(avg - g.score);
            const prevScore = scores[scores.length - 2];
            const allSorted = [...scores.slice(0, -1)].sort((a, b) => a - b);
            if (prevScore <= allSorted[Math.floor(allSorted.length * 0.25)] && g.score > allSorted[Math.floor(allSorted.length * 0.5)])
                karma += 1000 + Math.round(g.score - prevScore);
        }
    }
    return karma;
}

export async function createMystery(content) {
    const id = crypto.randomUUID();
    const { data, error } = await supabase
        .from('mysteries')
        .insert({ ...content, id, template_id: id })
        .select()
        .single();
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

export async function addMysteryToSeason(seasonId, templateId) {
    const { data: source, error: sErr } = await supabase
        .from('mysteries')
        .select('*')
        .eq('template_id', templateId)
        .limit(1)
        .single();
    if (sErr) throw sErr;

    const maxOrder = await getMaxSortOrder(seasonId);
    const { title, type, image_url, answer, image_width, image_height } = source;
    const { data, error } = await supabase
        .from('mysteries')
        .insert({
            template_id: templateId,
            season_id: seasonId,
            title, type, image_url, answer, image_width, image_height,
            sort_order: maxOrder + 1
        })
        .select()
        .single();
    if (error) throw error;
    return data;
}

export async function removeMysteryInstance(instanceId) {
    const { error } = await supabase
        .from('mysteries')
        .delete()
        .eq('id', instanceId);
    if (error) throw error;
}

export async function reorderSeasonMysteries(seasonId, orderedIds) {
    const updates = orderedIds.map((id, i) =>
        supabase.from('mysteries').update({ sort_order: i }).eq('id', id)
    );
    await Promise.all(updates);
}

export async function batchUpdateTimings(timings) {
    const updates = timings.map(t =>
        supabase.from('mysteries').update({
            published_at: t.published_at,
            reveals_at: t.reveals_at,
            override: t.override ?? false
        }).eq('id', t.id)
    );
    await Promise.all(updates);
}

async function getMaxSortOrder(seasonId) {
    const { data } = await supabase
        .from('mysteries')
        .select('sort_order')
        .eq('season_id', seasonId)
        .order('sort_order', { ascending: false })
        .limit(1);
    return data?.[0]?.sort_order ?? -1;
}

export async function deleteMysteryTemplate(templateId) {
    const { error } = await supabase.from('mysteries').delete().eq('template_id', templateId);
    if (error) throw error;
}

export function getLibraryMysteries(allMysteries) {
    const map = {};
    for (const m of allMysteries) {
        const tid = m.template_id || m.id;
        if (!map[tid]) map[tid] = m;
    }
    return Object.values(map);
}

export function groupByTemplate(mysteries) {
    const map = {};
    for (const m of mysteries) {
        const tid = m.template_id || m.id;
        if (!map[tid]) map[tid] = { ...m, template_id: tid, instances: [] };
        map[tid].instances.push(m);
    }
    return Object.values(map).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

const UNIT_MS = {
    seconds: 1000,
    minutes: 60 * 1000,
    hours: 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
    weeks: 7 * 24 * 60 * 60 * 1000
};

export function computeSchedule(mysteries, config) {
    const { starts_at, frequency_value, frequency_unit, gap_value, gap_unit } = config;
    if (!starts_at || !frequency_value || gap_value == null) return mysteries;

    const freqMs = frequency_value * (UNIT_MS[frequency_unit] || UNIT_MS.minutes);
    const gapMs = gap_value * (UNIT_MS[gap_unit] || UNIT_MS.minutes);
    const defaultDuration = freqMs - gapMs;
    if (defaultDuration <= 0) return mysteries;

    const sorted = [...mysteries].sort((a, b) => a.sort_order - b.sort_order);
    const now = new Date();
    let prevRevealsAt = null;

    for (let i = 0; i < sorted.length; i++) {
        const m = sorted[i];
        const isLocked = m.published_at && new Date(m.published_at) <= now;
        if (m.override || isLocked) {
            prevRevealsAt = m.reveals_at ? new Date(m.reveals_at).getTime() : null;
            continue;
        }

        let pubMs;
        if (prevRevealsAt == null) {
            pubMs = new Date(starts_at).getTime();
        } else {
            pubMs = prevRevealsAt + gapMs;
        }

        let useDuration = defaultDuration;
        const nextOverride = sorted.slice(i + 1).find(n => n.override && n.published_at);
        if (nextOverride) {
            const nextPubMs = new Date(nextOverride.published_at).getTime();
            const deadline = nextPubMs - gapMs;
            if (pubMs + defaultDuration > deadline) {
                useDuration = Math.max(deadline - pubMs, 10000);
            }
        }

        m.published_at = new Date(pubMs).toISOString();
        m.reveals_at = new Date(pubMs + useDuration).toISOString();
        prevRevealsAt = pubMs + useDuration;
    }
    return sorted;
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
        .select('user_id, mystery_id, score, distance_m, submitted_at, guess');
    if (gErr) throw gErr;

    const { data: mysteries, error: mErr } = await supabase
        .from('mysteries')
        .select('id, published_at, reveals_at')
        .not('published_at', 'is', null);
    if (mErr) throw mErr;

    const mysteriesMap = {};
    for (const m of (mysteries || [])) mysteriesMap[m.id] = m;

    const bestByMystery = {};
    for (const g of (guesses || [])) {
        if (!bestByMystery[g.mystery_id] || g.score > bestByMystery[g.mystery_id].score) {
            bestByMystery[g.mystery_id] = g;
        }
    }

    const totals = {};
    const guessesByUser = {};
    const allGuessesByMystery = {};
    for (const g of (guesses || [])) {
        if (!totals[g.user_id]) totals[g.user_id] = { score: 0, wins: 0 };
        totals[g.user_id].score += g.score;
        if (!guessesByUser[g.user_id]) guessesByUser[g.user_id] = [];
        guessesByUser[g.user_id].push(g);
        if (!allGuessesByMystery[g.mystery_id]) allGuessesByMystery[g.mystery_id] = [];
        allGuessesByMystery[g.mystery_id].push(g);
    }
    for (const best of Object.values(bestByMystery)) {
        if (totals[best.user_id]) totals[best.user_id].wins++;
    }

    const cumulativeScores = {};
    for (const [uid, t] of Object.entries(totals)) cumulativeScores[uid] = t.score;

    return profiles.map(p => ({
        ...p,
        total_score: totals[p.id]?.score ?? 0,
        wins: totals[p.id]?.wins ?? 0,
        jeff_karma: calculateKarma(guessesByUser[p.id] ?? [], mysteriesMap, allGuessesByMystery, cumulativeScores)
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
