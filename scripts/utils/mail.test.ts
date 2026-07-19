import { beforeEach, describe, expect, it, vi } from "vitest";

const { createTransport } = vi.hoisted(() => ({
  createTransport: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: { createTransport },
}));

import { createSMTPTransport } from "./mail";

const smtpConfig = {
  host: "smtp.example.com",
  port: 465,
  user: "sender",
  pass: "secret",
};

describe("createSMTPTransport", () => {
  beforeEach(() => {
    createTransport.mockReset();
  });

  it("creates an unpooled transport by default", () => {
    createSMTPTransport(smtpConfig);

    expect(createTransport).toHaveBeenCalledWith({
      host: "smtp.example.com",
      port: 465,
      secure: true,
      auth: {
        user: "sender",
        pass: "secret",
      },
    });
  });

  it("adds the notification pool settings when requested", () => {
    createSMTPTransport({ ...smtpConfig, port: 587 }, { pooled: true });

    expect(createTransport).toHaveBeenCalledWith({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      auth: {
        user: "sender",
        pass: "secret",
      },
      pool: true,
      maxConnections: 1,
      maxMessages: Infinity,
    });
  });
});
