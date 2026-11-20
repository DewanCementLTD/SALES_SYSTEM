// Zod building blocks shared by the API (validation + OpenAPI) and web forms (React Hook Form).
// Formats per BR-DQ-02 / BR-CUS-05 / BR-GATE-02.
import { z } from 'zod';

const digitsOnly = (s) => String(s).replace(/[\s-]/g, '');

/** Money as string, up to 14 integer digits and 2 decimals (NUMBER(16,2)). */
export const zMoney = z
  .string()
  .trim()
  .regex(/^-?\d{1,14}(\.\d{1,2})?$/, 'Amount must be a number with up to 2 decimals');

/** Non-negative money. */
export const zMoneyPos = zMoney.refine((s) => !s.startsWith('-'), 'Amount cannot be negative');

/** Quantity in tons as string, up to 3 decimals. */
export const zQty = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,3})?$/, 'Quantity must be a number with up to 3 decimals');

export const zBrnch = z.coerce
  .number()
  .int()
  .refine((b) => b === 1 || b === 2, 'Branch must be 1 or 2');

export const zFiscalYear = z.coerce.number().int().min(2000).max(2100);

/** CNIC: 13 digits, dashes/spaces allowed on input, stored as 13 digits. */
export const zCnic = z
  .string()
  .transform(digitsOnly)
  .pipe(z.string().regex(/^\d{13}$/, 'CNIC must have 13 digits'));

/** NTN: 7–8 digits, optional check digit after a dash (e.g. 2876543-1). Stored as typed, without spaces. */
export const zNtn = z
  .string()
  .trim()
  .transform((s) => s.replace(/\s/g, ''))
  .pipe(
    z
      .string()
      .regex(/^\d{7,8}(-\d)?$/, 'NTN must be 7–8 digits, optionally followed by -check digit'),
  );

/** STRN: 13 digits (dashes allowed on input). */
export const zStrn = z
  .string()
  .transform(digitsOnly)
  .pipe(z.string().regex(/^\d{13}$/, 'STRN must have 13 digits'));

/** Mobile: stored as 03XXXXXXXXX. Accepts +92 / 92 / 0 prefixes. */
export const zMobile = z
  .string()
  .transform((s) => {
    const d = digitsOnly(s).replace(/^\+/, '');
    if (/^923\d{9}$/.test(d)) return `0${d.slice(2)}`;
    return d;
  })
  .pipe(z.string().regex(/^03\d{9}$/, 'Mobile must look like 03XXXXXXXXX'));

/** WhatsApp: stored as 92XXXXXXXXXX (BR-CUS-05). */
export const zWhatsapp = z
  .string()
  .transform((s) => {
    const d = digitsOnly(s).replace(/^\+/, '');
    if (/^03\d{9}$/.test(d)) return `92${d.slice(1)}`;
    return d;
  })
  .pipe(z.string().regex(/^923\d{9}$/, 'WhatsApp number must look like 923XXXXXXXXX'));

/** Vehicle number: upper-case, no spaces (BR-GATE-02). */
export const zVehicleNo = z
  .string()
  .transform((s) => s.toUpperCase().replace(/\s+/g, ''))
  .pipe(z.string().regex(/^[A-Z0-9-]{3,20}$/, 'Vehicle number: letters, digits and dashes only'));

/** Reason for cancel/override/manual actions (BR-AUD-02, PRD 4.14: min 10 chars). */
export const zReason = z.string().trim().min(10, 'Reason must be at least 10 characters').max(1000);

/** ISO date `YYYY-MM-DD`. */
export const zIsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

/** Pagination query used by every list endpoint. */
export const zPageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.string().max(60).optional(),
  q: z.string().trim().max(100).optional(),
});

/** Standard list response wrapper. */
export const zPage = (item) =>
  z.object({
    items: z.array(item),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  });
