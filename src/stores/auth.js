import { writable } from 'svelte/store';

export const user = writable(null);
export const isAuthenticated = writable(false);

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
    }
}

export async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    user.set(null);
    isAuthenticated.set(false);
}
