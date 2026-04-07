import { supabase } from './supabase.js';

const NAME_REGEX = /^[\p{L}\s.\-']+$/u;
const NAME_MAX_LENGTH = 40;

export function validateName(name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return 'Name cannot be empty';
    if (!/\p{L}/u.test(trimmed)) return 'Name must contain at least one letter';
    if (trimmed.length > NAME_MAX_LENGTH) return `Name cannot exceed ${NAME_MAX_LENGTH} characters`;
    if (!NAME_REGEX.test(trimmed)) return 'Name contains invalid characters';
    return null;
}

const ERROR_MAP = [
    [/invalid login credentials/i, 'Wrong email or password'],
    [/email not confirmed/i, 'Check your email for the confirmation link'],
    [/already registered/i, 'Email already registered'],
    [/password.*at least (\d+)/i, (m) => `Password must be at least ${m[1]} characters`],
    [/validate email/i, 'Please enter a valid email address'],
    [/rate limit|too many requests/i, 'Too many attempts — please wait a moment'],
    [/request this after (\d+) seconds/i, (m) => `Please wait ${m[1]} seconds before trying again`],
    [/network|fetch|failed to fetch/i, 'Connection error — check your internet'],
    [/user not found/i, 'No account found with that email'],
    [/email.*taken/i, 'Email already registered'],
    [/signup.*disabled/i, 'Sign up is currently disabled'],
];

export function friendlyError(err) {
    const msg = typeof err === 'string' ? err : err?.message || '';
    for (const [pattern, replacement] of ERROR_MAP) {
        const match = msg.match(pattern);
        if (match) return typeof replacement === 'function' ? replacement(match) : replacement;
    }
    return msg || 'Something went wrong';
}

export async function signUp(email, password, name) {
    const redirectTo = window.location.origin + '/pages/game.html';
    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
            data: { name },
            emailRedirectTo: redirectTo
        }
    });
    if (error) throw error;
    return data;
}

export async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
    });
    if (error) throw error;
    return data;
}

export async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
}

export async function getSession() {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
}

export async function getProfile() {
    const session = await getSession();
    if (!session) return null;

    const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();

    return data;
}

export async function requireAuth(redirectTo = '/pages/login.html') {
    const session = await getSession();
    if (!session) {
        window.location.href = redirectTo;
        return null;
    }
    return session;
}

export async function redirectIfLoggedIn(redirectTo = '/pages/game.html') {
    const session = await getSession();
    if (session) {
        window.location.href = redirectTo;
    }
}
