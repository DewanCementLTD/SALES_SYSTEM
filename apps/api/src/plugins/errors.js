// RFC 7807 problem+json for every error (API_SPEC §1, §1.1).
import fp from 'fastify-plugin';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { AppError } from '../lib/errors.js';

const TITLES = {
  validation_failed: 'Invalid input',
  unauthenticated: 'Not signed in',
  forbidden: 'Not allowed',
  branch_forbidden: 'Branch not allowed',
  maker_checker: 'Maker-checker',
  password_change_required: 'Password change required',
  not_found: 'Not found',
  version_conflict: 'Changed by someone else',
  invalid_state: 'Not allowed in this state',
  duplicate: 'Already exists',
  rule_violation: 'Business rule',
  approval_required: 'Approval required',
  locked: 'Locked',
  rate_limited: 'Too many requests',
  internal_error: 'Unexpected error',
};

function send(reply, status, code, detail, extra = {}) {
  const body = {
    type: `about:blank#${code}`,
    title: TITLES[code] ?? code,
    status,
    code,
    detail,
    ...extra,
    requestId: reply.request.id,
  };
  return reply.status(status).type('application/problem+json').send(body);
}

export default fp(async (app) => {
  app.setErrorHandler((err, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      const errors = err.validation.map((v) => ({
        path: [err.validationContext, ...(v.instancePath ?? '').split('/').filter(Boolean)].join(
          '.',
        ),
        message: v.message,
      }));
      return send(reply, 400, 'validation_failed', 'Some fields are not valid', { errors });
    }
    if (err instanceof AppError) {
      const extra = {};
      if (err.ruleId) extra.ruleId = err.ruleId;
      if (err.data) extra.data = err.data;
      if (err.errors) extra.errors = err.errors;
      if (err.status >= 500) request.log.error({ err }, err.detail);
      return send(reply, err.status, err.code, err.detail, extra);
    }
    if (err.statusCode === 429) {
      return send(reply, 429, 'rate_limited', 'Too many requests. Try again shortly.');
    }
    if (isResponseSerializationError(err)) {
      request.log.error({ err, issues: err.cause?.issues }, 'response does not match schema');
      return send(reply, 500, 'internal_error', 'Unexpected error');
    }
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return send(reply, err.statusCode, 'validation_failed', err.message);
    }
    request.log.error({ err }, 'unhandled error');
    return send(
      reply,
      500,
      'internal_error',
      'Unexpected error. The administrator can find details by request id.',
    );
  });

  app.setNotFoundHandler((request, reply) =>
    send(reply, 404, 'not_found', `No route ${request.method} ${request.url.split('?')[0]}`),
  );
});
