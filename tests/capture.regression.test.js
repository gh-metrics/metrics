const {execFileSync} = require("child_process")

const setup = `
  import assert from "node:assert/strict"
  import vm from "node:vm"
  import {JSDOM} from "jsdom"
  import {captureAtOrigin} from "./source/plugins/community/screenshot/capture.mjs"
  function fixture({frames = true} = {}) {
    const dom = new JSDOM('<div id="target"></div>', {runScripts: "outside-only"})
    const {window} = dom
    const scrolls = []
    const cancelled = []
    window.scrollX = 120
    window.scrollY = 2900
    window.scrollTo = ({left, top}) => {
      window.scrollX = left
      window.scrollY = top
      scrolls.push({left, top})
    }
    let frameCount = 0
    window.requestAnimationFrame = callback => frames ? setTimeout(() => {frameCount++; callback()}, 0) : 1
    window.cancelAnimationFrame = id => {cancelled.push(id); clearTimeout(id)}
    const target = window.document.querySelector('#target')
    target.getBoundingClientRect = () => ({x: 134.5 - window.scrollX, y: 2250.25 - window.scrollY, width: 325, height: 1209})
    const page = {evaluate: (fn, arg) => Promise.resolve().then(() => vm.runInContext('(' + fn.toString() + ')(' + JSON.stringify(arg) + ')', dom.getInternalVMContext())).then(value => value === undefined ? value : JSON.parse(JSON.stringify(value)))}
    return {window, page, scrolls, target, cancelled, frames: () => frameCount}
  }
`

const check = code => void execFileSync(process.execPath, ["--input-type=module", "--eval", setup + code], {cwd: require("path").join(__dirname, ".."), timeout: 10000, stdio: "pipe"})

test("capture resets both scroll axes, waits two frames, measures fresh bounds and restores scroll", () =>
  check(`
  const f = fixture()
  let recorded
  const result = await captureAtOrigin({page: f.page, selector: '#target', background: true, record: async options => {
    assert.equal(f.window.scrollX, 0)
    assert.equal(f.window.scrollY, 0)
    assert.equal(f.frames(), 2)
    recorded = options
    return ['data:image/png;base64,fixture']
  }})
  assert.deepEqual(result, {buffer: 'data:image/png;base64,fixture', clip: {x: 134.5, y: 2250.25, width: 325, height: 1209}})
  assert.equal(recorded.frames, 1)
  assert.equal(recorded.background, true)
  assert.deepEqual(f.scrolls, [{left: 0, top: 0}, {left: 120, top: 2900}])
`))

test("capture errors retain their cause while restoring scroll", () =>
  check(`
  const f = fixture()
  const expected = new Error('capture failed')
  await assert.rejects(captureAtOrigin({page: f.page, selector: '#target', record: async () => {throw expected}}), error => error === expected)
  assert.equal(f.window.scrollX, 120)
  assert.equal(f.window.scrollY, 2900)
`))

test("paint waits are bounded and never record an unready screenshot", () =>
  check(`
  const f = fixture({frames: false})
  let calls = 0
  const started = Date.now()
  await assert.rejects(captureAtOrigin({page: f.page, selector: '#target', settleTimeout: 20, record: async () => {calls++; return []}}), /Timed out waiting for screenshot paint/)
  assert.equal(calls, 0)
  assert.equal(f.cancelled.length, 1)
  assert.ok(Date.now() - started < 1000)
  assert.equal(f.window.scrollY, 2900)
`))

test("a disappeared target is explicit and scroll is restored", () =>
  check(`
  const f = fixture()
  f.target.remove()
  await assert.rejects(captureAtOrigin({page: f.page, selector: '#target', record: async () => assert.fail('record called')}), /element disappeared/)
  assert.equal(f.window.scrollY, 2900)
`))

test("scroll cleanup failures never replace the screenshot error", () =>
  check(`
  const f = fixture()
  const evaluate = f.page.evaluate
  let evaluations = 0
  f.page.evaluate = (...args) => ++evaluations === 3 ? Promise.reject(new Error('page closed')) : evaluate(...args)
  const expected = new Error('capture failed')
  await assert.rejects(captureAtOrigin({page: f.page, selector: '#target', record: async () => {throw expected}}), error => error === expected)
`))
