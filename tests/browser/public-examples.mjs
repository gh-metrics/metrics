//Optional public-site smoke tests. Never reads a personal profile secret or publishes Metrics output.
import { JSDOM } from "jsdom"
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import puppeteer from "puppeteer"
import sharp from "sharp"
import personality from "../../source/plugins/community/16personalities/index.mjs"
import screenshot from "../../source/plugins/community/screenshot/index.mjs"

const artifactDirectory = process.env.METRICS_ARTIFACT_DIR
if (artifactDirectory)
  await fs.mkdir(artifactDirectory, {recursive: true})
const imports = {
  puppeteer: {
    events: ["domcontentloaded", "networkidle2"],
    launch: async () => {
      const browser = await puppeteer.launch({headless: "new", executablePath: process.env.PUPPETEER_BROWSER_PATH, args: ["--no-sandbox", "--disable-dev-shm-usage"]})
      const newPage = browser.newPage.bind(browser)
      browser.newPage = async () => {
        const page = await newPage()
        await page.setCacheEnabled(false)
        return page
      }
      return browser
    },
  },
  metadata: {
    plugins: {
      screenshot: {
        enabled: () => true,
        inputs: () => ({
          url: "https://himehina.jp/",
          selector: "#himehina_grid > div:nth-child(5) > div",
          title: "HIMEHINA New Releases",
          viewport: {width: 1920, height: 1080},
          lazy_load: true,
          wait: 0,
          mode: "image",
          background: true,
        }),
      },
      "16personalities": {enabled: () => true, inputs: () => ({url: "https://www.16personalities.com/profiles/b7d9f29453ea5", sections: ["personality", "traits"], scores: true})},
    },
  },
  record: async ({page, width, height, x, y}) => [`data:image/png;base64,${(await page.screenshot({type: "png", clip: {width, height, x, y}})).toString("base64")}`],
  sharp,
  imgb64: async url => {
    const response = await fetch(url)
    assert.ok(response.ok, "Public personality avatar must be reachable")
    assert.match(response.headers.get("content-type") ?? "", /^image\/svg\+xml(?:;|$)/i, "Public avatar must be SVG, not an HTML challenge")
    const bytes = Buffer.from(await response.arrayBuffer())
    const document = new JSDOM(bytes.toString("utf8"), {contentType: "image/svg+xml"}).window.document
    assert.equal(document.documentElement.localName, "svg", "Public avatar must contain a valid SVG document")
    return `data:image/svg+xml;base64,${bytes.toString("base64")}`
  },
  format: {error: error => error},
}

const release = await screenshot({login: "public-fixture", q: {screenshot: true}, imports, data: {large: 0}}, {enabled: true})
if (artifactDirectory)
  await fs.writeFile(path.join(artifactDirectory, "himehina-public-releases.png"), Buffer.from(release.image.split(",")[1], "base64"))
console.log(JSON.stringify({test: "HIMEHINA cold public source capture", viewport: "1920x1080", images: release.images}))
assert.ok(release.images.total >= 8, "Public releases section should include the eight known covers; inspect a changed page layout if not")
assert.equal(release.images.loaded, release.images.total)
assert.equal(release.images.scrollComplete, true)

const profile = await personality({login: "public-fixture", q: {"16personalities": true}, imports, data: {}}, {enabled: true})
assert.equal(profile.traits.length, 5)
assert.ok(profile.personality[0].image.startsWith("data:image/svg+xml;base64,"))
console.log(JSON.stringify({test: "Public personality source scrape", type: profile.type, name: profile.personality[0].value, traits: profile.traits.length}))
