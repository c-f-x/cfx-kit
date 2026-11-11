import type { Read } from "../read.ts";

// `notify`: one plain-text mail through a `send_email` binding the caller
// passes in (docs/conventions.md, section 6). The binding's allowlist decides
// who may receive it; the runtime refuses any other address. Ported from the
// send in cfanalytics:apps/watch/src/index.ts. What changed: a refused or
// failed send is in the return value, so the caller decides what it means.
// A tool calls this only from its one `mail.ts` (conventions, section 9).

/** The part of a `send_email` binding that `notify` uses. */
export type MailBinding = {
  send(message: {
    from: { email: string; name: string };
    to: string;
    subject: string;
    text: string;
  }): Promise<{ messageId: string }>;
};

export type PlainMail = {
  /** An address on a domain set up to send, and the name shown with it. */
  from: { email: string; name: string };
  /** One address the binding's allowlist holds. */
  to: string;
  subject: string;
  text: string;
};

/** Sends `mail` through `binding`, and resolves to its message id or the binding's refusal. */
export async function notify(
  binding: MailBinding,
  mail: PlainMail,
): Promise<Read<{ messageId: string }>> {
  try {
    const { messageId } = await binding.send(mail);
    return { ok: true, value: { messageId } };
  } catch (error) {
    return { ok: false, problems: [error instanceof Error ? error.message : String(error)] };
  }
}
