// Business and HTTP errors. Services throw AppError; the error handler turns it into
// RFC 7807 application/problem+json with the codes of API_SPEC §1.1.

export class AppError extends Error {
  /**
   * @param {string} code API_SPEC §1.1 code, e.g. 'rule_violation'
   * @param {number} status HTTP status
   * @param {string} detail human text with the exact numbers
   * @param {{ ruleId?: string, data?: object, errors?: {path: string, message: string}[], cause?: unknown }} [extra]
   */
  constructor(code, status, detail, extra = {}) {
    super(detail, { cause: extra.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.detail = detail;
    this.ruleId = extra.ruleId;
    this.data = extra.data;
    this.errors = extra.errors;
  }
}

export const Errors = {
  validation: (detail, errors) => new AppError('validation_failed', 400, detail, { errors }),
  unauthenticated: (detail = 'Please sign in') => new AppError('unauthenticated', 401, detail),
  forbidden: (detail = 'You do not have permission for this action', data) =>
    new AppError('forbidden', 403, detail, { data }),
  branchForbidden: (brnch) =>
    new AppError('branch_forbidden', 403, `You do not have access to branch ${brnch}`, {
      ruleId: 'BR-BR-04',
    }),
  makerChecker: (detail = 'You cannot approve or verify your own document', ruleId) =>
    new AppError('maker_checker', 403, detail, { ruleId }),
  notFound: (what) => new AppError('not_found', 404, `${what} not found`),
  versionConflict: () =>
    new AppError(
      'version_conflict',
      409,
      'This record was changed by someone else. Reload and try again.',
    ),
  invalidState: (detail, extra) => new AppError('invalid_state', 409, detail, extra),
  duplicate: (detail = 'A record with the same key already exists', extra) =>
    new AppError('duplicate', 409, detail, extra),
  rule: (ruleId, detail, data) => new AppError('rule_violation', 422, detail, { ruleId, data }),
  approvalRequired: (detail, requestId) =>
    new AppError('approval_required', 422, detail, { data: { requestId } }),
  locked: (detail) => new AppError('locked', 423, detail),
};

/** Oracle error number (ORA-xxxxx) of an error, or null. */
export function oraCode(err) {
  if (err && typeof err.errorNum === 'number') return err.errorNum;
  const m = /ORA-(\d{5})/.exec(err?.message ?? '');
  return m ? Number(m[1]) : null;
}
