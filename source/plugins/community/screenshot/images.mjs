/**Keep signed request URLs intact, but never include their credentials or queries in diagnostics. */
export function diagnosticUrl(value) {
  try {
    const url = new URL(value)
    return ["http:", "https:"].includes(url.protocol) ? `${url.origin}${url.pathname}` : `[${url.protocol.replace(":", "")} image]`
  }
  catch {
    return "[invalid URL]"
  }
}

/**Trigger lazy images and wait for decoded pixels plus two quiet scans within one deadline. */
export async function prepareImages(page, selector, {timeout = 30000, maxScrollSteps = 200, interval = 100} = {}) {
  return page.evaluate(async ({selector, timeout, maxScrollSteps, interval}) => {
    const element = document.querySelector(selector)
    if (!element)
      throw new Error("Screenshot element disappeared while waiting for images")
    const deadline = Date.now() + timeout
    const remaining = () => Math.max(0, deadline - Date.now())
    const pause = () => new Promise(resolve => setTimeout(resolve, Math.min(interval, remaining())))
    const images = () => [...(element.matches("img") ? [element] : []), ...element.querySelectorAll("img")]
    const source = img => JSON.stringify([img.currentSrc, img.src, img.srcset, img.sizes])
    const safeUrl = value => {
      try {
        const url = new URL(value, document.baseURI)
        return ["http:", "https:"].includes(url.protocol) ? `${url.origin}${url.pathname}` : `[${url.protocol.replace(":", "")} image]`
      }
      catch {
        return "[invalid URL]"
      }
    }
    const entries = new Map()
    const observe = img => {
      const entry = {source: source(img), status: "pending", active: true}
      const current = () => entry.active && entry.source === source(img)
      const loaded = () => {
        if (!current() || ["decoding", "loaded"].includes(entry.status))
          return
        if (!(img.naturalWidth > 0)) {
          entry.status = "failed"
          return
        }
        if (typeof img.decode !== "function") {
          entry.status = "loaded"
          return
        }
        entry.status = "decoding"
        //A changed source invalidates this decode. The next scan observes and
        //decodes the replacement without allowing a stale promise to win.
        Promise.resolve().then(() => img.decode()).then(() => {
          if (current())
            entry.status = img.naturalWidth > 0 ? "loaded" : "failed"
        }, () => {
          if (current())
            entry.status = "decode-failed"
        })
      }
      const failed = () => {
        if (current())
          entry.status = "failed"
      }
      img.addEventListener("load", loaded)
      img.addEventListener("error", failed)
      entry.check = () => {
        //complete also describes failed images; naturalWidth/decode validate pixels.
        if ((entry.status === "pending") && img.complete)
          loaded()
      }
      entry.cleanup = () => {
        entry.active = false
        img.removeEventListener("load", loaded)
        img.removeEventListener("error", failed)
      }
      return entry
    }

    let current = []
    let previous = null
    let quiet = 0
    let steps = 0
    let scrolled = false
    try {
      window.scrollTo({top: Math.max(0, element.getBoundingClientRect().top + window.scrollY), behavior: "instant"})
      do {
        current = images()
        const present = new Set(current)
        for (const [img, entry] of entries) {
          if (!present.has(img) || entry.source !== source(img)) {
            entry.cleanup()
            entries.delete(img)
          }
        }
        for (const img of current) {
          //Do not rewrite src/srcset or guess data-src: signed URLs stay intact.
          img.loading = "eager"
          if (!entries.has(img))
            entries.set(img, observe(img))
          entries.get(img).check()
        }
        const states = current.map(img => [entries.get(img), entries.get(img).status])
        const unchanged = previous && states.length === previous.length && states.every(([entry, status], index) => entry === previous[index][0] && status === previous[index][1])
        quiet = unchanged ? quiet + 1 : 0
        previous = states

        const {bottom} = element.getBoundingClientRect()
        scrolled = bottom <= window.innerHeight || window.scrollY + window.innerHeight >= document.documentElement.scrollHeight
        const scroll = !scrolled && steps < maxScrollSteps
        if (scroll) {
          window.scrollBy({top: Math.max(1, Math.min(300, window.innerHeight / 2)), behavior: "instant"})
          steps++
          quiet = 0
        }
        const settled = states.every(([, status]) => !["pending", "decoding"].includes(status))
        if (settled && !scroll && quiet >= 2)
          break
        if (remaining())
          await pause()
      }
      while (remaining())

      //Include nodes/sources that appeared during the final wait too, even if
      //the deadline left no time to establish their readiness.
      current = images()
      scrolled = element.getBoundingClientRect().bottom <= window.innerHeight || window.scrollY + window.innerHeight >= document.documentElement.scrollHeight
      const results = current.map(img => {
        const entry = entries.get(img)
        const status = !entry || ["pending", "decoding"].includes(entry.status) || entry.source !== source(img) ? "timeout" : entry.status
        return {status, url: safeUrl(img.currentSrc || img.src)}
      })
      const unresolved = results.filter(({status}) => status !== "loaded")
      return {
        total: results.length,
        loaded: results.length - unresolved.length,
        unresolved: unresolved.length,
        scrollComplete: scrolled,
        //Bound diagnostics even when a page contains thousands of broken images.
        diagnostics: unresolved.slice(0, 10),
      }
    }
    finally {
      //A timed-out native decode cannot be cancelled, but no listeners/timers or
      //stale callbacks are left able to mutate our completed readiness report.
      for (const entry of entries.values())
        entry.cleanup()
    }
  }, {selector, timeout, maxScrollSteps, interval})
}
