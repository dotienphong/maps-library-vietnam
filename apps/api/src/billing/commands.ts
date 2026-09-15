import type { EntitlementCommand } from './types';

const MAX_COMMAND_BYTES = 16 * 1024;
const COMMON = ['operationId', 'tenantId', 'actor', 'reason', 'expectedRevision', 'kind'];
const FIELDS: Record<EntitlementCommand['kind'], string[]> = {
  activateTrial: [...COMMON, 'startsAt'],
  grantPeriod: [
    ...COMMON,
    'periodId',
    'tier',
    'startsAt',
    'endsAt',
    'paymentReference',
    'lineItemId',
  ],
  addCredits: [...COMMON, 'periodId', 'group', 'packs', 'paymentReference', 'lineItemId'],
  suspend: COMMON,
  resume: COMMON,
};

export class BillingCommandError extends Error {}

const isText = (value: unknown, max = 512): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const isDate = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));

export function validateCommand(input: EntitlementCommand): void {
  const bytes = new TextEncoder().encode(JSON.stringify(input)).byteLength;
  if (bytes > MAX_COMMAND_BYTES) throw new BillingCommandError('payload_too_large');
  if (!input || typeof input !== 'object' || !(input.kind in FIELDS)) {
    throw new BillingCommandError('invalid_command');
  }
  const allowed = new Set(FIELDS[input.kind]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new BillingCommandError('invalid_command');
  }
  if (
    !isText(input.operationId) ||
    !isText(input.tenantId) ||
    !isText(input.actor) ||
    !isText(input.reason, 4_096) ||
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 0
  ) {
    throw new BillingCommandError('invalid_command');
  }
  if (input.kind === 'activateTrial' && !isDate(input.startsAt)) {
    throw new BillingCommandError('invalid_command');
  }
  if (input.kind === 'grantPeriod') {
    if (
      !isText(input.periodId) ||
      !['starter', 'professional', 'business'].includes(input.tier) ||
      !isDate(input.startsAt) ||
      !isDate(input.endsAt) ||
      Date.parse(input.startsAt) >= Date.parse(input.endsAt) ||
      !isText(input.paymentReference) ||
      !isText(input.lineItemId)
    ) {
      throw new BillingCommandError('invalid_command');
    }
  }
  if (input.kind === 'addCredits') {
    if (
      !isText(input.periodId) ||
      !['places', 'directions'].includes(input.group) ||
      !Number.isSafeInteger(input.packs) ||
      input.packs <= 0 ||
      input.packs > Math.floor(Number.MAX_SAFE_INTEGER / 1_000) ||
      !isText(input.paymentReference) ||
      !isText(input.lineItemId)
    ) {
      throw new BillingCommandError('invalid_command');
    }
  }
}

export async function commandHash(command: EntitlementCommand): Promise<string> {
  return sha256(JSON.stringify(command));
}

export async function businessHash(command: EntitlementCommand): Promise<string | null> {
  if (command.kind === 'grantPeriod') {
    return sha256(
      JSON.stringify({
        kind: command.kind,
        tenantId: command.tenantId,
        periodId: command.periodId,
        tier: command.tier,
        startsAt: command.startsAt,
        endsAt: command.endsAt,
        paymentReference: command.paymentReference,
        lineItemId: command.lineItemId,
      }),
    );
  }
  if (command.kind === 'addCredits') {
    return sha256(
      JSON.stringify({
        kind: command.kind,
        tenantId: command.tenantId,
        periodId: command.periodId,
        group: command.group,
        packs: command.packs,
        paymentReference: command.paymentReference,
        lineItemId: command.lineItemId,
      }),
    );
  }
  return null;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
