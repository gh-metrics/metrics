import { captureAtOrigin } from "./capture.mjs"
import { diagnosticUrl, prepareImages } from "./images.mjs"

//Setup
export default async function({login, q, imports, data, account}, {enabled = false, extras = false} = {}) {
  let browser
  //Plugin execution
  try {
    //Check if plugin is enabled and requirements are met
    if ((!q.screenshot) || (!imports.metadata.plugins.screenshot.enabled(enabled, {extras})))
      return null

    //Load inputs
    let {url, selector, title, background, viewport, "lazy.load": lazyLoad, wait, mode} = imports.metadata.plugins.screenshot.inputs({data, account, q})
    if (!url)
      throw {error: {message: "URL is not set"}}

    //Start puppeteer and navigate to page
    console.debug(`metrics/compute/${login}/plugins > screenshot > starting browser`)
    browser = await imports.puppeteer.launch()
    console.debug(`metrics/compute/${login}/plugins > screenshot > started ${await browser.version()}`)
    const page = await browser.newPage()
    await page.setViewport(viewport)
    console.debug(`metrics/compute/${login}/plugins > screenshot > loading ${diagnosticUrl(url)}`)
    await page.goto(url, {waitUntil: ["domcontentloaded", "networkidle2"]})

    await page.waitForSelector(selector)
    let images = null
    if (lazyLoad) {
      images = await prepareImages(page, selector)
      if (images.unresolved || !images.scrollComplete)
        console.warn(`metrics/compute/${login}/plugins > screenshot > image readiness ${JSON.stringify(images)}`)
    }
    if (wait)
      await new Promise(solve => setTimeout(solve, wait))

    //Screenshot
    let content = null
    let image = null
    const metadata = {height: null, width: null}
    switch (mode) {
      case "image": {
        const {clip, buffer} = await captureAtOrigin({page, selector, record: imports.record, background})
        console.debug(`metrics/compute/${login}/plugins > screenshot > coordinates ${JSON.stringify(clip)}`)
        const screenshot = await imports.sharp(Buffer.from(buffer.split(",").pop(), "base64")).resize({width: Math.min(454 * (1 + data.large), clip.width)})
        image = `data:image/png;base64,${(await screenshot.toBuffer()).toString("base64")}`
        Object.assign(metadata, await screenshot.metadata())
        break
      }
      case "text": {
        content = await page.evaluate(selector => document.querySelector(selector)?.innerText ?? "", selector)
        break
      }
      default:
        throw {error: {message: `Unsupported mode "${mode}"`}}
    }

    //Results
    return {mode, image, content, title, height: metadata.height, width: metadata.width, url, images}
  }
  //Handle errors
  catch (error) {
    //Navigation errors can contain the original signed page URL too.
    if (error instanceof Error)
      error = new Error(error.message.replace(/https?:\/\/[^\s"<>]+/g, diagnosticUrl))
    throw imports.format.error(error, {title: "Screenshot error"})
  }
  finally {
    if (browser)
      await browser.close().catch(() => console.warn("metrics/plugins > screenshot > browser cleanup failed"))
  }
}
