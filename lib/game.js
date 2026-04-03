import { supabase } from './supabase.js';

// ── Math helpers ──

const RAD = Math.PI / 180;
const EARTH_RADIUS = 6_371_000; // meters

function haversineDistance(lat1, lng1, lat2, lng2) {
    const dLat = (lat2 - lat1) * RAD;
    const dLng = (lng2 - lng1) * RAD;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLng / 2) ** 2;
    return EARTH_RADIUS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calculateScore(distanceMeters, submittedAt, publishedAt, revealsAt) {
    const km = distanceMeters / 1000;
    const base = Math.max(0, 2500 - 220 * Math.log(1 + km));
    let multiplier = 1.0;
    if (submittedAt && publishedAt && revealsAt) {
        const total = new Date(revealsAt) - new Date(publishedAt);
        const remaining = new Date(revealsAt) - new Date(submittedAt);
        if (total > 0) multiplier = 1 + 0.10 * Math.max(0, Math.min(1, remaining / total));
    }
    return Math.round(base * multiplier);
}

// ── Name helpers ──

export function firstName(fullName) {
    return (fullName || 'Unknown').split(/\s+/)[0];
}

export function formatNumber(n) {
    return Number(n).toLocaleString('en-US');
}

// ── Geocoding ──

export async function reverseGeocode(lat, lng) {
    try {
        const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&zoom=18&accept-language=en`,
            { headers: { 'Accept': 'application/json' } }
        );
        const data = await res.json();
        if (!data || data.error) return [];
        const a = data.address || {};
        return [
            a.road || a.pedestrian || a.path || '',
            a.neighbourhood || a.suburb || a.quarter || a.borough || '',
            a.city || a.town || a.village || a.hamlet || a.municipality || '',
            a.state || a.region || a.county || '',
            a.country || ''
        ].filter(Boolean);
    } catch { return []; }
}

export function formatLocationLabel(levels) {
    if (!levels || !levels.length) return 'Unknown';
    const country = levels[levels.length - 1];
    if (levels.length === 1) return country;
    const local = levels.length >= 3 ? levels[levels.length - 3] : levels[0];
    return local === country ? country : `${local}, ${country}`;
}

// ── Formatting ──

export function formatTimeAgo(submittedAt, publishedAt) {
    const ms = new Date(submittedAt) - new Date(publishedAt);
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    if (totalSeconds < 60) return `${totalSeconds} sec`;
    const minutes = totalSeconds / 60;
    if (minutes < 60) { const v = parseFloat(minutes.toFixed(1)); return `${v} min`; }
    const hours = minutes / 60;
    if (hours < 24) { const v = parseFloat(hours.toFixed(1)); return `${v} hrs`; }
    const days = hours / 24;
    const v = parseFloat(days.toFixed(1));
    return `${v} days`;
}

export function formatDistance(meters) {
    if (meters >= 1000) {
        const km = meters / 1000;
        const val = km >= 100 ? Math.round(km) : parseFloat(km.toFixed(1));
        return `${formatNumber(val)} ${val === 1 ? 'kilometer' : 'kilometers'}`;
    }
    const val = Math.round(meters);
    return `${formatNumber(val)} ${val === 1 ? 'meter' : 'meters'}`;
}

export function formatDistanceShort(meters) {
    if (meters >= 1000) {
        const km = meters / 1000;
        const val = km >= 100 ? Math.round(km) : parseFloat(km.toFixed(1));
        return `${formatNumber(val)} km`;
    }
    const val = Math.round(meters);
    return `${formatNumber(val)} m`;
}

export function formatCountdown(targetDate) {
    const diff = new Date(targetDate) - Date.now();
    if (diff <= 0) return null;
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    const s = Math.floor((diff % 60_000) / 1000);
    const pad = n => String(n).padStart(2, '0');
    return `${h}:${pad(m)}:${pad(s)} LEFT`;
}

export function formatCountdownIn(targetDate) {
    const diff = new Date(targetDate) - Date.now();
    if (diff <= 0) return null;
    const d = Math.floor(diff / 86_400_000);
    const h = Math.floor((diff % 86_400_000) / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    const s = Math.floor((diff % 60_000) / 1000);
    const pad = n => String(n).padStart(2, '0');
    if (d > 0) return `IN ${d}d ${pad(h)}:${pad(m)}:${pad(s)}`;
    return `IN ${h}:${pad(m)}:${pad(s)}`;
}

export function formatMysteryDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric'
    }).toUpperCase();
}

// ── Season queries ──

export async function getUserSeasons(userId) {
    const { data, error } = await supabase
        .from('season_members')
        .select('season_id, seasons(*)')
        .eq('user_id', userId)
        .eq('seasons.active', true)
        .order('seasons(created_at)', { ascending: false });
    if (error) throw error;
    return (data ?? []).filter(r => r.seasons).map(r => r.seasons);
}

// ── Mystery queries ──

export async function getSeasonMysteries(seasonId) {
    const { data, error } = await supabase
        .from('mysteries')
        .select('*')
        .eq('season_id', seasonId)
        .not('published_at', 'is', null)
        .lte('published_at', new Date().toISOString())
        .order('published_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
}

export function getCurrentMystery(mysteries) {
    const now = new Date();
    return mysteries.find(m =>
        m.published_at &&
        new Date(m.published_at) <= now &&
        m.reveals_at &&
        new Date(m.reveals_at) > now
    ) ?? null;
}

export function getRevealedMysteries(mysteries) {
    const now = new Date();
    return mysteries.filter(m =>
        m.reveals_at && new Date(m.reveals_at) <= now
    );
}

export async function getAppSetting(key) {
    const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', key)
        .maybeSingle();
    if (error) throw error;
    return data?.value ?? null;
}

export async function getNextMysteryInfo(seasonId) {
    const { data, error } = await supabase.rpc('get_next_mystery_info', { p_season_id: seasonId });
    if (error) throw error;
    return data;
}

// ── Guesses ──

export async function getGuesses(mysteryId) {
    const { data, error } = await supabase
        .from('guesses')
        .select('*, profiles(name)')
        .eq('mystery_id', mysteryId)
        .order('submitted_at');
    if (error) throw error;
    return data ?? [];
}

export async function getUserGuess(mysteryId, userId) {
    const { data, error } = await supabase
        .from('guesses')
        .select('*')
        .eq('mystery_id', mysteryId)
        .eq('user_id', userId)
        .maybeSingle();
    if (error) throw error;
    return data;
}

export async function submitGuess(mysteryId, lat, lng, answerLat, answerLng, publishedAt, revealsAt) {
    const distance = haversineDistance(lat, lng, answerLat, answerLng);
    const submittedAt = new Date().toISOString();
    const score = calculateScore(distance, submittedAt, publishedAt, revealsAt);
    const location = await reverseGeocode(lat, lng);
    const { data, error } = await supabase
        .from('guesses')
        .insert({
            mystery_id: mysteryId,
            user_id: (await supabase.auth.getSession()).data.session.user.id,
            guess: { lat, lng, location },
            distance_m: distance,
            score
        })
        .select()
        .single();
    if (error) throw error;
    return data;
}

// ── Realtime ──

export function subscribeGuesses(mysteryId, onInsert) {
    const channel = supabase
        .channel(`guesses:${mysteryId}`)
        .on(
            'postgres_changes',
            {
                event: 'INSERT',
                schema: 'public',
                table: 'guesses',
                filter: `mystery_id=eq.${mysteryId}`
            },
            async (payload) => {
                const guess = payload.new;
                const { data: profile } = await supabase
                    .from('profiles')
                    .select('name')
                    .eq('id', guess.user_id)
                    .single();
                guess.profiles = profile;
                onInsert(guess);
            }
        )
        .subscribe();
    return channel;
}

// ── Leaderboard ──

export async function getSeasonLeaderboard(seasonId) {
    const { data: mysteries, error: mErr } = await supabase
        .from('mysteries')
        .select('id, published_at, reveals_at')
        .eq('season_id', seasonId)
        .not('published_at', 'is', null)
        .order('reveals_at', { ascending: false });
    if (mErr) throw mErr;

    const revealed = (mysteries ?? [])
        .filter(m => m.reveals_at && new Date(m.reveals_at) <= new Date());
    if (!revealed.length) return [];

    const revealedIds = revealed.map(m => m.id);
    const latestId = revealed[0].id;
    const prevIds = revealedIds.filter(id => id !== latestId);

    const mysteriesMap = {};
    for (const m of revealed) mysteriesMap[m.id] = m;

    const { data: guesses, error: gErr } = await supabase
        .from('guesses')
        .select('user_id, score, distance_m, submitted_at, mystery_id, profiles(name)')
        .in('mystery_id', revealedIds);
    if (gErr) throw gErr;

    function buildBoard(ids) {
        const map = {};
        const bestByMystery = {};
        for (const g of (guesses ?? [])) {
            if (!ids.includes(g.mystery_id)) continue;
            if (!map[g.user_id]) {
                map[g.user_id] = {
                    user_id: g.user_id,
                    name: g.profiles?.name ?? 'Unknown',
                    total_score: 0,
                    total_distance: 0,
                    wins: 0
                };
            }
            map[g.user_id].total_score += g.score;
            map[g.user_id].total_distance += g.distance_m ?? 0;
            if (!bestByMystery[g.mystery_id] || g.score > bestByMystery[g.mystery_id].score) {
                bestByMystery[g.mystery_id] = g;
            }
        }
        for (const best of Object.values(bestByMystery)) {
            if (map[best.user_id]) map[best.user_id].wins++;
        }
        return Object.values(map).sort((a, b) => b.total_score - a.total_score);
    }

    const current = buildBoard(revealedIds);
    const previous = prevIds.length ? buildBoard(prevIds) : [];

    const prevPosMap = {};
    previous.forEach((entry, i) => { prevPosMap[entry.user_id] = i + 1; });

    const guessesByUser = {};
    for (const g of (guesses ?? [])) {
        if (!guessesByUser[g.user_id]) guessesByUser[g.user_id] = [];
        guessesByUser[g.user_id].push(g);
    }

    current.forEach((entry, i) => {
        const pos = i + 1;
        const prevPos = prevPosMap[entry.user_id];
        if (prevPos == null) {
            entry.trend = '★';
        } else if (prevPos === pos) {
            entry.trend = '–';
        } else if (prevPos > pos) {
            entry.trend = '⏶';
        } else {
            entry.trend = '⏷';
        }
        entry.jeff_karma = calculateJeffKarma(guessesByUser[entry.user_id] ?? [], mysteriesMap);
    });

    return current;
}

// ── Jeff Karma ──

function calculateJeffKarma(userGuesses, mysteriesMap) {
    let karma = 0;
    let streak = 0;
    const scores = [];

    const sorted = [...userGuesses].sort((a, b) =>
        new Date(mysteriesMap[a.mystery_id]?.reveals_at ?? 0) - new Date(mysteriesMap[b.mystery_id]?.reveals_at ?? 0)
    );

    for (const g of sorted) {
        const m = mysteriesMap[g.mystery_id];
        if (!m) continue;

        const pub = new Date(m.published_at);
        const rev = new Date(m.reveals_at);
        const sub = new Date(g.submitted_at);
        const totalMs = rev - pub;
        const elapsedMs = sub - pub;
        const elapsedSec = Math.max(0, Math.floor(elapsedMs / 1000));
        const timeRemainingPct = Math.max(0, Math.min(100, Math.round((1 - elapsedMs / totalMs) * 100)));
        const isAuto = sub.getTime() >= rev.getTime();

        if (isAuto) {
            const activeDays = Math.round(totalMs / 86400000);
            karma -= 1000 + activeDays;
            streak = 0;
        } else {
            karma += 500 + Math.min(299, elapsedSec);

            streak++;
            karma += 300 * streak + streak * streak;

            if (elapsedMs < totalMs * 0.10 && elapsedSec >= 30) {
                karma += 800 + timeRemainingPct;
            }

            if (elapsedMs > totalMs * 0.90) {
                const hoursLeft = Math.max(0, Math.floor((rev - sub) / 3600000));
                karma -= 300 + hoursLeft * 5;
            }

            // Quick-click: guessed within 5 seconds
            if (elapsedSec < 5) {
                const distKm = Math.min(999, Math.round((g.distance_m ?? 0) / 1000));
                karma -= 500 + distKm;
            }
        }

        // Trend-based factors (need at least 3 prior scores)
        scores.push(g.score);
        if (scores.length >= 4) {
            const recent3 = scores.slice(-4, -1);
            const avg3 = recent3.reduce((a, b) => a + b, 0) / 3;
            const current = g.score;

            if (current > avg3) {
                // Improvement: scored above average of last 3
                karma += 1000 + Math.round(current - avg3);
            } else if (current < Math.min(...recent3)) {
                // Free fall: scored below all of last 3
                karma -= 800 + Math.round(avg3 - current);
            }

            // Bounce-back: scored above median after being in bottom 25%
            const prevScore = scores[scores.length - 2];
            const allScoresSorted = [...scores.slice(0, -1)].sort((a, b) => a - b);
            const p25 = allScoresSorted[Math.floor(allScoresSorted.length * 0.25)];
            const median = allScoresSorted[Math.floor(allScoresSorted.length * 0.5)];
            if (prevScore <= p25 && current > median) {
                karma += 1500 + Math.round(current - prevScore);
            }
        }
    }

    return karma;
}

export async function getMysteryLeaderboard(mysteryId, publishedAt, revealsAt) {
    const guesses = await getGuesses(mysteryId);
    return guesses
        .map(g => {
            const isAuto = revealsAt && new Date(g.submitted_at) >= new Date(revealsAt);
            const time = formatTimeAgo(g.submitted_at, publishedAt);
            return {
                user_id: g.user_id,
                name: g.profiles?.name ?? 'Unknown',
                score: g.score,
                distance_m: g.distance_m,
                time: isAuto ? `${time} (A)` : time,
                guess: g.guess,
                submitted_at: g.submitted_at,
                is_auto: isAuto
            };
        })
        .sort((a, b) => b.score - a.score);
}
