// Supabase auth wrapper: login, first-time account creation (owner email only, also
// enforced server-side by a trigger), forgot / reset / change password.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm";
import { CONFIG, getConnection } from "./config.js";

let client = null;
export function supabase() {
  if (client) return client;
  const { url, key } = getConnection();
  if (!url || !key) return null;
  client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  return client;
}
export const redirectTo = () => location.origin + location.pathname;

export const auth = {
  async session() { const c = supabase(); if (!c) return null; const { data } = await c.auth.getSession(); return data.session; },
  onChange(fn) { const c = supabase(); return c ? c.auth.onAuthStateChange((ev, s) => fn(ev, s)) : null; },
  async login(email, password) {
    const { data, error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error; return data.session;
  },
  async signup(email, password) {
    if (email.trim().toLowerCase() !== CONFIG.ALLOWED_EMAIL.toLowerCase()) throw new Error("signup_disabled");
    const { data, error } = await supabase().auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: redirectTo() } });
    if (error) throw error; return data;
  },
  async forgot(email) {
    const { error } = await supabase().auth.resetPasswordForEmail(email.trim(), { redirectTo: redirectTo() });
    if (error) throw error;
  },
  async changePassword(password) {
    const { error } = await supabase().auth.updateUser({ password });
    if (error) throw error;
  },
  async logout() { const c = supabase(); if (c) await c.auth.signOut(); },
};

export function arabicError(e) {
  const m = (e && e.message) || String(e);
  if (/invalid login credentials/i.test(m)) return "البريد أو كلمة المرور غير صحيحة";
  if (/email not confirmed/i.test(m)) return "أكّد بريدك أولاً من الرسالة التي وصلتك";
  if (/signup_disabled|not allowed|database error saving new user/i.test(m)) return "إنشاء الحساب مسموح للبريد المصرّح به فقط";
  if (/password should be|at least \d/i.test(m)) return "كلمة المرور قصيرة، 8 أحرف على الأقل";
  if (/rate limit|too many/i.test(m)) return "محاولات كثيرة، انتظر دقيقة ثم أعد";
  if (/failed to fetch|network/i.test(m)) return "لا يوجد اتصال بالإنترنت";
  if (/user already registered/i.test(m)) return "الحساب موجود، سجّل الدخول";
  if (/same.*password|different from the old/i.test(m)) return "كلمة المرور الجديدة مطابقة للقديمة";
  return m;
}
