import { describe, it, expect, vi, afterEach } from "vitest"
import { triggerDownload } from "./download"

describe("triggerDownload", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("creates an object URL, clicks a download link named after the file, then revokes the URL", () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:fake-url")
    const revokeObjectURL = vi.fn()
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL })

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})

    const blob = new Blob(["a,b\n1,2\n"], { type: "text/csv" })
    triggerDownload({ blob, filename: "blocked.csv" })

    expect(createObjectURL).toHaveBeenCalledWith(blob)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake-url")

    clickSpy.mockRestore()
  })
})
