//Cold real-source captures must contain painted pixels for every public release cover.
//This website-specific smoke test deliberately fails if its known colorful-cover layout changes.
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { puppeteer, record, sharp } from "../../source/app/metrics/utils.mjs"
import screenshot from "../../source/plugins/community/screenshot/index.mjs"

const directory = process.env.METRICS_ARTIFACT_DIR
if (!directory)
  throw new Error("METRICS_ARTIFACT_DIR is required")
await fs.mkdir(directory, {recursive: true})
const selector = "#himehina_grid > div:nth-child(5) > div"
for (let attempt = 1; attempt <= 3; attempt++) {
  let boxes
  const browsers = []
  const imports = {
    puppeteer: {
      launch: async () => {
        const browser = await puppeteer.launch()
        browsers.push(browser)
        const newPage = browser.newPage.bind(browser)
        browser.newPage = async () => {
          const page = await newPage()
          await page.setCacheEnabled(false)
          return page
        }
        return browser
      },
    },
    sharp,
    record: async options => {
      boxes = await options.page.evaluate(selector =>
        [...document.querySelector(selector).querySelectorAll("img")].map(img => {
          const {x, y, width, height} = img.getBoundingClientRect()
          return {x: x + window.scrollX, y: y + window.scrollY, width, height}
        }), selector)
      boxes = boxes.map(box => ({...box, x: box.x - options.x, y: box.y - options.y}))
      return record(options)
    },
    metadata: {
      plugins: {
        screenshot: {
          enabled: () => true,
          inputs: () => ({
            url: "https://himehina.jp/",
            selector,
            title: "HIMEHINA New Releases",
            viewport: {width: 1920, height: 1080},
            "lazy.load": true,
            wait: 0,
            mode: "image",
            background: true,
          }),
        },
      },
    },
    format: {error: error => error},
  }
  const result = await screenshot({login: "public-paint-fixture", q: {screenshot: true}, imports, data: {large: 0}}, {enabled: true})
  const pixels = Buffer.from(result.image.split(",")[1], "base64")
  await fs.writeFile(path.join(directory, `himehina-cold-${attempt}.png`), pixels)
  assert.ok(browsers.every(browser => !browser.isConnected()))
  assert.ok(boxes.length >= 8, "Expected the eight public release covers")
  assert.equal(result.images.loaded, boxes.length)
  const {width, height} = await sharp(pixels).metadata()
  //This known public block is narrower than the plugin's 454px resize threshold.
  assert.equal(width, 325, "Inspect a changed public layout before updating pixel checks")
  const covers = []
  for (const [index, box] of boxes.entries()) {
    assert.ok(box.width >= 90 && box.height >= 90, `Cover ${index + 1} must have full layout dimensions`)
    const crop = {left: Math.round(box.x + box.width * 0.15), top: Math.round(box.y + box.height * 0.15), width: Math.floor(box.width * 0.7), height: Math.floor(box.height * 0.7)}
    assert.ok(crop.left >= 0 && crop.top >= 0 && crop.left + crop.width <= width && crop.top + crop.height <= height)
    const stats = await sharp(pixels).extract(crop).removeAlpha().stats()
    const variation = Math.max(...stats.channels.slice(0, 3).map(channel => channel.stdev))
    covers.push({cover: index + 1, variation: Math.round(variation * 100) / 100})
    assert.ok(variation > 10, `Cover ${index + 1} is blank/flat rather than painted artwork (variation ${variation})`)
  }
  console.log(JSON.stringify({test: "cold public painted covers", attempt, viewport: "1920x1080", images: result.images, covers}))
}
