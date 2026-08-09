//Imports
const path = require("path")
const git = require("simple-git")(path.join(__dirname, ".."))

//Edited files list
const diff = async () => (await git.diff(["origin/master...", "--name-status"])).split("\n").map(x => x.trim()).filter(x => /^M\s+/.test(x)).map(x => x.replace(/^M\s+/, ""))

//Template changes
describe("Check template changes", () => {
  test("Use community templates instead (see https://github.com/gh-metrics/metrics/tree/master/source/templates/community)", async () => void expect((await diff()).filter(edited => /^sources[/]templates[/]/.test(edited) && /^source[/]templates[/](?:classic|terminal|markdown|repository|community)[/][\s\S]*$/.test(edited)).length).toBe(0))
})
