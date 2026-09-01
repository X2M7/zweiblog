import { describe, expect, it } from "vitest";

import { formatFooterCopyright } from "../components/Footer";

const since = "2024-01-01T00:00:00.000Z";
const now = new Date("2026-09-01T00:00:00.000Z");

describe("footer copyright", () => {
  it("appends the configured copyright agreement after the year range", () => {
    expect(formatFooterCopyright(since, "  Xumin Liang  ", now)).toBe(
      "© 2024 - 2026 Xumin Liang",
    );
  });

  it("does not leave trailing separator text for an empty agreement", () => {
    expect(formatFooterCopyright(since, "   ", now)).toBe("© 2024 - 2026");
  });
});
