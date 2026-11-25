// Status colours and wording of credit / debit notes (NOTE state machine, BUSINESS_RULES §12).
export const NOTE_TONE = {
  DRAFT: 'info',
  PENDING_APPROVAL: 'warning',
  POSTED: 'success',
  REVERSED: 'neutral',
  CANCELLED: 'neutral',
};
export const noteStatusText = (s) => s.toLowerCase().replace('_', ' ');
