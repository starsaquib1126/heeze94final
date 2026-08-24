/**
 * Extracts a human-readable message from an API error response.
 *
 * FastAPI returns errors in two different shapes depending on the
 * failure type, and code that assumes only one of them will crash on
 * the other:
 *   - A custom HTTPException (e.g. `raise HTTPException(400, "some
 *     message")`) → `detail` is a plain string.
 *   - A request validation failure (missing/malformed field, caught by
 *     FastAPI itself before the endpoint even runs) → `detail` is an
 *     ARRAY of objects like `{type, loc, msg, input}`.
 *
 * Rendering that array directly in JSX (`{err.response.data.detail}`)
 * throws React error #31 ("Objects are not valid as a React child") —
 * this is the exact bug that caused a blank screen when creating an HR
 * user without realizing `tenant_id` was a required field. Every place
 * that reads an API error's message should go through this function
 * instead of accessing `.detail` directly.
 */
export function getErrorMessage(err: any, fallback: string): string {
  const detail = err?.response?.data?.detail

  if (typeof detail === 'string') {
    return detail
  }

  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && 'msg' in item) {
          const field = Array.isArray(item.loc) ? item.loc[item.loc.length - 1] : undefined
          return field ? `${field}: ${item.msg}` : String(item.msg)
        }
        return null
      })
      .filter(Boolean)
    if (messages.length) return messages.join('; ')
  }

  return fallback
}
