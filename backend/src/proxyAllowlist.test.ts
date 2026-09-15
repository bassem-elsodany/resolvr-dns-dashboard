import { describe, it, expect } from "vitest";
import { ALLOWED_PATHS, isAllowedPath } from "./proxyAllowlist.js";
import { ENDPOINTS } from "./endpoints.js";

describe("proxyAllowlist", () => {
  it("allows every path defined in the endpoints registry", () => {
    for (const path of Object.values(ENDPOINTS)) {
      expect(isAllowedPath(path)).toBe(true);
    }
  });

  it("contains exactly the endpoints registry's paths, nothing more", () => {
    expect(ALLOWED_PATHS.size).toBe(Object.keys(ENDPOINTS).length);
  });

  it("still rejects a path not in the registry", () => {
    expect(isAllowedPath("/zones/delete")).toBe(false);
  });
});
