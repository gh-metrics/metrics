//Capture document-space bounds from a settled origin without changing the viewport.
//Some Chromium builds omit decoded offscreen images after lazy-image scrolling.
//Origin reset is separate from readiness, and leaves signed URLs and styles intact.
export async function captureAtOrigin({page, selector, record, background, settleTimeout = 1000}) {
  const origin = await page.evaluate(() => ({left: window.scrollX, top: window.scrollY}))
  try {
    const clip = await page.evaluate(async ({selector, settleTimeout}) => {
      window.scrollTo({left: 0, top: 0, behavior: "instant"})
      await new Promise((resolve, reject) => {
        let frame
        const timer = setTimeout(() => {
          window.cancelAnimationFrame(frame)
          reject(new Error("Timed out waiting for screenshot paint at page origin"))
        }, settleTimeout)
        frame = window.requestAnimationFrame(() => {
          frame = window.requestAnimationFrame(() => {
            clearTimeout(timer)
            resolve()
          })
        })
      })
      const element = document.querySelector(selector)
      if (!element)
        throw new Error("Screenshot element disappeared before capture")
      const {x, y, width, height} = element.getBoundingClientRect()
      return {x: x + window.scrollX, y: y + window.scrollY, width, height}
    }, {selector, settleTimeout})
    const [buffer] = await record({page, ...clip, frames: 1, background})
    return {buffer, clip}
  }
  finally {
    //Do not replace a capture failure with a cleanup error (e.g. a closed page).
    await page.evaluate(origin => window.scrollTo({...origin, behavior: "instant"}), origin).catch(() => null)
  }
}
