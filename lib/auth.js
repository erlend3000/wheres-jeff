import { supabase } from './supabase.js';

const NAME_REGEX = /^[\p{L}\s.\-']+$/u;
const NAME_MAX_LENGTH = 40;

export function validateName(name) {
    const trimmed = (name || '').trim();
    if (!trimmed) return 'Name cannot be empty';
    if (trimmed.length > NAME_MAX_LENGTH) return `Name cannot exceed ${NAME_MAX_LENGTH} characters`;
    if (!NAME_REGEX.test(trimmed)) return 'Name can only contain letters, spaces, hyphens, apostrophes and periods';
    if (!/\p{L}/u.test(trimmed)) return 'Name must contain at least one letter';
    return null;
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
