import { writable } from 'svelte/store';

export const user = writable(null);
export const isAuthenticated = writable(false);

// Set to true once the initial /api/auth/me round-trip has returned. Pages
// that want to redirect unauthenticated users to /login should wait for this
// flag to flip true before deciding, otherwise they will redirect on first
// render before the cookie-based session has been verified.
export const authReady = writable(false);

export async function checkAuth() {
    try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
            const data = await res.json();
            user.set(data.user);
            isAuthenticated.set(true);
        } else {
            user.set(null);
            isAuthenticated.set(false);
        }
    } catch (error) {
        user.set(null);
        isAuthenticated.set(false);
    } finally {
        authReady.set(true);
    }
}


export async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    user.set(null);
    isAuthenticated.set(false);
}
