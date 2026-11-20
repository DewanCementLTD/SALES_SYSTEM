// Business and HTTP errors. Services throw AppError; the error handler turns it into
// RFC 7807 application/problem+json (API_SPEC §1.1).

export class AppError extends Error {
  /**
   * @param {string} code machine code, e.g. 'INSUFFICIENT_BALANCE'
   * @param {number} status HTTP status
   * @param {string} detail human text with the exact numbers
   * @param {{ ruleId?: string, data?: object, cause?: unknown }} [extra]
   */
  constructor(code, status, detail, extra = {}) {
    super(detail, { cause: extra.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.detail = detail;
    this.ruleId = extra.ruleId;
    this.data = extra.data;
  }
}

export const Errors = {
  notFound: (what) => new AppError('NOT_FOUND', 404, `${what} not found`),
  forbidden: (detail = 'You do not have permission for this action') =>
    new AppError('FORBIDDEN', 403, detail),
  unauthenticated: (detail = 'Please sign in') => new AppError('UNAUTHENTICATED', 401, detail),
  conflict: (detail, extra) => new AppError('CONFLICT', 409, detail, extra),
  staleVersion: () =>
    new AppError(
      'STALE_VERSION',
      409,
      'This record was changed by someone else. Reload and try again.',
    ),
  invalidState: (detail, extra) => new AppError('INVALID_STATE', 409, detail, extra),
  rule: (code, detail, ruleId, data) => new AppError(code, 422, detail, { ruleId, data }),
  validation: (detail, data) => new AppError('VALIDATION', 400, detail, { data }),
};

/** Oracle error number (ORA-xxxxx) of an error, or null. */
export function oraCode(err) {
  if (err && typeof err.errorNum === 'number') return err.errorNum;
  const m = /ORA-(\d{5})/.exec(err?.message ?? '');
  return m ? Number(m[1]) : null;
}
