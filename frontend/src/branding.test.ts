/// <reference types="node" />
import { describe, it, expect } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

// Tests run from the frontend folder, where public/ lives.
const pub = (name: string) => resolve(process.cwd(), "public", name)

describe("browser icons", () => {
  it("are the Resolvr mark, not the Vite template's", () => {
    const svg = readFileSync(pub("favicon.svg"), "utf8")
    expect(svg).toContain("linearGradient")
    expect(svg).toContain("#0064d2") // the app's accent blue
    expect(svg).not.toContain("#863bff") // the template's purple bolt
  })

  it("include a 180px square touch icon for iOS", () => {
    const png = readFileSync(pub("apple-touch-icon.png"))
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a")
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([180, 180])
  })

  it("include a .ico with 16, 32 and 48 pixel images for browsers without SVG icon support", () => {
    const ico = readFileSync(pub("favicon.ico"))
    expect(ico.readUInt16LE(2)).toBe(1) // 1 = icon
    const count = ico.readUInt16LE(4)
    const sizes = Array.from({ length: count }, (_, i) => ico[6 + i * 16]).sort((a, b) => a! - b!)
    expect(sizes).toEqual([16, 32, 48])
  })

  it("leave no unused template files behind in public/", () => {
    expect(existsSync(pub("icons.svg"))).toBe(false)
  })
})
