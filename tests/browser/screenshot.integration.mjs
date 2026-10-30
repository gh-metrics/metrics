//Opt-in real-browser fixtures. Run directly with Node 20; no tokens or external pages are needed.
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import http from "node:http"
import path from "node:path"
import puppeteer from "puppeteer"
import sharp from "sharp"
import { prepareImages } from "../../source/plugins/community/screenshot/images.mjs"
import screenshot from "../../source/plugins/community/screenshot/index.mjs"

const requests = []
const image = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120"><rect width="320" height="120" fill="#7657ff"/></svg>'
const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://fixture.test")
  if (url.pathname === "/image") {
    requests.push(url.search)
    setTimeout(() => {
      response.writeHead(url.searchParams.get("broken") === "true" ? 404 : 200, {"content-type": "image/svg+xml", "cache-control": "no-store"})
      response.end(url.searchParams.get("broken") === "true" ? "missing" : image)
    }, 300)
    return
  }
  response.writeHead(200, {"content-type": "text/html", "cache-control": "no-store"})
  const broken = url.searchParams.get("broken") === "true"
  response.end(
    `<!doctype html><html><head><style>body{margin:0}#target{width:800px}figure{height:700px;margin:0}img{width:320px;height:120px}</style></head><body><main id="target">${
      Array.from({length: 8}, (_, index) => `<figure><img loading="lazy" ${index % 2 ? "data-src" : "src"}="/image?id=${index}&signature=fixture-only&broken=${broken && index > 5}"></figure>`).join("")
    }</main><script>
    const observer = new IntersectionObserver(entries => entries.forEach(({target, isIntersecting}) => {
      if (isIntersecting && target.dataset.src) {
        target.src = target.dataset.src
        delete target.dataset.src
        observer.unobserve(target)
      }
    }))
    document.querySelectorAll("img[data-src]").forEach(img => observer.observe(img))
  </script></body></html>`,
  )
})

await new Promise((resolve, reject) => {
  server.once("error", reject)
  server.listen(0, "127.0.0.1", resolve)
})
const origin = `http://127.0.0.1:${server.address().port}`
const launch = () => puppeteer.launch({headless: "new", executablePath: process.env.PUPPETEER_BROWSER_PATH, args: ["--no-sandbox", "--disable-dev-shm-usage"]})
const artifactDirectory = process.env.METRICS_ARTIFACT_DIR
if (artifactDirectory)
  await fs.mkdir(artifactDirectory, {recursive: true})

try {
  for (const broken of [false, true]) {
    const browsers = []
    const imports = {
      metadata: {
        plugins: {
          screenshot: {
            enabled: () => true,
            inputs: () => ({
              url: `${origin}/?broken=${broken}`,
              selector: "#target",
              title: "Offline fixture",
              viewport: {width: 1920, height: 1080},
              "lazy.load": true,
              wait: 0,
              mode: "image",
              background: true,
            }),
          },
        },
      },
      puppeteer: {
        launch: async () => {
          const browser = await launch()
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
      record: async ({page, width, height, x, y}) => [`data:image/png;base64,${(await page.screenshot({type: "png", clip: {width, height, x, y}})).toString("base64")}`],
      sharp,
      format: {error: error => error},
    }
    const result = await screenshot({login: "fixture", q: {screenshot: true}, imports, data: {large: 0}}, {enabled: true})
    assert.equal(result.images.total, 8)
    assert.equal(result.images.loaded, broken ? 6 : 8)
    assert.equal(result.images.unresolved, broken ? 2 : 0)
    assert.equal(result.images.scrollComplete, true)
    assert.ok(!JSON.stringify(result.images).includes("fixture-only"))
    assert.ok(browsers.every(browser => !browser.isConnected()))
    const pixels = Buffer.from(result.image.split(",")[1], "base64")
    if (artifactDirectory)
      await fs.writeFile(path.join(artifactDirectory, broken ? "fixture-two-failed.png" : "fixture-eight-loaded.png"), pixels)
    const {data: rgba, info} = await sharp(pixels).ensureAlpha().raw().toBuffer({resolveWithObject: true})
    assert.equal(info.width, 454)
    assert.equal(info.channels, 4)
    //Read the actual screenshot pixels, not only the DOM's image readiness.
    //Each 320x120 cover begins at (0, index * 700) in the 800px-wide target.
    const scale = info.width / 800
    const pixelSamples = []
    for (let index = 0; index < 8; index++) {
      const x = Math.floor(160 * scale)
      const y = Math.floor((index * 700 + 60) * scale)
      assert.ok(x < info.width && y < info.height, `Cover ${index + 1} center must be inside the captured image`)
      const offset = (y * info.width + x) * info.channels
      const pixel = [...rgba.subarray(offset, offset + info.channels)]
      const purple = [118, 87, 255, 255].every((value, channel) => Math.abs(pixel[channel] - value) <= 2)
      const expectedPurple = !broken || index < 6
      assert.equal(purple, expectedPurple, `Cover ${index + 1} center at (${x}, ${y}) should ${expectedPurple ? "" : "not "}contain purple pixels; got RGBA ${pixel}`)
      pixelSamples.push({cover: index + 1, x, y, rgba: pixel})
    }
    console.log(JSON.stringify({test: broken ? "two failed images" : "eight cold lazy images", viewport: "1920x1080", images: result.images, pixelSamples}))
  }
  assert.ok(requests.length >= 16)
  assert.ok(requests.every(query => query.includes("signature=fixture-only")), "Signed image queries must reach the server unchanged")

  //Real image loading + a deliberately stalled decoder must still terminate.
  const browser = await launch()
  try {
    const page = await browser.newPage()
    await page.setViewport({width: 1920, height: 1080})
    await page.setContent(`<img id="target" src="data:image/svg+xml,${encodeURIComponent(image)}">`)
    await page.evaluate(() => document.querySelector("img").decode = () => new Promise(() => {}))
    const started = Date.now()
    const result = await prepareImages(page, "#target", {timeout: 500, interval: 20})
    assert.equal(result.unresolved, 1)
    assert.equal(result.diagnostics[0].status, "timeout")
    assert.ok(Date.now() - started < 3000)
    console.log("Stalled real-browser decode terminated within the deadline")
  }
  finally {
    await browser.close()
  }
}
finally {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
