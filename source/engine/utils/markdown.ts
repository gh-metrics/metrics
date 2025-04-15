// Imports
import rehypeStringify from "rehype-stringify"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"
import remarkGfm from "remark-gfm"
import { unified } from "unified"
import { highlight } from "@engine/utils/language.ts"
import { DOMParser } from "@b-fuze/deno-dom"
import { Format } from "@engine/utils/format.ts"

/** Markdown renderer (internal) */
const remark = unified()
  // deno-lint-ignore no-explicit-any
  .use(remarkParse as any)
  .use(remarkGfm)
  .use(remarkRehype)
  // deno-lint-ignore no-explicit-any
  .use(rehypeStringify as any)

/** Render markdown */
export async function markdown(text: string, { sanitize = "svg" as false | "svg" } = {}) {
  let { value: render } = await remark.process(text)

  // Sanitize HTML
  if (sanitize) {
    // Import needs to be dynamic as it's not supported in browsers
    // @ts-types="@types/sanitize-html"
    const { default: sanitizeHTML } = await import("sanitize-html")
    switch (sanitize) {
      // SVG content
      case "svg": {
        const allowedTags = [
          // Headers
          "h1",
          "h2",
          "h3",
          "h4",
          "h5",
          "h6",
          // Text
          "p",
          "strong",
          "em",
          "del",
          // Blockquotes
          "blockquote",
          // Code
          "pre",
          "code",
          // Links
          "a",
          // Images
          "img",
          // Tables
          "table",
          "thead",
          "tbody",
          "tfoot",
          "tr",
          "th",
          "td",
          // Lists
          "ul",
          "ol",
          "li",
          "input",
          // Horizontal rules
          "hr",
          // Line breaks
          "br",
        ]
        const allowedAttributes = {
          "*": ["class"],
          input: ["type", "checked", "disabled"],
          img: ["src", "alt"],
        }
        render = sanitizeHTML(
          sanitizeHTML(`${render}`, {
            allowedTags,
            allowedAttributes,
          }),
          {
            allowedTags: ["span", ...allowedTags.filter((tag) => !["input"].includes(tag))],
            allowedAttributes,
            transformTags: {
              h1: sanitizeHTML.simpleTransform("div", { class: "link" }),
              h2: sanitizeHTML.simpleTransform("div", { class: "link" }),
              h3: sanitizeHTML.simpleTransform("div", { class: "link" }),
              h4: sanitizeHTML.simpleTransform("div", { class: "link" }),
              h5: sanitizeHTML.simpleTransform("div", { class: "link" }),
              h6: sanitizeHTML.simpleTransform("div", { class: "link" }),
              a: sanitizeHTML.simpleTransform("span", { class: "link" }),
              input(_, input) {
                return {
                  tagName: "span",
                  attribs: input.type === "checkbox" ? { class: `input checkbox ${"checked" in input ? "checked" : ""}`.trim() } : {} as Record<string, never>,
                }
              },
            },
          },
        )
      }
    }
  }

  // Code highlighting
  if (/<\/code>/.test(`${render}`)) {
    const document = new DOMParser().parseFromString(Format.html(`${render}`), "text/html")!
    await Promise.all([...document.querySelectorAll("code") as unknown as Array<{ className: string; innerHTML: string }>].map(async (code) => {
      const language = code.className.replace("language-", "")
      if (language) {
        code.innerHTML = highlight(await highlight.resolve(language), code.innerHTML).code
      }
    }))
    render = document.querySelector("main")!.innerHTML
  }

  return render
}
