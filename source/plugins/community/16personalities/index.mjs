//Setup
export default async function({login, q, imports, data, account}, {enabled = false, extras = false} = {}) {
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
    const browser = await imports.puppeteer.launch()
    console.debug(`metrics/compute/${login}/plugins > 16personalities > started ${await browser.version()}`)
    const page = await browser.newPage()
    console.debug(`metrics/compute/${login}/plugins > 16personalities > loading ${url}`)
    await page.goto(url, {waitUntil: imports.puppeteer.events})

    //Fetch raw data
    const raw = await page.evaluate(() => ({
      color: getComputedStyle(document.querySelector(".section__wrap")).backgroundColor, //eslint-disable-line no-undef
      type: document.querySelector(".code").innerText,
      personality: {
        category: "personality",
        value: document.querySelector(".type-info > div:nth-child(2)").innerText,
        image: /(?:fe)?male/i.exec(document.querySelector(".result__outline+div a.sp-button").href)[0],
        text: document.querySelector("#intro .content__inner > div:first-child > p:first-of-type").innerText,
      },
      traits: [...document.querySelectorAll(".traitbox")].map(box => {
        const valueEle = box.querySelector(".traitbox__value")
        const rawScore = valueEle.querySelector("span").innerText
        return {
          category: box.querySelector(".traitbox__label").innerText,
          value: valueEle.innerText.replace(rawScore, ""),
          score: rawScore,
          text: box.querySelector("div[id^='trait-desc-'] p").innerText,
        }
      }),
    }))

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
        text: `${text[0].toLocaleUpperCase()}${text.substring(1)}`,
      }]
    })(raw.personality)
    const traits = raw.traits.map(({category, value, score, text}) => {
      text = text.split(" ").slice(1).join(" ").trim()
      return {
        category: category.replace(":", "").trim(),
        value: value.trim(),
        score: scores ? parseInt(score, 10) / 100 : NaN,
        text: `${text[0].toLocaleUpperCase()}${text.substring(1)}`,
      }
    })

    //Results
    return {sections, color, type, personality, traits}
  }
  //Handle errors
  catch (error) {
    throw imports.format.error(error)
  }
}
