'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase, isSupabaseConfigured } from './supabaseClient';

/** Role-Based Access Control for PrintX. ... (existing doc kept verbatim) ... */
export const ROLES = { OWNER: 'owner', STAFF: 'staff' };
export const OWNER_ONLY_ROUTES = ['/analytics', '/billing', '/printers', '/settings'];
const ROLE_KEY = 'printx_user_role';
const STAFF_PIN_KEY_PREFIX = 'printx_staff_pin_';

function getStoredRole() {
  if (typeof window === 'undefined') return ROLES.OWNER;
  try { return localStorage.getItem(ROLE_KEY) || ROLES.OWNER; } catch { return ROLES.OWNER; }
}
function setStoredRole(role) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(ROLE_KEY, role); } catch { /* noop */ }
}
function getStoredStaffPin(shopId) {
  if (typeof window === 'undefined') return null;
  try { return localStorage.getItem(`${STAFF_PIN_KEY_PREFIX}${shopId}`); } catch { return null; }
}
function setStoredStaffPin(shopId, pin) {
  if (typeof window === 'undefined') return;
  try {
    if (pin) localStorage.setItem(`${STAFF_PIN_KEY_PREFIX}${shopId}`, pin);
    else localStorage.removeItem(`${STAFF_PIN_KEY_PREFIX}${shopId}`);
  } catch { /* noop */ }
}

const AuthContext = createContext({
  role: ROLES.OWNER, isOwner: true, isStaff: false, shopId: null,
  setRole: () => {}, verifyStaffPin: () => false, setStaffPin: () => {}, logoutStaff: () => {}, loading: false,
});

export function AuthProvider({ children, shopId = null }) {
  const [role, setRoleState] = useState(ROLES.OWNER);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isSupabaseConfigured && supabase) {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (cancelled || !user || !shopId) { setRoleState(getStoredRole()); }
          else {
            const { data: member } = await supabase.from('shops_members').select('role').eq('user_id', user.id).eq('shop_id', shopId).single();
            if (!cancelled && member?.role) setRoleState(member.role); else setRoleState(getStoredRole());
          }
        } catch { setRoleState(getStoredRole()); }
      } else { setRoleState(getStoredRole()); }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [shopId]);

  const setRole = useCallback((newRole) => {
    setRoleState(newRole); setStoredRole(newRole);
    if (isSupabaseConfigured && supabase) {
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (user) supabase.from('shops_members').upsert({ user_id: user.id, shop_id: shopId, role: newRole }, { onConflict: 'user_id,shop_id' });
      });
    }
  }, [shopId]);

  const verifyStaffPin = useCallback((enteredPin) => {
    const storedPin = getStoredStaffPin(shopId);
    if (!storedPin) return false;
    if (enteredPin === storedPin) { setRoleState(ROLES.STAFF); setStoredRole(ROLES.STAFF); return true; }
    return false;
  }, [shopId]);

  /* ---- Set staff PIN (owner only) — persists to Supabase so it survives refresh. ---- */
  const setStaffPin = useCallback(async (pin) => {
    setStoredStaffPin(shopId, pin);
    if (isSupabaseConfigured && supabase) {
      try {
        const targetId = shopId && /^[0-9a-f]{36}$/i.test(shopId) ? shopId : null;
        const body = { staff_pin: pin };
        let res;
        if (targetId) {
          res = await supabase.from('shops').update(body).eq('id', targetId).select('id').single();
        } else {
          res = await supabase.from('shops').upsert(body, { onConflict: 'slug' }).select('slug').single();
        }
        if (res.error) console.error('[auth] staff_pin save failed:', res.error.message);
      } catch (err) { console.error('[auth] staff_pin save threw:', err?.message || err); }
    }
  }, [shopId]);

  const logoutStaff = useCallback(() => { setRoleState(ROLES.OWNER); setStoredRole(ROLES.OWNER); }, []);

  const value = useMemo(() => ({ role, isOwner: role === ROLES.OWNER, isStaff: role === ROLES.STAFF, shopId, setRole, verifyStaffPin, setStaffPin, logoutStaff, loading }),
    [role, shopId, setRole, verifyStaffPin, setStaffPin, logoutStaff, loading]);

  return (<AuthContext.Provider value={value}>{children}</AuthContext.Provider>);
}

export function useUserRole() { return useContext(AuthContext); }

export async function getUserRole(userId, shopId) {
  if (!isSupabaseConfigured || !supabase) return ROLES.OWNER;
  try {
    const { data, error } = await supabase.from('shops_members').select('role').eq('user_id', userId).eq('shop_id', shopId).single();
    if (error || !data) return ROLES.OWNER;
    return data.role || ROLES.OWNER;
  } catch { return ROLES.OWNER; }
}

export function isRestrictedPath(pathname, basePath = '/vendor/dashboard') {
  const relative = pathname.replace(basePath, '');
  return OWNER_ONLY_ROUTES.some((route) => relative.startsWith(route));
}

export function StaffPinLogin({ shopId, onSuccess }) {
  const [pin, setPin] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const { verifyStaffPin } = useUserRole();
  const handleSubmit = (e) => {
    e.preventDefault(); setError('');
    if (pin.length !== 4) { setError('PIN must be 4 digits'); return; }
    setLoading(true);
    setTimeout(() => { const ok = verifyStaffPin(pin); if (ok) onSuccess?.(); else setError('Invalid PIN — ask the shop owner'); setLoading(false); }, 400);
  };
  return (
    <div className="min-h-screen bg-[#0B132B] flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl bg-[#1E293B] border border-[#1E2D4A] p-6 text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mb-4"><span className="text-2xl">🔐</span></div>
        <h2 className="text-lg font-black text-white">Staff Access</h2>
        <p className="text-xs text-slate-400 mt-1">Enter the 4-digit PIN to access the print queue</p>
        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div className="flex justify-center gap-2">{[0,1,2,3].map((i) => (
            <input key={i} type="password" inputMode="numeric" maxLength={1} value={pin[i] || ''}
              onChange={(e) => { const val = e.target.value.replace(/\D/g,''); const newPin = pin.slice(0,i)+val+pin.slice(i+1); setPin(newPin.slice(0,4)); if (val && e.target.nextElementSibling) e.target.nextElementSibling.focus(); }}
              onKeyDown={(e) => { if (e.key==='Backspace' && !pin[i] && e.target.previousElementSibling) e.target.previousElementSibling.focus(); }}
              className="w-12 h-14 rounded-xl bg-[#0B132B] border border-[#1E2D4A] text-center text-xl font-black text-white focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20 transition-colors" autoFocus={i===0} />
          ))}</div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button type="submit" disabled={loading || pin.length!==4}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-all">
            {loading ? 'Verifying...' : 'Access Queue'}
          </button>
        </form>
      </div>
    </div>
  );
}
