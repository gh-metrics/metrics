//Retry only explicit GitHub rate limits, never ordinary permission failures.
//Keep retries bounded, and never shorten a server-requested waiting period.
export async function requestWithBackoff(request) {
  const budget = 120000
  let waited = 0
  for (let attempt = 0;; attempt++) {
    try {
      return await request()
    }
    catch (error) {
      const status = error.status ?? error.response?.status
      const headers = error.response?.headers ?? {}
      const message = error.response?.data?.message ?? error.message ?? ""
      const limited = (status === 429) || ((status === 403) && (
        (headers["retry-after"] != null) || (String(headers["x-ratelimit-remaining"]) === "0") || /secondary rate limit|abuse detection|API rate limit exceeded/i.test(message)
      ))
      if (!limited || (attempt >= 2))
        throw error
      let delay = 60000 * 2 ** attempt
      const retryAfter = headers["retry-after"]
      if (retryAfter != null) {
        const seconds = Number(retryAfter)
        const requested = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now()
        if (Number.isFinite(requested))
          delay = Math.max(0, requested)
      }
      if (String(headers["x-ratelimit-remaining"]) === "0") {
        const reset = Number(headers["x-ratelimit-reset"]) * 1000 - Date.now()
        if (Number.isFinite(reset))
          delay = Math.max(delay, reset)
      }
      if (waited + delay > budget)
        throw error
      waited += delay
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
}
