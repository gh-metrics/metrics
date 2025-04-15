import { faker, is, log, mock, STATUS_CODE, StatusCode } from "@engine/utils/testing.ts"

let available = false
let timeout = NaN

export default {
  "/repos/{owner}/{repo}/stats/contributors": mock({ owner: is.string(), repo: is.string() }, ({ owner, repo }) => {
    let status: StatusCode = STATUS_CODE.OK
    if (repo === "empty") {
      status = STATUS_CODE.NoContent
    }
    if (repo === "retry") {
      status = available ? STATUS_CODE.OK : STATUS_CODE.Accepted
      available = true
      clearTimeout(timeout)
      timeout = setTimeout(() => {
        log.io(`${owner}/${repo}: state reset`)
        available = false
      }, 100)
    }
    const year = `${new Date().getFullYear()}`
    return {
      status,
      data: [
        {
          weeks: [
            {
              w: new Date(year).getTime() / 1000,
              a: faker.number.int({ min: 0, max: 10000 }),
              d: faker.number.int({ min: 0, max: 10000 }),
              c: faker.number.int({ min: 0, max: 10000 }),
            },
          ],
          author: {
            login: "octocat",
            avartar_url: faker.image.avatarGitHub(),
          },
        },
        {
          weeks: [
            {
              w: new Date(year).getTime() / 1000,
              a: faker.number.int({ min: 0, max: 10000 }),
              d: faker.number.int({ min: 0, max: 10000 }),
              c: faker.number.int({ min: 0, max: 10000 }),
            },
            {
              w: (new Date(year).getTime() - 7 * 24 * 60 * 60 * 1000) / 1000,
              a: faker.number.int({ min: 0, max: 10000 }),
              d: faker.number.int({ min: 0, max: 10000 }),
              c: faker.number.int({ min: 0, max: 10000 }),
            },
            {
              w: new Date(`${+year - 1}`).getTime() / 1000,
              a: faker.number.int({ min: 0, max: 10000 }),
              d: faker.number.int({ min: 0, max: 10000 }),
              c: faker.number.int({ min: 0, max: 10000 }),
            },
          ],
          author: {
            login: "octosquid",
            avartar_url: faker.image.avatarGitHub(),
          },
        },
        {
          weeks: [
            {
              w: NaN,
              a: faker.number.int({ min: 0, max: 10000 }),
              d: faker.number.int({ min: 0, max: 10000 }),
              c: faker.number.int({ min: 0, max: 10000 }),
            },
          ],
          author: null,
        },
      ],
    }
  }),
}
