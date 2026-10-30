//Public-page-only diagnostics for the experimental branch. No tokens or profile URLs.
import fs from "node:fs/promises"
import path from "node:path"
import { puppeteer, record } from "../../source/app/metrics/utils.mjs"
import { diagnosticUrl, prepareImages } from "../../source/plugins/community/screenshot/images.mjs"

const directory = process.env.METRICS_ARTIFACT_DIR
if (!directory)
  throw new Error("METRICS_ARTIFACT_DIR is required")
await fs.mkdir(directory, {recursive: true})
const selector = "#himehina_grid > div:nth-child(5) > div"
const browser = await puppeteer.launch()
const report = {browser: await browser.version(), viewport: {width: 1920, height: 1080}, stages: [], responses: []}
try {
  const page = await browser.newPage()
  await page.setCacheEnabled(false)
  await page.setViewport(report.viewport)
  page.on("response", response => {
    if (response.request().resourceType() === "image" && report.responses.length < 100)
      report.responses.push({url: diagnosticUrl(response.url()), status: response.status(), length: response.headers()["content-length"], type: response.headers()["content-type"]})
  })
  const inspect = async name => {
    const state = await page.evaluate(selector => {
      const element = document.querySelector(selector)
      const box = node => {
        const {x, y, width, height} = node.getBoundingClientRect()
        return {x, y, width, height}
      }
      return {
        scrollY: window.scrollY,
        clip: box(element),
        images: [...element.querySelectorAll("img")].map(img => {
          const style = getComputedStyle(img)
          const url = new URL(img.currentSrc || img.src)
          return {
            url: ["http:", "https:"].includes(url.protocol) ? `${url.origin}${url.pathname}` : `[${url.protocol.replace(":", "")} image]`,
            complete: img.complete,
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
            box: box(img),
            parent: box(img.parentElement),
            opacity: style.opacity,
            visibility: style.visibility,
            display: style.display,
            objectFit: style.objectFit,
            contentVisibility: style.contentVisibility,
          }
        }),
      }
    }, selector)
    report.stages.push({name, ...state})
    console.log(JSON.stringify({stage: name, ...state}))
    return {x: state.clip.x, y: state.clip.y + state.scrollY, width: state.clip.width, height: state.clip.height}
  }
  await page.goto("https://himehina.jp/", {waitUntil: ["domcontentloaded", "networkidle2"]})
  await page.waitForSelector(selector)
  await inspect("navigation")
  report.readiness = await prepareImages(page, selector)
  const clip = await inspect("ready")
  const [production] = await record({page, ...clip, frames: 1, background: true})
  await fs.writeFile(path.join(directory, "public-production-record.png"), Buffer.from(production.split(",")[1], "base64"))
  await page.screenshot({path: path.join(directory, "public-direct-capture.png"), clip, type: "png"})
  await inspect("after-capture")

  await page.evaluate(() => window.scrollTo({top: 0, left: 0, behavior: "instant"}))
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const reset = await inspect("reset-scroll-origin")
  await page.screenshot({path: path.join(directory, "public-reset-origin.png"), clip: reset, type: "png"})

  //Compare compositor/viewport readiness without rewriting any website images or URLs.
  await page.setViewport({width: 1920, height: Math.min(4096, Math.ceil(clip.height + 100))})
  await page.evaluate(selector => document.querySelector(selector).scrollIntoView({block: "start", behavior: "instant"}), selector)
  report.expandedReadiness = await prepareImages(page, selector)
  const expanded = await inspect("expanded-viewport")
  await page.screenshot({path: path.join(directory, "public-expanded-viewport.png"), clip: expanded, type: "png"})
  await fs.writeFile(path.join(directory, "public-diagnostics.json"), JSON.stringify(report, null, 2))
}
finally {
  await browser.close()
}
