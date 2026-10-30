//Rasterize only named local experiment artifacts, with external requests blocked.
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import sharp from "sharp"
import { puppeteer } from "../../source/app/metrics/utils.mjs"
import { coverVariation } from "./cover-pixels.mjs"

const directory = process.env.METRICS_ARTIFACT_DIR
if (!directory)
  throw new Error("METRICS_ARTIFACT_DIR is required")
const browser = await puppeteer.launch()
try {
  const page = await browser.newPage()
  await page.setJavaScriptEnabled(false)
  const names = ["activity", "16personalities", "himehina-info", "himehina-releases"]
  const allowedFiles = new Set(names.map(name => pathToFileURL(path.join(directory, `${name}.svg`)).href))
  await page.setRequestInterception(true)
  page.on("request", request => allowedFiles.has(request.url()) || request.url().startsWith("data:image/") ? request.continue() : request.abort())
  for (const name of names) {
    const file = path.join(directory, `${name}.svg`)
    await fs.access(file)
    if (name === "himehina-releases") {
      //A successful plugin exit is insufficient: catch the actual blank-cover regression.
      const matches = [...(await fs.readFile(file, "utf8")).matchAll(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g)]
      assert.equal(matches.length, 1, "Expected one embedded public screenshot")
      const pixels = Buffer.from(matches[0][1], "base64")
      const metadata = await sharp(pixels).metadata()
      assert.equal(metadata.width, 325, "Inspect a changed public layout before updating these pixel checks")
      assert.equal(metadata.height, 1209)
      const covers = []
      for (let index = 0; index < 8; index++) {
        const variation = await coverVariation(pixels, {left: 35, top: 119 + index * 129, width: 70, height: 70})
        covers.push({cover: index + 1, variation: Math.round(variation * 100) / 100})
        assert.ok(variation > 10, `Actual action cover ${index + 1} is blank/flat rather than painted artwork`)
      }
      console.log(JSON.stringify({test: "actual action public cover pixels", covers}))
    }
    await page.goto(pathToFileURL(file).href, {waitUntil: "load"})
    const dimensions = await page.evaluate(() => ({width: Number(document.documentElement.getAttribute("width")), height: Number(document.documentElement.getAttribute("height"))}))
    if (!(dimensions.width > 0 && dimensions.width <= 2000 && dimensions.height > 0 && dimensions.height <= 10000))
      throw new Error(`Invalid preview dimensions for ${name}`)
    await page.setViewport(dimensions)
    await page.evaluate(() => Promise.all([...document.querySelectorAll("img")].map(img => img.decode().catch(() => {}))))
    await page.screenshot({path: path.join(directory, `${name}.png`), fullPage: true, type: "png"})
  }
}
finally {
  await browser.close()
}
