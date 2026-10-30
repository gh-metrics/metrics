const {execFileSync} = require("child_process")

test("cover pixel gate rejects a blank crop even when the rest of the image contains colorful artwork", () => {
  execFileSync(process.execPath, [
    "--input-type=module",
    "--eval",
    `
    import assert from 'node:assert/strict'
    import sharp from 'sharp'
    import {coverVariation} from './tests/browser/cover-pixels.mjs'
    const raw = Buffer.alloc(100 * 100 * 3, 255)
    for (let y = 0; y < 100; y++) {
      for (let x = 50; x < 100; x++) {
        const offset = (y * 100 + x) * 3
        raw[offset] = y < 50 ? 255 : 0
        raw[offset + 1] = 0
        raw[offset + 2] = y < 50 ? 0 : 255
      }
    }
    const pixels = await sharp(raw, {raw: {width: 100, height: 100, channels: 3}}).png().toBuffer()
    assert.equal(await coverVariation(pixels, {left: 0, top: 0, width: 50, height: 100}), 0)
    assert.ok(await coverVariation(pixels, {left: 50, top: 0, width: 50, height: 100}) > 100)
  `,
  ], {cwd: require("path").join(__dirname, ".."), timeout: 10000, stdio: "pipe"})
})
