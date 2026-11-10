import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

const preferenceKey = 'kontroll-remember';
export function setRememberSession(remember) {
  localStorage.setItem(preferenceKey, remember ? '1' : '0');
}
const sessionStorageAdapter = {
  getItem(key) { return (localStorage.getItem(preferenceKey) !== '0' ? localStorage : sessionStorage).getItem(key); },
  setItem(key, value) {
    const persistent = localStorage.getItem(preferenceKey) !== '0';
    (persistent ? localStorage : sessionStorage).setItem(key, value);
    (persistent ? sessionStorage : localStorage).removeItem(key);
  },
  removeItem(key) { localStorage.removeItem(key); sessionStorage.removeItem(key); },
};

export const isSupabaseConfigured = Boolean(url && publishableKey);
export const supabase = isSupabaseConfigured
  ? createClient(url, publishableKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        storage: sessionStorageAdapter,
        detectSessionInUrl: true,
      },
    })
  : null;

