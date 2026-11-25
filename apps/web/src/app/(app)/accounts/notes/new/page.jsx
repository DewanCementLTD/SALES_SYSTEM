'use client';

// Accounts › Credit / debit notes › New (TASKS P4-01).
import { FileMinus2 } from 'lucide-react';
import { NoteForm } from '@/components/accounts/note-form';
import { PageHeader } from '@/components/common/page';

export default function NewNotePage() {
  return (
    <>
      <PageHeader
        icon={FileMinus2}
        title="New credit / debit note"
        subtitle="Saved as a draft with its number; submit it for approval from the note screen."
        crumbs={[
          { label: 'Accounts' },
          { label: 'Credit / debit notes', href: '/accounts/notes' },
          { label: 'New' },
        ]}
      />
      <NoteForm />
    </>
  );
}
