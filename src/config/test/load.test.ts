import { describe, expect, it } from "vitest";

import { createValidConfig } from "./config.test-utils";

import { CONFIG, loadConfig } from "@/config";

describe("config entry", () => {
  it("rejects invalid config", () => {
    expect(() => loadConfig({})).toThrow();
    expect(() =>
      loadConfig(
        createValidConfig({
          sender: {
            host: "smtp.gmail.com",
            port: 587,
            user: "test",
            email: "not-an-email",
          },
        })
      )
    ).toThrow();
  });

  it("keeps the SMTP password source and country filter", () => {
    const withPass = loadConfig(createValidConfig(), { SMTP_PASS: "from-env" });
    expect(withPass.CONFIG.sender.pass).toBe("from-env");
    expect(withPass.CONFIG.sender.port).toBe(587);
    expect([...withPass.ALLOWED_COUNTRIES]).toEqual(["USA", "Unsure"]);

    const withoutPass = loadConfig(createValidConfig(), {});
    expect(withoutPass.CONFIG.sender.pass).toBe("");

    const open = loadConfig(
      createValidConfig({
        target: {
          countries: [],
        },
      }),
      {}
    );
    expect(open.ALLOWED_COUNTRIES.size).toBe(0);
  });

  it("parses the repo config when the entry is imported", () => {
    expect(CONFIG.sender.host.length).toBeGreaterThan(0);
    expect(CONFIG.sender.port).toBeGreaterThan(0);
    expect(CONFIG.receiver.emails.length).toBeGreaterThan(0);
  });
});
