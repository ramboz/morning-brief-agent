import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function writeDailyBriefFiles({ outputDir, date, markdown }) {
  await mkdir(outputDir, { recursive: true })

  const datedPath = join(outputDir, `${date}.md`)
  const latestPath = join(outputDir, 'latest.md')
  const body = `${markdown.trimEnd()}\n`

  await writeFile(datedPath, body)
  await writeFile(latestPath, body)

  return {
    markdown: datedPath,
    latest_markdown: latestPath
  }
}
