import sharp from "sharp"

//stats() reads input pixels, not pending pipeline operations: materialize the crop first.
export async function coverVariation(pixels, crop) {
  const cropped = await sharp(pixels).extract(crop).removeAlpha().png().toBuffer()
  const stats = await sharp(cropped).stats()
  return Math.max(...stats.channels.slice(0, 3).map(channel => channel.stdev))
}
