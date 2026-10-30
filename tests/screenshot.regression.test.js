const {execFileSync} = require("child_process")

const setup = `
  import assert from "node:assert/strict"
  import vm from "node:vm"
  import {JSDOM} from "jsdom"
  import plugin from "./source/plugins/community/screenshot/index.mjs"
  import {diagnosticUrl, prepareImages} from "./source/plugins/community/screenshot/images.mjs"
  function fixture(html, height = 6000) {
    const dom = new JSDOM(html, {url: "https://example.test/", runScripts: "outside-only"})
    const {window} = dom
    window.innerWidth = 1920
    window.innerHeight = 1080
    Object.defineProperty(window.document.documentElement, "scrollHeight", {value: height})
    const element = window.document.querySelector("#target")
    element.getBoundingClientRect = () => ({top: -window.scrollY, bottom: height - window.scrollY})
    const scrolls = []
    window.scrollTo = ({top}) => {
      window.scrollY = Math.min(top, height - window.innerHeight)
      scrolls.push(window.scrollY)
      window.dispatchEvent(new window.Event("scroll"))
    }
    window.scrollBy = ({top}) => window.scrollTo({top: top + window.scrollY})
    const page = {evaluate: (fn, arg) => vm.runInContext("(" + fn.toString() + ")(" + JSON.stringify(arg) + ")", dom.getInternalVMContext())}
    return {window, element, page, scrolls}
  }
  function imageState(img, {complete = false, width = 0, decode = async () => {}} = {}) {
    const state = {complete, width}
    Object.defineProperty(img, "complete", {get: () => state.complete})
    Object.defineProperty(img, "naturalWidth", {get: () => state.width})
    img.decode = decode
    return state
  }
`

const check = code => void execFileSync(process.execPath, ["--input-type=module", "--eval", setup + code], {cwd: require("path").join(__dirname, ".."), timeout: 10000, stdio: "pipe"})

test("cold 1920x1080 DOM fixture progressively loads and decodes all eight slow covers without rewriting signed URLs", () =>
  check(`
  const fixtureImages = Array.from({length: 8}, (_, i) => '<img loading="lazy" data-y="' + i * 700 + '" src="https://cdn.test/cover' + i + '.png?signature=secret-' + i + '">').join("")
  const {window, element, page, scrolls} = fixture('<section id="target">' + fixtureImages + '</section>')
  let decoded = 0
  const images = [...element.querySelectorAll("img")]
  const sources = images.map(img => img.src)
  images.forEach(img => {
    const state = imageState(img, {decode: async () => { await new Promise(resolve => setTimeout(resolve, 20)); decoded++ }})
    let requested = false
    window.addEventListener("scroll", () => {
      if (!requested && Number(img.dataset.y) < window.scrollY + window.innerHeight) {
        requested = true
        setTimeout(() => {
          state.complete = true
          state.width = 320
          img.dispatchEvent(new window.Event("load"))
        }, 30)
      }
    })
  })
  const report = await prepareImages(page, "#target", {timeout: 2000, interval: 5})
  assert.equal(report.total, 8)
  assert.equal(report.loaded, 8)
  assert.equal(report.unresolved, 0)
  assert.equal(report.scrollComplete, true)
  assert.equal(decoded, 8)
  assert.ok(scrolls.length > 10)
  assert.deepEqual(images.map(img => img.src), sources)
  assert.ok(images.every(img => img.loading === "eager"))
`))

test("complete broken images and load errors are failures, not successful readiness", () =>
  check(`
  const {window, element, page} = fixture('<div id="target"><img src="https://cdn.test/broken?token=secret"><img src="https://cdn.test/error?token=secret"></div>', 1000)
  const [broken, failed] = element.querySelectorAll("img")
  imageState(broken, {complete: true})
  imageState(failed)
  setTimeout(() => failed.dispatchEvent(new window.Event("error")), 50)
  const report = await prepareImages(page, "#target", {timeout: 500, interval: 5})
  assert.equal(report.loaded, 0)
  assert.equal(report.unresolved, 2)
  assert.ok(report.diagnostics.every(item => item.status === "failed"))
  assert.ok(!JSON.stringify(report).includes("secret"))
`))

test("never-loading images and stalled decode share a bounded deadline", () =>
  check(`
  const {element, page} = fixture('<div id="target"><img src="/pending"><img src="/decode"></div>', 1000)
  const [pending, decoding] = element.querySelectorAll("img")
  imageState(pending)
  imageState(decoding, {complete: true, width: 100, decode: () => new Promise(() => {})})
  const start = Date.now()
  const report = await prepareImages(page, "#target", {timeout: 80, interval: 5})
  assert.ok(Date.now() - start < 1000)
  assert.equal(report.unresolved, 2)
  assert.ok(report.diagnostics.every(item => item.status === "timeout"))
`))

test("selected img is included and decode failures are explicit", () =>
  check(`
  const {element, page} = fixture('<img id="target" src="/bad-decode">', 1000)
  imageState(element, {complete: true, width: 100, decode: async () => { throw new Error("decode") }})
  const report = await prepareImages(page, "#target", {timeout: 100, interval: 5})
  assert.equal(report.total, 1)
  assert.equal(report.diagnostics[0].status, "decode-failed")
`))

test("scrolling and diagnostics remain bounded on long broken pages", () =>
  check(`
  const {element, page, scrolls} = fixture('<div id="target">' + '<img src="/broken?secret=hidden">'.repeat(50) + '</div>', 1000000)
  element.querySelectorAll("img").forEach(img => imageState(img, {complete: true}))
  const report = await prepareImages(page, "#target", {timeout: 200, maxScrollSteps: 3, interval: 5})
  assert.equal(report.scrollComplete, false)
  assert.ok(scrolls.length <= 4)
  assert.equal(report.unresolved, 50)
  assert.equal(report.diagnostics.length, 10)
  assert.ok(!JSON.stringify(report).includes("hidden"))
`))

test("navigation keeps signed URLs but redacts logs/errors and closes browser after failure", () =>
  check(`
  let closed = 0
  let requested
  const logged = []
  console.debug = message => logged.push(message)
  const page = {
    setViewport: async () => {},
    goto: async url => { requested = url; const error = new Error("Navigation failed at " + url); void error.stack; throw error },
  }
  const url = "https://user:password@example.test/page?signature=secret#private"
  const browser = {version: async () => "fixture", newPage: async () => page, close: async () => { closed++ }}
  const imports = {
    metadata: {plugins: {screenshot: {enabled: () => true, inputs: () => ({url, selector: "body", viewport: {width: 1920, height: 1080}})}}},
    puppeteer: {launch: async () => browser},
    format: {error: error => error},
  }
  await assert.rejects(plugin({login: "fixture", q: {screenshot: true}, imports, data: {}}, {enabled: true}), error => !error.message.includes("secret") && !error.message.includes("password") && !error.stack.includes("secret") && !error.stack.includes("password"))
  assert.equal(requested, url)
  assert.equal(closed, 1)
  assert.ok(!logged.join("").includes("secret"))
  assert.equal(diagnosticUrl(url), "https://example.test/page")
  assert.equal(diagnosticUrl("data:image/png;base64,secret"), "[data image]")
`))

test("images appended while an earlier image loads are included and decoded", () =>
  check(`
  const {window, element, page} = fixture('<div id="target"><img src="/first"></div>', 1000)
  const first = element.querySelector("img")
  const firstState = imageState(first)
  let decoded = 0
  setTimeout(() => {
    const added = window.document.createElement("img")
    added.src = "https://cdn.test/late?signature=secret"
    const state = imageState(added, {decode: async () => { decoded++ }})
    element.append(added)
    setTimeout(() => {
      state.complete = true
      state.width = 100
      added.dispatchEvent(new window.Event("load"))
    }, 70)
  }, 20)
  setTimeout(() => {
    firstState.complete = true
    firstState.width = 100
    first.dispatchEvent(new window.Event("load"))
  }, 50)
  const report = await prepareImages(page, "#target", {timeout: 300, interval: 10})
  assert.equal(report.total, 2)
  assert.equal(report.loaded, 2)
  assert.equal(decoded, 1)
  assert.ok(!JSON.stringify(report).includes("secret"))
`))

test("source changes invalidate stale decode results and wait for the replacement", () =>
  check(`
  const {window, element, page} = fixture('<div id="target"><img src="/placeholder"></div>', 1000)
  const img = element.querySelector("img")
  let decodes = 0
  const state = imageState(img, {complete: true, width: 100, decode: async () => {
    const attempt = ++decodes
    await new Promise(resolve => setTimeout(resolve, attempt === 1 ? 40 : 10))
  }})
  setTimeout(() => {
    img.src = "https://cdn.test/replacement?signature=keep"
    state.complete = false
    state.width = 0
  }, 20)
  setTimeout(() => {
    state.complete = true
    state.width = 200
    img.dispatchEvent(new window.Event("load"))
  }, 75)
  const start = Date.now()
  const report = await prepareImages(page, "#target", {timeout: 300, interval: 10})
  assert.equal(report.loaded, 1)
  assert.equal(decodes, 2)
  assert.ok(Date.now() - start >= 85)
  assert.equal(img.src, "https://cdn.test/replacement?signature=keep")
`))

test("two quiet scan intervals catch delayed source changes after an initial decode", () =>
  check(`
  const {window, element, page} = fixture('<div id="target"><img src="/placeholder"></div>', 1000)
  const img = element.querySelector("img")
  let decodes = 0
  const state = imageState(img, {complete: true, width: 100, decode: async () => { decodes++ }})
  setTimeout(() => {
    img.src = "/real-cover"
    state.complete = false
    state.width = 0
    setTimeout(() => {
      state.complete = true
      state.width = 200
      img.dispatchEvent(new window.Event("load"))
    }, 25)
  }, 25)
  const report = await prepareImages(page, "#target", {timeout: 300, interval: 20})
  assert.equal(report.loaded, 1)
  assert.equal(decodes, 2)
`))

test("deadline includes last-moment new images and removes readiness listeners", () =>
  check(`
  const {window, element, page} = fixture('<div id="target"><img src="/pending"></div>', 1000)
  const first = element.querySelector("img")
  imageState(first)
  const listeners = new Set()
  const add = first.addEventListener.bind(first)
  const remove = first.removeEventListener.bind(first)
  first.addEventListener = (type, listener) => { listeners.add(listener); add(type, listener) }
  first.removeEventListener = (type, listener) => { listeners.delete(listener); remove(type, listener) }
  setTimeout(() => {
    const added = window.document.createElement("img")
    added.src = "/last-moment"
    imageState(added)
    element.append(added)
  }, 30)
  const report = await prepareImages(page, "#target", {timeout: 50, interval: 50})
  assert.equal(report.total, 2)
  assert.equal(report.unresolved, 2)
  assert.ok(report.diagnostics.every(item => item.status === "timeout"))
  assert.equal(listeners.size, 0)
`))
