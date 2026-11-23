'use client';

// Admin › Print texts (P2): clause and terms texts of prints (never invented by the system).
import { ScrollText } from 'lucide-react';
import { TextAdmin } from '@/components/admin/text-admin';

export default function PrintTextsPage() {
  return (
    <TextAdmin
      kind="print-texts"
      icon={ScrollText}
      title="Print texts"
      subtitle="Clauses and terms printed on the Contract Review Form, DOs and permits. Several paragraphs per text, in order."
      hint="Codes: CRF_DELIVERY_TIME, CRF_PAYMENT, CRF_VALIDITY ({validTo} = contract validity), CRF_PACKING, CRF_ESCALATION, DO_TERMS, PERMIT_TERMS."
    />
  );
}
