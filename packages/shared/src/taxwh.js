// Tax withheld by customers (TASKS P4-05, SCHEMA TAX_WITHHELD): income tax (IT) or sales tax (ST)
// a customer deducted when paying, and the tax certificates received against it (R12 block 7).
import { z } from 'zod';
import { dec } from './money.js';
import { zIsoDate } from './validators.js';

const zPos = z
  .string()
  .trim()
  .regex(/^\d{1,14}(\.\d{1,2})?$/, 'Amount must be a number with up to 2 decimals')
  .refine((s) => dec(s).gt(0), 'Amount must be more than 0');

export const TAX_KINDS = Object.freeze({ IT: 'Income tax', ST: 'Sales tax' });

export const zTaxWithheldCreate = z.object({
  customerCode: z.string().trim().min(1, 'Choose the customer').max(11),
  taxKind: z.enum(['IT', 'ST']),
  date: zIsoDate,
  amount: zPos,
  docType: z
    .string()
    .trim()
    .regex(/^[A-Z]{2,10}$/, 'Document type in capitals, e.g. BRV')
    .nullable()
    .optional(),
  docNo: z.string().trim().max(30).nullable().optional(),
  remarks: z.string().trim().max(400).nullable().optional(),
});

export const zTaxCertificate = z.object({
  amount: zPos,
  remarks: z.string().trim().max(400).nullable().optional(),
});
