// WhatsApp click-to-chat (ARCHITECTURE §1, BR-NTF-01, TASKS P2-09). No WhatsApp API is used: the
// worker builds the wa.me link with the message; staff open it from the outbox / document screen
// and press send in WhatsApp.

/** Pakistani mobile → international digits for wa.me: 03001234567 → 923001234567. */
export function waNumber(mobile) {
  const d = String(mobile ?? '').replace(/\D/g, '');
  if (/^03\d{9}$/.test(d)) return `92${d.slice(1)}`;
  if (/^923\d{9}$/.test(d)) return d;
  if (/^3\d{9}$/.test(d)) return `92${d}`;
  return null;
}

/** https://wa.me/923001234567?text=… (null when the number is not a mobile number). */
export function waLink(mobile, text) {
  const n = waNumber(mobile);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}
