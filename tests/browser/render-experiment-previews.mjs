//Rasterize only named local experiment artifacts, with external requests blocked.
import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { puppeteer } from "../../source/app/metrics/utils.mjs"

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
