import { writable } from 'svelte/store';

// Retrieve stored language or default to 'id' (Indonesian)
const storedLang = localStorage.getItem('dracin_lang') || 'id';

export const lang = writable(storedLang);

// Subscribe to changes to update localStorage
lang.subscribe((value) => {
    localStorage.setItem('dracin_lang', value);
});
