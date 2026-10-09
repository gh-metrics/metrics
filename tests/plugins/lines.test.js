// Tests for lines plugin null-author handling, context mode, and template rendering
const ejs = require("ejs")
const path = require("path")
const fs = require("fs")

describe("Lines plugin unit & regression tests", () => {
  describe("source/plugins/lines/index.mjs logic", () => {
    const mockImports = {
      metadata: {
        plugins: {
          lines: {
            enabled: () => true,
            inputs: () => ({
              skipped: [],
              sections: ["base", "history", "repositories"],
              "repositories.limit": 4,
              "history.limit": 1,
              delay: 0,
            }),
          },
        },
      },
      filters: {
        repo: () => true,
      },
      d3: {
        scaleTime: () => ({ domain: () => ({ range: () => ({}) }) }),
        scaleLinear: () => ({ domain: () => ({ range: () => ({}) }) }),
        axisBottom: () => () => ({ selectAll: () => ({ attr: () => ({ style: () => ({ style: () => ({}) }) }) }) }),
        axisLeft: () => () => ({ ticks: () => ({ tickFormat: () => ({ selectAll: () => ({ style: () => ({}) }) }) }) }),
        format: () => () => "",
        area: () => ({ x: () => ({ y0: () => ({ y1: () => () => "" }) }) }),
      },
      D3node: class {
        createSVG() {
          return {
            append: () => ({
              attr: () => ({ call: () => ({}) }),
              datum: () => ({ attr: () => ({ attr: () => ({}) }) }),
            }),
          }
        }
        svgString() {
          return "<svg>mock-diff-history</svg>"
        }
      },
      format: {
        error: e => e,
      },
    }

    const mockRest = {
      repos: {
        getContributorsStats: async () => ({
          data: [
            {
              total: 5,
              weeks: [{ w: 1690000000, a: 100, d: 20, c: 5 }],
              author: null, // Contributor stats with author: null
            },
            {
              total: 10,
              weeks: [{ w: 1690000000, a: 200, d: 50, c: 10 }],
              author: { login: "test-user" },
            },
            {
              total: 3,
              weeks: [{ w: 1690000000, a: 50, d: 10, c: 2 }],
              author: { login: "other-user" },
            },
          ],
        }),
      },
    }

    // Case 1: Personal user mode + author = null
    test("Case 1: Personal user mode handles author = null and only counts personal commits", async () => {
      const linesPlugin = (await import("../../source/plugins/lines/index.mjs")).default
      const mockData = {
        account: "user", // Normal personal account
        user: {
          repositories: {
            nodes: [{ name: "test-repo", owner: { login: "test-user" } }],
          },
        },
        shared: {
          "repositories.skipped": [],
        },
      }

      const result = await linesPlugin(
        { login: "test-user", data: mockData, imports: mockImports, rest: mockRest, q: { lines: true }, account: "user" },
        { enabled: true }
      )

      expect(result).toBeDefined()
      // Only test-user's commits are counted (200 added, 50 deleted), other-user and null author are safely filtered out
      expect(result.added).toBe(200)
      expect(result.deleted).toBe(50)
      expect(result.changed).toBe(10)
    })

    // Case 5: Organization mode & Repository mode preserved
    test("Case 5a: Organization mode counts all contributors without crashing on null author", async () => {
      const linesPlugin = (await import("../../source/plugins/lines/index.mjs")).default
      const mockOrgData = {
        account: "organization",
        user: {
          repositories: {
            nodes: [{ name: "test-repo", owner: { login: "test-org" } }],
          },
        },
        shared: {
          "repositories.skipped": [],
        },
      }

      const resultOrg = await linesPlugin(
        { login: "test-org", data: mockOrgData, imports: mockImports, rest: mockRest, q: { lines: true }, account: "organization" },
        { enabled: true }
      )

      expect(resultOrg).toBeDefined()
      // All contributors are counted: 100 + 200 + 50 = 350
      expect(resultOrg.added).toBe(350)
      expect(resultOrg.deleted).toBe(80)
    })

    test("Case 5b: Repository mode counts all contributors when q.repo is set", async () => {
      const linesPlugin = (await import("../../source/plugins/lines/index.mjs")).default
      const mockData = {
        account: "user",
        user: {
          repositories: {
            nodes: [{ name: "test-repo", owner: { login: "test-user" } }],
          },
        },
        shared: {
          "repositories.skipped": [],
        },
      }

      const resultRepo = await linesPlugin(
        { login: "test-user", data: mockData, imports: mockImports, rest: mockRest, q: { lines: true, repo: "test-repo" }, account: "user" },
        { enabled: true }
      )

      expect(resultRepo).toBeDefined()
      expect(resultRepo.added).toBe(350)
    })
  })

  describe("source/templates/classic/partials/lines.ejs template rendering", () => {
    const templatePath = path.join(__dirname, "../../source/templates/classic/partials/lines.ejs")
    const templateStr = fs.readFileSync(templatePath, "utf8")

    // Case 2: Plugin error with sections undefined
    test("Case 2: Template renders error UI when plugins.lines.error is present and sections is undefined", async () => {
      const rendered = await ejs.render(templateStr, {
        plugins: {
          lines: {
            error: { message: "API rate limit exceeded or query failed" },
          },
        },
      })
      expect(rendered).toContain("Lines of code pushed")
      expect(rendered).toContain("API rate limit exceeded or query failed")
    })

    // Case 3: sections = ["repositories"]
    test("Case 3: Template renders repositories section normally when sections = ['repositories']", async () => {
      const rendered = await ejs.render(templateStr, {
        f: n => String(n),
        plugins: {
          lines: {
            sections: ["repositories"],
            repos: [{ handle: "test-owner/test-repo", added: 120, deleted: 30, changed: 5 }],
          },
        },
      })
      expect(rendered).toContain("Lines of code pushed")
      expect(rendered).toContain("test-owner/test-repo")
      expect(rendered).not.toContain("Diff history")
    })

    // Case 4: sections = ["history"]
    test("Case 4: Template renders history section normally when sections = ['history']", async () => {
      const rendered = await ejs.render(templateStr, {
        f: n => String(n),
        plugins: {
          lines: {
            sections: ["history"],
            repos: [],
            history: "<svg id=\"diff-history\"></svg>",
          },
        },
      })
      expect(rendered).toContain("Lines of code pushed")
      expect(rendered).toContain("Diff history")
      expect(rendered).toContain("<svg id=\"diff-history\"></svg>")
    })

    test("Template renders nothing when plugin lines is not enabled or sections do not match", async () => {
      const rendered = await ejs.render(templateStr, {
        plugins: {
          lines: {
            sections: ["base"],
          },
        },
      })
      expect(rendered.trim()).toBe("")
    })
  })
})
