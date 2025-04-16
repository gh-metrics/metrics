import { is, mock, STATUS_CODE } from "@engine/utils/testing.ts"

export default {
  "/gists/{gist_id}": mock({ gist_id: is.string(), files: is.record(is.object({ content: is.string() })) }, () => ({
    status: STATUS_CODE.OK,
    data: {},
  })),
}
