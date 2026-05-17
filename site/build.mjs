import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'site')
const output = resolve(root, 'site-dist')

await rm(output, { force: true, recursive: true })
await mkdir(output, { recursive: true })

const siteEntries = await readdir(source)
const htmlFiles = siteEntries.filter(file => file.endsWith('.html'))

await Promise.all([
  ...htmlFiles.map(file => cp(resolve(source, file), resolve(output, file))),
  cp(resolve(source, 'styles.css'), resolve(output, 'styles.css')),
  cp(resolve(source, 'assets'), resolve(output, 'assets'), { recursive: true }),
])

console.log('Site built to site-dist')
