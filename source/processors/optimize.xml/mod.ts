// Imports
import { Processor, state } from "@engine/components/processor.ts"
import xmlFormat from "xml-formatter"

/** Processor */
export default class extends Processor {
  /** Import meta */
  static readonly meta = import.meta

  /** Name */
  readonly name = "🧹 Optimize XML"

  /** Category */
  readonly category = "optimizer"

  /** Description */
  readonly description = "Format XML to improve diff readability and size"

  /** Supports */
  readonly supports = ["application/xml", "image/svg+xml"]

  /** Action */
  protected async action(state: state) {
    const result = await this.piped(state)
    // @ts-expect-error -- chrisbottin/xml-formatter#72
    result.content = xmlFormat(result.content, { indentation: "  ", collapseContent: true, ignoredPaths: [] })
  }
}
