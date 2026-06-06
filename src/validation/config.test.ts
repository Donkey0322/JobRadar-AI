import { describe, expect, it } from "vitest";

import { ConfigSchema } from "./config";

describe("ConfigSchema", () => {
  it("should pass with valid USA filter", () => {
    const result = ConfigSchema.safeParse({
      target: {
        intern: ["summer intern"],
        "full-time": ["entry level"],
        countries: ["USA"],
        filter: {
          USA: {
            allow_citizenship_required: false,
            allow_no_sponsorship: false,
          },
        },
      },

      ai: {
        provider: "openai",
        model: "gpt-4o",
      },

      sender: {
        host: "smtp.gmail.com",
        port: 587,
        user: "test",
        email: "test@example.com",
      },

      receiver: {
        email: "receiver@example.com",
      },
    });

    expect(result.success).toBe(true);
  });

  it("should fail if filter countries does not exist in target.countries", () => {
    const result = ConfigSchema.safeParse({
      target: {
        intern: ["summer intern"],

        countries: ["Canada"],

        filter: {
          USA: {
            allow_citizenship_required: false,
          },
        },
      },

      sender: {
        host: "smtp.gmail.com",
        port: 587,
        user: "test",
        email: "test@example.com",
      },

      receiver: {
        email: "receiver@example.com",
      },
    });

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain(
        '"USA" filter requires "USA" to exist in target.countries'
      );
    }
  });

  it("should fail if sender email is invalid", () => {
    const result = ConfigSchema.safeParse({
      target: {
        intern: ["summer intern"],

        countries: ["USA"],
      },

      sender: {
        host: "smtp.gmail.com",
        port: 587,
        user: "test",
        email: "invalid-email",
      },

      receiver: {
        email: "receiver@example.com",
      },
    });

    expect(result.success).toBe(false);
  });

  it("should fail if countries is missing", () => {
    const result = ConfigSchema.safeParse({
      target: {
        intern: ["summer intern"],
      },

      sender: {
        host: "smtp.gmail.com",
        port: 587,
        user: "test",
        email: "test@example.com",
      },

      receiver: {
        email: "receiver@example.com",
      },
    });

    expect(result.success).toBe(false);
  });

  it("should fail if port is invalid", () => {
    const result = ConfigSchema.safeParse({
      target: {
        intern: ["summer intern"],

        countries: ["USA"],
      },

      sender: {
        host: "smtp.gmail.com",
        port: 99999,
        user: "test",
        email: "test@example.com",
      },

      receiver: {
        email: "receiver@example.com",
      },
    });

    expect(result.success).toBe(false);
  });

  it("should allow config without filter", () => {
    const result = ConfigSchema.safeParse({
      target: {
        intern: ["summer intern"],
        countries: ["USA"],
      },

      ai: {
        provider: "openai",
        model: "gpt-4o",
      },

      sender: {
        host: "smtp.gmail.com",
        port: 587,
        user: "test",
        email: "test@example.com",
      },

      receiver: {
        email: "receiver@example.com",
      },
    });

    expect(result.success).toBe(true);
  });
});
