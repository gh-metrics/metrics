//Run the actual ESM plugin in Node, while keeping these Jest tests CommonJS.
const {spawnSync} = require("child_process")
const path = require("path")

const runner = `
import {JSDOM} from "jsdom"
import fs from "node:fs"
import plugin from "./source/plugins/community/16personalities/index.mjs"
const options = JSON.parse(fs.readFileSync(0, "utf8"))
const dom = new JSDOM(options.html, {runScripts: "outside-only", url: "https://www.16personalities.com/profiles/fixture"})
Object.defineProperty(dom.window.HTMLElement.prototype, "innerText", {get() { return this.textContent }})
let closed = 0
let waits = 0
let timeout = null
const images = []
const evaluate = (fn, arg) => dom.window.eval("(" + fn.toString() + ")")(arg)
const page = {
  async goto() { if (options.navigationError) throw new Error("navigation failed") },
  async waitForFunction(fn, settings, arg) {
    timeout = settings.timeout
    waits++
    if (!evaluate(fn, arg) && options.hydrated) {
      dom.window.document.body.innerHTML = options.hydrated
      waits++
    }
    if (!evaluate(fn, arg)) {
      const error = new Error("wait timed out")
      error.name = "TimeoutError"
      throw error
    }
    if (options.removeAfterReady)
      dom.window.document.querySelector(options.removeAfterReady)?.remove()
  },
  async evaluate(fn, arg) { return evaluate(fn, arg) },
}
const browser = {
  async version() { return "fixture" },
  async newPage() { if (options.newPageError) throw new Error("new page failed"); return page },
  async close() { closed++; if (options.closeError) throw new Error("close failed") },
}
const imports = {
  metadata: {plugins: {"16personalities": {
    enabled() { return true },
    inputs() { return {url: options.emptyURL ? "" : "https://www.16personalities.com/profiles/fixture", sections: ["personality", "traits"], scores: options.scores ?? true} },
  }}},
  puppeteer: {async launch() { return browser }, events: ["domcontentloaded"]},
  async imgb64(url) { images.push(url); if (options.imageError) throw new Error("image failed"); return "data:image/svg+xml;base64,fixture" },
  format: {error(error) { return error }},
}
console.debug = () => {}
console.warn = () => {}
let result = null
let error = null
try { result = await plugin({login: "fixture", q: {"16personalities": !options.disabled}, imports, data: {}, account: "user"}) }
catch (failure) { error = failure.message ?? failure.error?.message }
console.log(JSON.stringify({result, error, closed, waits, timeout, images}))
dom.window.close()
`

const traits = [
  ["Mind:", "Introverted", "65%", "You prefer quiet moments."],
  ["Energy:", "Intuitive", "72%", "You enjoy possibilities."],
  ["Nature:", "Feeling", "80%", "You value harmony."],
  ["Tactics:", "Prospecting", "60%", "You welcome surprises."],
  ["Identity:", "Turbulent", "55%", "You seek improvement."],
].map(([category, value, score, text], index) => `<div class="traitbox"><div class="traitbox__label">${category}</div><div class="traitbox__value"><span>${score}</span> ${value}</div><div id="trait-desc-${index}"><p>${text}</p></div></div>`).join("")

const profile = name =>
  `<section class="section__wrap" style="background-color: rgb(51, 164, 116)"><span class="code">INFP-T</span>${name}<div class="result__outline"></div><div><a class="sp-button" href="/female-mediator">More</a></div><div id="intro"><div class="content__inner"><div><p>As a Mediator, you are thoughtful. You value your ideals.</p></div></div></div>${traits}</section>`
const currentName = '<div data-testid="typeheader"><h1><span>Your personality is</span><span>Mediator</span></h1></div>'
const legacyName = '<div class="type-info"><div>Personality</div><div>Mediator</div></div>'
const current = profile(currentName)
const legacy = profile(legacyName)
const run = options => {
  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", runner], {
    cwd: path.join(__dirname, ".."),
    input: JSON.stringify({html: current, ...options}),
    encoding: "utf8",
    timeout: 10000,
  })
  if (child.error || child.status !== 0)
    throw child.error ?? new Error(child.stderr)
  return JSON.parse(child.stdout)
}

describe("16personalities profile regression", () => {
  test.each([["current", current], ["legacy", legacy]])("reads %s profile markup from source", (_, html) => {
    const {result, error, closed, timeout, images} = run({html})
    expect(error).toBeNull()
    expect(result.type).toBe("INFP-T")
    expect(result.personality[0].value).toBe("Mediator")
    expect(result.personality[0].text).toBe("Thoughtful.")
    expect(result.color).toBe("rgb(51, 164, 116)")
    expect(result.traits).toHaveLength(5)
    expect(result.traits[0]).toMatchObject({category: "Mind", value: "Introverted", score: 0.65, text: "Prefer quiet moments."})
    expect(images).toEqual(["https://www.16personalities.com/static/images/personality-types/avatars/infp-mediator-female.svg"])
    expect(timeout).toBe(15000)
    expect(closed).toBe(1)
  })

  test("prefers the current name and falls back when it is empty", () => {
    expect(run({html: profile(currentName + legacyName.replace("Mediator", "Old name"))}).result.personality[0].value).toBe("Mediator")
    expect(run({html: profile(currentName.replace("Mediator", " ") + legacyName)}).result.personality[0].value).toBe("Mediator")
  })

  test("waits for hydrated content instead of immediately reading an incomplete document", () => {
    const output = run({html: "<main>Loading profile...</main>", hydrated: current})
    expect(output.error).toBeNull()
    expect(output.waits).toBe(2)
    expect(output.closed).toBe(1)
  })

  test.each([
    ["name", current.replace(currentName, "")],
    ["description", current.replace(/<p>As a Mediator[^<]+<\/p>/, "")],
    ["traits", current.replace(traits, "")],
  ])("reports a bounded readiness error for missing %s", (_, html) => {
    const output = run({html})
    expect(output.error).toContain("did not become ready")
    expect(output.error).toContain("public profile")
    expect(output.timeout).toBe(15000)
    expect(output.closed).toBe(1)
    expect(output.images).toEqual([])
  })

  test.each([
    ["personality type", current.replace("INFP-T", "UNKNOWN")],
    ["personality details", current.replace("/female-mediator", "/mediator")],
    ["trait details", current.replace("65%", "165%")],
    ["trait details", current.replace("You prefer quiet moments.", "")],
  ])("rejects malformed %s before requesting an avatar", (details, html) => {
    const output = run({html})
    expect(output.error).toContain(`Unable to read 16personalities ${details}`)
    expect(output.closed).toBe(1)
    expect(output.images).toEqual([])
  })

  test("validates content removed after readiness without a null dereference", () => {
    const output = run({removeAfterReady: ".section__wrap"})
    expect(output.error).toContain("Unable to read 16personalities")
    expect(output.closed).toBe(1)
  })

  test.each([
    ["navigationError", "navigation failed"],
    ["newPageError", "new page failed"],
    ["imageError", "image failed"],
  ])("closes the browser after %s", (flag, error) => {
    const output = run({[flag]: true})
    expect(output.error).toBe(error)
    expect(output.closed).toBe(1)
  })

  test("cleanup errors do not replace the original error", () => {
    expect(run({navigationError: true, closeError: true}).error).toBe("navigation failed")
  })

  test("disabled plugin or missing URL does not launch a browser", () => {
    expect(run({disabled: true})).toMatchObject({result: null, error: null, closed: 0, waits: 0})
    expect(run({emptyURL: true})).toMatchObject({error: "URL is not set", closed: 0, waits: 0})
  })

  test("keeps the scores option", () => {
    //JSON encodes the intentionally hidden NaN score as null.
    expect(run({scores: false}).result.traits.every(({score}) => score === null)).toBe(true)
  })
})
