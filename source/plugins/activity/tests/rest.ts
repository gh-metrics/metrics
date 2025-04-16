import { mock, STATUS_CODE } from "@engine/utils/testing.ts"

export default {
  "/zen": mock({}, () => ({
    status: STATUS_CODE.OK,
    data: new TextEncoder().encode("Anything added dilutes everything else."),
  })),
}
