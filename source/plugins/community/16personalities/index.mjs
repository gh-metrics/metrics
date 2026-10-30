//Setup
export default async function({login, q, imports, data, account}, {enabled = false, extras = false} = {}) {
  let browser
  //Plugin execution
  try {
    //Check if plugin is enabled and requirements are met
    if ((!q["16personalities"]) || (!imports.metadata.plugins["16personalities"].enabled(enabled, {extras})))
      return null

    //Load inputs
    let {url, sections, scores} = imports.metadata.plugins["16personalities"].inputs({data, account, q})
    if (!url)
      throw {error: {message: "URL is not set"}}

    //Start puppeteer and navigate to page
    console.debug(`metrics/compute/${login}/plugins > 16personalities > starting browser`)
    browser = await imports.puppeteer.launch()
    console.debug(`metrics/compute/${login}/plugins > 16personalities > started ${await browser.version()}`)
    const page = await browser.newPage()
    console.debug(`metrics/compute/${login}/plugins > 16personalities > loading ${url}`)
    await page.goto(url, {waitUntil: imports.puppeteer.events})

    //Wait for the profile content, rather than assuming network idle means it has rendered.
    const names = ['[data-testid="typeheader"] h1 > span:nth-of-type(2)', ".type-info > div:nth-child(2)"]
    try {
      await page.waitForFunction(
        names => {
          const text = selector => document.querySelector(selector)?.innerText?.trim()
          return text(".code") && names.some(selector => text(selector))
            && text("#intro .content__inner > div:first-child > p:first-of-type")
            && document.querySelector(".section__wrap")
            && document.querySelector(".result__outline+div a.sp-button")
            && document.querySelectorAll(".traitbox").length === 5
        },
        {timeout: 15000},
        names,
      )
    }
    catch (error) {
      if (error.name === "TimeoutError")
        throw new Error("16personalities profile did not become ready. Check that the URL is a public profile; the page layout may have changed.")
      throw error
    }

    //Fetch raw data safely so layout changes produce a useful error, not a null dereference.
    const raw = await page.evaluate(names => ({
      color: document.querySelector(".section__wrap") ? window.getComputedStyle(document.querySelector(".section__wrap")).backgroundColor : null,
      type: document.querySelector(".code")?.innerText?.trim(),
      personality: {
        category: "personality",
        value: names.map(selector => document.querySelector(selector)?.innerText?.trim()).find(Boolean),
        image: /(?:fe)?male/i.exec(document.querySelector(".result__outline+div a.sp-button")?.href ?? "")?.[0],
        text: document.querySelector("#intro .content__inner > div:first-child > p:first-of-type")?.innerText?.trim(),
      },
      traits: [...document.querySelectorAll(".traitbox")].map(box => {
        const valueEle = box.querySelector(".traitbox__value")
        const rawScore = valueEle?.querySelector("span")?.innerText?.trim()
        return {
          category: box.querySelector(".traitbox__label")?.innerText?.trim(),
          value: valueEle?.innerText?.replace(rawScore, "").trim(),
          score: rawScore,
          text: box.querySelector("div[id^='trait-desc-'] p")?.innerText?.trim(),
        }
      }),
    }), names)

    //Validate before constructing avatar URLs or formatting incomplete text.
    const invalid = []
    if (!raw.color || !/^[IE][NS][TF][JP](?:-[AT])?$/.test(raw.type ?? ""))
      invalid.push("personality type")
    if (!raw.personality.value || !raw.personality.image || !raw.personality.text)
      invalid.push("personality details")
    if (raw.traits.length !== 5 || raw.traits.some(({category, value, score, text}) => !category || !value || !text || !/^(?:100|[1-9]?\d)%$/.test(score ?? "")))
      invalid.push("trait details")
    if (invalid.length)
      throw new Error(`Unable to read 16personalities ${invalid.join(" and ")}. Check that the URL is a public profile; the page layout may have changed.`)

    //Format data
    const {color, type} = raw
    const personality = await (async ({category, value, image, text}) => {
      const fileName = `${type.split("-")[0]}-${value}-${image}`.toLowerCase()
      image = `https://www.16personalities.com/static/images/personality-types/avatars/${fileName}.svg`
      text = (/^.*you are (.*?\.) .*$/.exec(text)?.[1] ?? text).replaceAll("your", "their").replaceAll("you", "they")
      return [{
        category,
        value,
        image: await imports.imgb64(image),
        text: `${text.charAt(0).toLocaleUpperCase()}${text.substring(1)}`,
      }]
    })(raw.personality)
    const traits = raw.traits.map(({category, value, score, text}) => {
      text = text.split(" ").slice(1).join(" ").trim()
      return {
        category: category.replace(":", "").trim(),
        value: value.trim(),
        score: scores ? parseInt(score, 10) / 100 : NaN,
        text: `${text.charAt(0).toLocaleUpperCase()}${text.substring(1)}`,
      }
    })

    //Results
    return {sections, color, type, personality, traits}
  }
  //Handle errors
  catch (error) {
    throw imports.format.error(error)
  }
  finally {
    if (browser)
      await browser.close().catch(() => console.warn("metrics/plugins > 16personalities > browser cleanup failed"))
  }
}
