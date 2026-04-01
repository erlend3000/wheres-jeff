import { supabase } from './supabase.js';

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
