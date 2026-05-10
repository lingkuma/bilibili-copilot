import { cp, mkdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'site')
const output = resolve(root, 'site-dist')

await rm(output, { force: true, recursive: true })
await mkdir(output, { recursive: true })

await Promise.all([
  cp(resolve(source, 'index.html'), resolve(output, 'index.html')),
  cp(resolve(source, 'styles.css'), resolve(output, 'styles.css')),
  cp(resolve(source, 'assets'), resolve(output, 'assets'), { recursive: true }),
])

console.log('Site built to site-dist')
