/**
 * Fail-closed assertion helpers.
 *
 * A "fail-closed" system is one that denies access when it cannot prove the
 * access is legitimate (no tenant context, missing permission row, unknown
 * module, ...). These helpers make those guarantees explicit and reusable
 * across the test suites.
 */

/**
 * Asserts that a guarded operation rejects rather than resolves.
 *
 * Works for both promise rejections and synchronous throws.
 */
export async function expectDenied(
  operation: () => Promise<unknown> | unknown,
  message = 'expected the operation to be denied',
): Promise<void> {
  let denied = false;
  let reason: unknown;

  try {
    await operation();
  } catch (error) {
    denied = true;
    reason = error;
  }

  if (!denied) {
    throw new Error(message);
  }

  return reason as never;
}

/**
 * Asserts that a guarded operation resolves (i.e. access is allowed).
 */
export async function expectAllowed<T>(
  operation: () => Promise<T> | T,
  message = 'expected the operation to be allowed',
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new Error(
      `${message} but it was rejected with: ${(error as Error)?.message}`,
    );
  }
}

/**
 * Asserts that a collection contains no rows belonging to a foreign tenant.
 */
export function expectNoForeignRows<T extends { tenantId?: string | null }>(
  rows: T[],
  tenantId: string,
  message = 'expected zero rows from another tenant',
): void {
  const foreign = rows.filter(
    (row) => row.tenantId && row.tenantId !== tenantId,
  );
  if (foreign.length > 0) {
    throw new Error(
      `${message} — found ${foreign.length} row(s) outside tenant ${tenantId}`,
    );
  }
}
