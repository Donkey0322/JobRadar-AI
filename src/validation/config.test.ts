import { describe, expect, it } from "vitest";

import { ConfigSchema, JobCategory } from "./config";
import { createValidConfig } from "./config.test-utils";

describe("ConfigSchema", () => {
  it("should pass with valid USA filter", () => {
    const config = createValidConfig();
    config.target = {
      ...config.target,
      "full-time": [JobCategory.ENTRY_LEVEL],
      filter: {
        USA: {
          allow_citizenship_required: false,
          allow_no_sponsorship: false,
        },
      },
    };

    const result = ConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
  });

  it("should fail if filter countries does not exist in target.countries", () => {
    const config = createValidConfig();
    config.target = {
      intern: [JobCategory.SUMMER_INTERN],
      countries: ["Canada"],
      filter: {
        USA: {
          allow_citizenship_required: false,
        },
      },
    };

    const result = ConfigSchema.safeParse(config);

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain(
        '"USA" filter requires "USA" to exist in target.countries'
      );
    }
  });

  it("should fail if sender email is invalid", () => {
    const config = createValidConfig();
    config.sender.email = "invalid-email";

    const result = ConfigSchema.safeParse(config);

    expect(result.success).toBe(false);
  });

  it("should fail if countries is missing", () => {
    const config = createValidConfig();
    Reflect.deleteProperty(config.target, "countries");

    const result = ConfigSchema.safeParse(config);

    expect(result.success).toBe(false);
  });

  it("should fail if port is invalid", () => {
    const config = createValidConfig();
    config.sender.port = 99999;

    const result = ConfigSchema.safeParse(config);

    expect(result.success).toBe(false);
  });

  it("should allow config without filter", () => {
    const result = ConfigSchema.safeParse(createValidConfig());

    expect(result.success).toBe(true);
  });
});
