/**
 * Priority ("Express Rush") print flag.
 *
 * The `orders` table does not expose an `is_priority` column on every
 * deployment yet, and the browser anon key cannot run DDL to add one. The
 * flag is therefore DUAL-WRITTEN on every insert:
 *
 *   1. `is_priority` — a real boolean, sent in the payload so it starts
 *      working the moment the migration lands. While the column is absent,
 *      the established progressive-drop insert loops remove it harmlessly.
 *   2. `print_type = 'PRIORITY'` — the carrier used until then. `print_type`
 *      is a free-text column that exists on `orders` but is never read or
 *      written anywhere in the codebase (every existing row is the 'BW'
 *      column default), so it safely doubles as the express marker. The
 *      alternative candidate, `batch_id`, is a UUID column and rejects text.
 *
 * ALWAYS read through isPriorityRow() so both encodings resolve correctly.
 */

/** Flat express-fee charged to the customer for a priority order (₹). */
export const PRIORITY_FEE = 10;

/** Carrier value stored in orders.print_type while is_priority is missing. */
export const PRIORITY_CARRIER = 'PRIORITY';

/**
 * Payload fragment to spread into an `orders` insert.
 * @param {boolean} isPriority
 */
export function priorityWrite(isPriority) {
  const on = Boolean(isPriority);
  return {
    is_priority: on,
    print_type: on ? PRIORITY_CARRIER : 'BW',
  };
}

/**
 * Read the flag from any orders/print_jobs-shaped row.
 * Accepts boolean, string ('true'/'false') and the print_type carrier.
 * @param {object|null|undefined} row
 * @returns {boolean}
 */
export function isPriorityRow(row) {
  if (!row || typeof row !== 'object') return false;
  const direct = row.is_priority;
  if (typeof direct === 'boolean') return direct;
  if (direct != null) return direct === true || String(direct).toLowerCase() === 'true';
  return String(row.print_type || '').toUpperCase() === PRIORITY_CARRIER;
}
