import { supabase } from './supabase.js';

// ── Math helpers ──

const RAD = Math.PI / 180;
const EARTH_RADIUS = 6_371_000; // meters
const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
export function computeTimePeriod(answerDecimal) {
    const now = new Date();
    const y = now.getFullYear();
    const soy = new Date(y, 0, 1);
    const eoy = new Date(y + 1, 0, 1);
    const currentDec = y + (now - soy) / (eoy - soy);
    const d = Math.max(1, Math.abs(currentDec - answerDecimal));
    return Math.min(13_800_000_000, Math.max(100, d * (1 + 0.5 * Math.log(d))));
}

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

// ── Time mystery helpers ──

export function timeToDecimal(t) {
    let y = Number(t.year) || 0;
    if (t.bc && y > 0) y = -y;
    const absY = Math.abs(y);
    if (y >= 1 && absY <= 275760) {
        const month = (Number(t.month) || 1);
        const day = (Number(t.day) || 1);
        const hour = (Number(t.hour) || 0);
        const minute = (Number(t.minute) || 0);
        const soy = new Date(absY, 0, 1);
        if (absY < 100) soy.setFullYear(absY);
        const eoy = new Date(absY + 1, 0, 1);
        if (absY + 1 < 100) eoy.setFullYear(absY + 1);
        const dt = new Date(absY, month - 1, day, hour, minute);
        if (absY < 100) dt.setFullYear(absY);
        return y + (dt - soy) / (eoy - soy);
    }
    const month = Number(t.month) || 1;
    const day = Number(t.day) || 1;
    const hour = Number(t.hour) || 0;
    const minute = Number(t.minute) || 0;
    const frac = ((month - 1) + ((day - 1) + (hour + minute / 60) / 24) / 30.44) / 12;
    return y + frac;
}

export function decimalToTime(d) {
    const bc = d < 0;
    const absD = Math.abs(d);
    let yearInt, frac;
    if (bc) {
        yearInt = absD === Math.floor(absD) ? absD : Math.ceil(absD);
        frac = yearInt - absD;
    } else {
        yearInt = Math.floor(absD);
        frac = absD - yearInt;
    }

    if (!bc && yearInt >= 1 && yearInt <= 275760) {
        const soy = new Date(yearInt, 0, 1);
        if (yearInt < 100) soy.setFullYear(yearInt);
        const eoy = new Date(yearInt + 1, 0, 1);
        if (yearInt + 1 < 100) eoy.setFullYear(yearInt + 1);
        const rawMs = soy.getTime() + frac * (eoy - soy);
        const dt = new Date(Math.round(rawMs / 60000) * 60000);
        return { year: yearInt, month: dt.getMonth() + 1, day: dt.getDate(), hour: dt.getHours(), minute: dt.getMinutes(), bc: false };
    }

    const monthFrac = frac * 12;
    const month = Math.min(12, Math.floor(monthFrac) + 1);
    const dayFrac = (monthFrac - Math.floor(monthFrac)) * 30.44;
    const day = Math.max(1, Math.min(31, Math.floor(dayFrac) + 1));
    const hourFrac = (dayFrac - Math.floor(dayFrac)) * 24;
    const hour = Math.floor(hourFrac);
    const minute = Math.round((hourFrac - hour) * 60);
    return { year: bc ? -yearInt : yearInt, month, day, hour, minute, bc };
}

function truncateToDetail(t, detailLevel) {
    const dl = detailLevel || 'minute';
    const r = { year: Number(t.year) || 0, month: 1, day: 1, hour: 0, minute: 0, bc: t.bc };
    if (dl === 'year') return r;
    r.month = Number(t.month) || 1;
    if (dl === 'month') return r;
    r.day = Number(t.day) || 1;
    if (dl === 'day') return r;
    r.hour = Number(t.hour) || 0;
    r.minute = Number(t.minute) || 0;
    return r;
}

export function timeYearsDiff(a, b, detailLevel) {
    const ta = truncateToDetail(a, detailLevel);
    const tb = truncateToDetail(b, detailLevel);
    return Math.abs(timeToDecimal(ta) - timeToDecimal(tb));
}

const RANGE_UNIT_TO_YEARS = { minute: 1/525960, hour: 1/8766, day: 1/365.25, month: 1/12, year: 1 };

export function calculateTimeScore(yearsDiff, answer, submittedAt, publishedAt, revealsAt) {
    let period;
    if (answer.period_start && answer.period_end) {
        period = Math.abs(timeToDecimal(answer.period_end) - timeToDecimal(answer.period_start));
    } else {
        period = computeTimePeriod(timeToDecimal(answer));
    }
    let absDiff = Math.abs(yearsDiff);
    if (answer.range > 0 && answer.range_unit) {
        const rangeYears = answer.range * (RANGE_UNIT_TO_YEARS[answer.range_unit] || 1);
        absDiff = Math.max(0, absDiff - rangeYears);
    }
    const fraction = Math.min(1, absDiff / period);
    const base = Math.max(0, 2500 - 220 * Math.log(1 + 20000 * fraction));
    let multiplier = 1.0;
    if (submittedAt && publishedAt && revealsAt) {
        const total = new Date(revealsAt) - new Date(publishedAt);
        const remaining = new Date(revealsAt) - new Date(submittedAt);
        if (total > 0) multiplier = 1 + 0.10 * Math.max(0, Math.min(1, remaining / total));
    }
    return Math.round(base * multiplier);
}

export function formatTimeDifference(yearsDiff) {
    const a = Math.abs(yearsDiff);
    if (a === 0) return 'Perfect';
    if (a < 1 / 365.25) {
        const hrs = a * 8766;
        if (hrs < 1) return `${Math.round(hrs * 60)} minutes`;
        return `${parseFloat(hrs.toFixed(1))} hours`;
    }
    if (a < 1 / 12) { const d = a * 365.25; return `${formatNumber(Math.round(d))} days`; }
    if (a < 1) { const mo = a * 12; return `${parseFloat(mo.toFixed(1))} months`; }
    if (a < 10000) return `${formatNumber(parseFloat(a.toFixed(1)))} years`;
    if (a < 1_000_000) return `${formatNumber(Math.round(a))} years`;
    if (a < 1_000_000_000) return `${parseFloat((a / 1_000_000).toFixed(1))}M years`;
    return `${parseFloat((a / 1_000_000_000).toFixed(1))}B years`;
}

export function formatTimeDifferenceShort(yearsDiff) {
    const a = Math.abs(yearsDiff);
    if (a === 0) return 'Perfect';
    if (a < 1 / 365.25) {
        const hrs = a * 8766;
        if (hrs < 1) return `${formatNumber(Math.round(hrs * 60))} min`;
        return `${formatNumber(parseFloat(hrs.toFixed(1)))} hrs`;
    }
    if (a < 1 / 12) return `${formatNumber(Math.round(a * 365.25))} d`;
    if (a < 1) return `${formatNumber(parseFloat((a * 12).toFixed(1)))} mo`;
    if (a < 10000) return `${formatNumber(parseFloat(a.toFixed(1)))} yr`;
    if (a < 1_000_000) return `${formatNumber(Math.round(a))} yr`;
    if (a < 1_000_000_000) return `${parseFloat((a / 1_000_000).toFixed(1))}M yr`;
    return `${parseFloat((a / 1_000_000_000).toFixed(1))}B yr`;
}

export function formatTimeDisplay(t, detailLevel) {
    if (!t || t.year == null) return { year: '—', date: '', time: '' };
    const absYear = Math.abs(t.year);
    const bc = t.bc || t.year < 0;
    const yearStr = (absYear < 10000 ? String(absYear) : formatNumber(absYear).replace(/,/g, ' ')) + (bc ? ' BC' : '');
    const month = Number(t.month) || 1;
    const day = Number(t.day) || 1;
    const monthName = MONTHS_FULL[month - 1] || '';
    const shortMonth = monthName.slice(0, 3);

    let dateStr = '';
    if (detailLevel === 'month') {
        dateStr = monthName;
    } else if (detailLevel === 'day' || detailLevel === 'minute') {
        let dayName = '';
        try {
            let yr = bc ? -absYear : absYear;
            let eqY = ((yr % 400) + 400) % 400;
            if (eqY === 0) eqY = 400;
            const d = new Date(eqY, month - 1, day);
            if (eqY < 100) d.setFullYear(eqY);
            dayName = d.toLocaleDateString('en-US', { weekday: 'long' });
        } catch {}
        dateStr = dayName ? `${dayName}, ${shortMonth} ${day}` : `${shortMonth} ${day}`;
    }

    let timeStr = '';
    if (detailLevel === 'minute') {
        const hr24 = Number(t.hour) || 0;
        const min = Number(t.minute) || 0;
        const period = hr24 >= 12 ? 'PM' : 'AM';
        const hr12 = hr24 === 0 ? 12 : hr24 > 12 ? hr24 - 12 : hr24;
        timeStr = `${hr12}:${String(min).padStart(2, '0')} ${period}`;
    }

    return { year: yearStr, date: dateStr, time: timeStr };
}

export function formatTimeTitle(answer) {
    if (!answer || answer.year == null) return 'Unknown';
    const absYear = Math.abs(answer.year);
    const bc = answer.bc || answer.year < 0;
    const yearStr = absYear >= 1_000_000_000
        ? `${parseFloat((absYear / 1_000_000_000).toFixed(1))}B`
        : absYear >= 1_000_000
        ? `${parseFloat((absYear / 1_000_000).toFixed(1))}M`
        : absYear >= 10_000
        ? `${parseFloat((absYear / 1_000).toFixed(1))}K`
        : String(absYear);
    const suffix = bc ? ' BC' : '';
    const m = MONTHS_FULL[(Number(answer.month) || 1) - 1] || '';
    const pad = n => String(n).padStart(2, '0');
    switch (answer.detail_level) {
        case 'minute': return `${m} ${answer.day || 1}, ${yearStr}${suffix} ${pad(answer.hour || 0)}:${pad(answer.minute || 0)}`;
        case 'day': return `${m} ${answer.day || 1}, ${yearStr}${suffix}`;
        case 'month': return `${m} ${yearStr}${suffix}`;
        default: return `${yearStr}${suffix}`;
    }
}

export async function submitTimeGuess(mysteryId, guessTime, answer, publishedAt, revealsAt, { autoGuess = false, autoSubmit = false } = {}) {
    const detailLevel = answer.detail_level || 'minute';
    const yearsDiff = timeYearsDiff(guessTime, answer, detailLevel);
    const submittedAt = new Date().toISOString();
    const score = calculateTimeScore(yearsDiff, answer, submittedAt, publishedAt, revealsAt);
    const userId = (await supabase.auth.getSession()).data.session.user.id;
    if (autoGuess) guessTime = { ...guessTime, auto_guess: true };
    else if (autoSubmit) guessTime = { ...guessTime, auto_submit: true };
    const row = { mystery_id: mysteryId, user_id: userId, guess: guessTime, distance_m: yearsDiff, score };
    const { data, error } = await supabase.from('guesses').insert(row).select().single();
    if (error && (error.code === '23505' || error.message?.includes('duplicate'))) {
        const { data: updated, error: upErr } = await supabase.from('guesses')
            .update({ guess: guessTime, distance_m: yearsDiff, score })
            .eq('mystery_id', mysteryId).eq('user_id', userId)
            .select().single();
        if (upErr) throw upErr;
        return updated;
    }
    if (error) throw error;
    return data;
}

// ── Name helpers ──

export function firstName(fullName) {
    return (fullName || 'Unknown').split(/\s+/)[0];
}

export function formatNumber(n) {
    return Number(n).toLocaleString('en-US');
}

// ── Geocoding ──

const geocodeCache = new Map();
let lastGeocodeTime = 0;

function geocodeCacheKey(lat, lng) {
    return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

export async function reverseGeocode(lat, lng) {
    const key = geocodeCacheKey(lat, lng);
    if (geocodeCache.has(key)) return geocodeCache.get(key);

    const wait = 1100 - (Date.now() - lastGeocodeTime);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastGeocodeTime = Date.now();

    try {
        const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&zoom=18&accept-language=en`,
            { headers: { 'Accept': 'application/json' } }
        );
        const data = await res.json();
        if (!data || data.error) return [];
        const a = data.address || {};
        const result = [
            a.road || a.pedestrian || a.path || '',
            a.neighbourhood || a.suburb || a.quarter || a.borough || '',
            a.city || a.town || a.village || a.hamlet || a.municipality || '',
            a.state || a.region || a.county || '',
            a.country || ''
        ].filter(Boolean);
        geocodeCache.set(key, result);
        return result;
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

function dhms(diff) {
    const d = Math.floor(diff / 86_400_000);
    const h = Math.floor((diff % 86_400_000) / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    const s = Math.floor((diff % 60_000) / 1000);
    const pad = n => String(n).padStart(2, '0');
    const parts = [];
    if (d > 0) parts.push(String(d), pad(h), pad(m), pad(s));
    else if (h > 0) parts.push(String(h), pad(m), pad(s));
    else parts.push(String(m), pad(s));
    return parts.join(':');
}

export function formatCountdown(targetDate) {
    const diff = new Date(targetDate) - Date.now();
    if (diff <= 0) return null;
    return `${dhms(diff)} LEFT`;
}

export function formatCountdownIn(targetDate) {
    const diff = new Date(targetDate) - Date.now();
    if (diff <= 0) return null;
    return `IN ${dhms(diff)}`;
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
        .order('seasons(created_at)', { ascending: false });
    if (error) throw error;
    return (data ?? []).filter(r => r.seasons).map(r => r.seasons);
}

export async function getAllSeasons() {
    const { data, error } = await supabase
        .from('seasons')
        .select('*')
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
}

export async function checkSeasonAutoEnd(seasonId) {
    const { data: seasonData } = await supabase
        .from('seasons')
        .select('active, ends_at, ending')
        .eq('id', seasonId)
        .single();
    if (!seasonData) return false;

    if (!seasonData.active && !seasonData.ending) return true;

    const { data: nextMystery } = await supabase.rpc('get_next_mystery_info', { p_season_id: seasonId });
    if (nextMystery?.published_at) return false;

    const { data: allMysteries } = await supabase
        .from('mysteries')
        .select('id, published_at, reveals_at')
        .eq('season_id', seasonId)
        .not('published_at', 'is', null);

    if (!allMysteries?.length && seasonData.active) return false;

    const now = new Date();
    const hasLive = allMysteries?.some(m =>
        m.published_at && new Date(m.published_at) <= now &&
        m.reveals_at && new Date(m.reveals_at) > now
    );

    if (hasLive) return false;

    const allRevealed = allMysteries?.length && allMysteries.every(m =>
        m.reveals_at && new Date(m.reveals_at) <= now
    );

    if (!seasonData.active && seasonData.ending && allRevealed) {
        await supabase.from('seasons').update({ ending: false }).eq('id', seasonId);
        return true;
    }

    if (seasonData.active && allRevealed) {
        await supabase.from('seasons').update({ active: false, ending: false, ends_at: now.toISOString() }).eq('id', seasonId);
        return true;
    }

    return false;
}

export async function getSeasonWinners(seasonId) {
    const board = await getSeasonLeaderboard(seasonId);
    if (!board.length) return null;

    const scoreWinner = board[0];

    const karmaWinner = [...board].sort((a, b) => b.jeff_karma - a.jeff_karma || b.total_score - a.total_score)[0];

    const maxWins = Math.max(...board.map(p => p.wins));
    const tiedOnWins = board.filter(p => p.wins === maxWins);
    let winsWinner;
    if (tiedOnWins.length === 1) {
        winsWinner = tiedOnWins[0];
    } else {
        const otherIds = new Set([scoreWinner.user_id, karmaWinner.user_id]);
        const noOtherPrize = tiedOnWins.filter(p => !otherIds.has(p.user_id));
        const pool = noOtherPrize.length > 0 ? noOtherPrize : tiedOnWins;
        winsWinner = pool[Math.floor(Math.random() * pool.length)];
    }

    const { data: mysteries } = await supabase
        .from('mysteries')
        .select('id')
        .eq('season_id', seasonId)
        .not('published_at', 'is', null);
    const mysteryCount = mysteries?.length ?? 0;

    return {
        score: { name: scoreWinner.name, value: scoreWinner.total_score },
        wins: { name: winsWinner.name, value: winsWinner.wins, total: mysteryCount },
        karma: { name: karmaWinner.name, value: karmaWinner.jeff_karma }
    };
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

export async function submitGuess(mysteryId, lat, lng, answerLat, answerLng, publishedAt, revealsAt, { autoGuess = false, autoSubmit = false } = {}) {
    const distance = haversineDistance(lat, lng, answerLat, answerLng);
    const submittedAt = new Date().toISOString();
    const score = calculateScore(distance, submittedAt, publishedAt, revealsAt);
    const location = await reverseGeocode(lat, lng);
    const userId = (await supabase.auth.getSession()).data.session.user.id;
    const guess = autoGuess ? { lat, lng, location, auto_guess: true }
        : autoSubmit ? { lat, lng, location, auto_submit: true }
        : { lat, lng, location };
    const row = { mystery_id: mysteryId, user_id: userId, guess, distance_m: distance, score };
    const { data, error } = await supabase.from('guesses').insert(row).select().single();
    if (error && (error.code === '23505' || error.message?.includes('duplicate'))) {
        const { data: updated, error: upErr } = await supabase.from('guesses')
            .update({ guess, distance_m: distance, score })
            .eq('mystery_id', mysteryId).eq('user_id', userId)
            .select().single();
        if (upErr) throw upErr;
        return updated;
    }
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

export function subscribeMysteries(seasonId, onChange) {
    const channel = supabase
        .channel(`mysteries:${seasonId}`)
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'mysteries',
                filter: `season_id=eq.${seasonId}`
            },
            (payload) => onChange(payload)
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
        .select('user_id, score, distance_m, submitted_at, mystery_id, guess, profiles(name)')
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

    const allGuessesByMystery = {};
    for (const g of (guesses ?? [])) {
        (allGuessesByMystery[g.mystery_id] ??= []).push(g);
    }

    function buildKarmaContext(ids) {
        const mMap = {}, byUser = {}, byMystery = {};
        for (const m of revealed) { if (ids.includes(m.id)) mMap[m.id] = m; }
        for (const g of (guesses ?? [])) {
            if (!ids.includes(g.mystery_id)) continue;
            (byUser[g.user_id] ??= []).push(g);
            (byMystery[g.mystery_id] ??= []).push(g);
        }
        const board = buildBoard(ids);
        const scores = {};
        for (const e of board) scores[e.user_id] = e.total_score;
        return { mMap, byUser, byMystery, scores };
    }

    function computeKarma(board, ctx) {
        board.forEach(entry => {
            entry.jeff_karma = calculateJeffKarma(ctx.byUser[entry.user_id] ?? [], ctx.mMap, ctx.byMystery, ctx.scores);
        });
    }

    const curCtx = buildKarmaContext(revealedIds);
    computeKarma(current, curCtx);

    const prevCtx = prevIds.length ? buildKarmaContext(prevIds) : null;
    if (prevCtx) computeKarma(previous, prevCtx);

    function trendSymbol(curPos, prevPos) {
        if (prevPos == null) return 'new';
        if (prevPos === curPos) return 'same';
        return prevPos > curPos ? 'up' : 'down';
    }

    function buildPosMap(board, sortFn) {
        const sorted = [...board].sort(sortFn);
        const map = {};
        sorted.forEach((e, i) => { map[e.user_id] = i + 1; });
        return map;
    }

    const scoreSortFn = (a, b) => b.total_score - a.total_score;
    const winsSortFn = (a, b) => b.wins - a.wins || b.total_score - a.total_score;
    const karmaSortFn = (a, b) => b.jeff_karma - a.jeff_karma || b.total_score - a.total_score;

    const prevScorePos = buildPosMap(previous, scoreSortFn);
    const prevWinsPos = buildPosMap(previous, winsSortFn);
    const prevKarmaPos = buildPosMap(previous, karmaSortFn);

    const curScorePos = buildPosMap(current, scoreSortFn);
    const curWinsPos = buildPosMap(current, winsSortFn);
    const curKarmaPos = buildPosMap(current, karmaSortFn);

    current.forEach(entry => {
        const uid = entry.user_id;
        entry.trend_score = trendSymbol(curScorePos[uid], prevScorePos[uid]);
        entry.trend_wins = trendSymbol(curWinsPos[uid], prevWinsPos[uid]);
        entry.trend_karma = trendSymbol(curKarmaPos[uid], prevKarmaPos[uid]);
        entry.trend = entry.trend_score;
    });

    const last4 = revealed.slice(0, 4).reverse();
    const last3 = revealed.slice(0, 3);
    if (last4.length >= 4) {
        const scoreByUser = {};
        for (const m of last4) {
            for (const g of (allGuessesByMystery[m.id] || [])) {
                (scoreByUser[g.user_id] ??= []).push({ mid: m.id, score: g.score });
            }
        }

        const winsCount = {};
        for (const m of last3) {
            const mg = (allGuessesByMystery[m.id] || []).slice().sort((a, b) => b.score - a.score);
            if (mg.length) winsCount[mg[0].user_id] = (winsCount[mg[0].user_id] || 0) + 1;
        }

        const prev2Ids = revealedIds.filter(id => id !== revealed[0].id && id !== revealed[1].id);
        const prev3Ids = revealedIds.filter(id => id !== revealed[0].id && id !== revealed[1].id && id !== revealed[2].id);
        const prev2Ctx = prev2Ids.length ? buildKarmaContext(prev2Ids) : null;
        const prev3Ctx = prev3Ids.length ? buildKarmaContext(prev3Ids) : null;

        const karmaAt = {};
        current.forEach(e => { (karmaAt[e.user_id] ??= {}).k0 = e.jeff_karma; });
        if (prevCtx) {
            previous.forEach(e => { (karmaAt[e.user_id] ??= {}).k1 = e.jeff_karma; });
        }
        if (prev2Ctx) {
            const board2 = buildBoard(prev2Ids);
            computeKarma(board2, prev2Ctx);
            board2.forEach(e => { (karmaAt[e.user_id] ??= {}).k2 = e.jeff_karma; });
        }
        if (prev3Ctx) {
            const board3 = buildBoard(prev3Ids);
            computeKarma(board3, prev3Ctx);
            board3.forEach(e => { (karmaAt[e.user_id] ??= {}).k3 = e.jeff_karma; });
        }

        const orderedIds = last4.map(m => m.id);
        current.forEach(entry => {
            const uid = entry.user_id;

            const userScores = scoreByUser[uid];
            let scoreImproving = false;
            if (userScores) {
                const scores = orderedIds.map(mid => userScores.find(s => s.mid === mid)?.score);
                if (scores.every(s => s != null)) {
                    scoreImproving = scores[1] > scores[0] && scores[2] > scores[1] && scores[3] > scores[2];
                }
            }

            const kv = karmaAt[uid];
            let karmaImproving = false;
            if (kv && kv.k0 != null && kv.k1 != null && kv.k2 != null && kv.k3 != null) {
                const d1 = kv.k2 - kv.k3;
                const d2 = kv.k1 - kv.k2;
                const d3 = kv.k0 - kv.k1;
                karmaImproving = d3 > d2 && d2 > d1;
            }

            entry.on_fire_score = scoreImproving && entry.trend_score !== 'down';
            entry.on_fire_karma = karmaImproving && entry.trend_karma !== 'down';
            entry.on_fire_wins = (winsCount[uid] || 0) >= 2 && entry.trend_wins !== 'down';
        });
    } else {
        current.forEach(entry => {
            entry.on_fire_score = false;
            entry.on_fire_karma = false;
            entry.on_fire_wins = false;
        });
    }

    return current;
}

// ── Jeff Karma ──

function calculateJeffKarma(userGuesses, mysteriesMap, allGuessesByMystery, cumulativeScores) {
    let karma = 0;
    const scores = [];
    const userId = userGuesses[0]?.user_id;

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
        const isAuto = g.guess?.auto_guess === true;
        const isAutoSubmit = g.guess?.auto_submit === true;

        if (isAuto) {
            const activeDays = Math.round(totalMs / 86400000);
            karma -= 1000 + activeDays;
        } else if (isAutoSubmit) {
            karma += Math.round((500 + Math.min(299, elapsedSec)) * 0.5);
        } else {
            karma += 500 + Math.min(299, elapsedSec);
            karma += 200;

            if (elapsedMs > totalMs * 0.90) {
                const hoursLeft = Math.max(0, Math.floor((rev - sub) / 3600000));
                karma -= 300 + hoursLeft * 5;
            }

            if (elapsedSec < 5) {
                let distPenalty;
                if (m.type === 'time') {
                    let period;
                    if (m.answer?.period_start && m.answer?.period_end) {
                        period = Math.abs(timeToDecimal(m.answer.period_end) - timeToDecimal(m.answer.period_start));
                    } else {
                        period = computeTimePeriod(timeToDecimal(m.answer));
                    }
                    distPenalty = Math.min(999, Math.round(Math.min(1, (g.distance_m ?? 0) / period) * 1000));
                } else {
                    distPenalty = Math.min(999, Math.round((g.distance_m ?? 0) / 1000));
                }
                karma -= 500 + distPenalty;
            }

            // Placement inversion: bottom-half players get x1.5, top-half get x0.7
            const mysteryGuesses = allGuessesByMystery[g.mystery_id];
            if (mysteryGuesses && mysteryGuesses.length > 1) {
                const total = mysteryGuesses.length;
                const rank = mysteryGuesses.filter(x => x.score > g.score).length + 1;
                const basePlacement = 100 * (total - rank);
                const multiplier = rank > total / 2 ? 1.5 : 0.7;
                karma += Math.round(basePlacement * multiplier);
            }

            // Giant killer: bonus for beating higher-ranked players on this mystery
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

        // Beat your own average (from mystery 2 onward)
        if (scores.length >= 2) {
            const priorAvg = scores.slice(0, -1).reduce((a, b) => a + b, 0) / (scores.length - 1);
            if (g.score > priorAvg) {
                karma += 300 + Math.round(g.score - priorAvg);
            } else if (g.score < priorAvg * 0.5) {
                karma -= 200;
            }
        }

        // Trend-based factors (need at least 2 prior scores)
        if (scores.length >= 3) {
            const recent = scores.slice(-3, -1);
            const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
            const current = g.score;

            if (current > avg) {
                karma += 500 + Math.round(current - avg);
            } else if (current < Math.min(...recent)) {
                karma -= 800 + Math.round(avg - current);
            }

            // Bounce-back: scored above median after being in bottom 25%
            const prevScore = scores[scores.length - 2];
            const allScoresSorted = [...scores.slice(0, -1)].sort((a, b) => a - b);
            const p25 = allScoresSorted[Math.floor(allScoresSorted.length * 0.25)];
            const median = allScoresSorted[Math.floor(allScoresSorted.length * 0.5)];
            if (prevScore <= p25 && current > median) {
                karma += 1000 + Math.round(current - prevScore);
            }
        }
    }

    return karma;
}

export async function getMysteryLeaderboard(mysteryId, publishedAt, revealsAt) {
    const guesses = await getGuesses(mysteryId);
    return guesses
        .map(g => {
            const isAuto = g.guess?.auto_guess === true;
            const time = formatTimeAgo(g.submitted_at, publishedAt);
            return {
                user_id: g.user_id,
                name: g.profiles?.name ?? 'Unknown',
                score: g.score,
                distance_m: g.distance_m,
                time,
                guess: g.guess,
                submitted_at: g.submitted_at,
                is_auto: isAuto
            };
        })
        .sort((a, b) => b.score - a.score);
}
