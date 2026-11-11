import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import { notify } from "../src/worker/index.ts";

// `notify` sends one plain-text mail through the send_email binding the caller
// passes in (docs/conventions.md, section 6). MAIL is a real local send_email
// binding whose allowlist holds owner@example.com and team@example.com
// (vitest.config.ts), so the runtime itself refuses any other address.

const from = { email: "alerts@example.com", name: "cfx-sample" };

describe("notify", () => {
  test("sends to an address the binding's allowlist holds", async () => {
    const sent = await notify(env.MAIL, {
      from,
      to: "owner@example.com",
      subject: "cfx-sample: 1 down",
      text: "api: down since 10:00\n",
    });
    expect(sent).toEqual({ ok: true, value: { messageId: expect.any(String) } });
  });

  test("answers the binding's refusal for an address outside the allowlist, and never throws", async () => {
    const sent = await notify(env.MAIL, {
      from,
      to: "someone@example.org",
      subject: "cfx-sample: 1 down",
      text: "api: down since 10:00\n",
    });
    expect(sent).toEqual({
      ok: false,
      problems: [expect.stringMatching(/someone@example\.org not allowed/)],
    });
  });
});
