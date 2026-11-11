// The one result shape of the kit: a value, or the problems that kept it from
// being made. Shared by the checks and the Worker helpers, so it imports nothing.

/** A value, or the problems that kept it from being read or made. */
export type Read<T> = { ok: true; value: T } | { ok: false; problems: string[] };
