'use client';

// Admin › Message templates (P2-09): dealer messages per event and channel.
import { MessageSquareText } from 'lucide-react';
import { TextAdmin } from '@/components/admin/text-admin';

export default function TemplatesPage() {
  return (
    <TextAdmin
      kind="templates"
      icon={MessageSquareText}
      title="Message templates"
      subtitle="Dealer messages by SMS, WhatsApp link and e-mail. A branch row replaces the company row for that branch."
      hint="Events: BRV_VERIFIED, DO_ISSUED, PERMIT_ISSUED. Placeholders: {CUSTOMER_NAME}, {AMOUNT}, {BRV_NO}, {BRV_DATE}, {DO_NO}, {QTY}, {PRODUCT}, {OC_NO}, {PERMIT_NO}."
    />
  );
}
