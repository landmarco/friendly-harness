#!/usr/bin/env node
// Scan a tree of generated HTML files and report pages that lack
// itemprop="path". Dry-run by default; pass --apply to delete the reported
// files. This is a one-off cleanup helper, not part of the harness.
//
//   bin/search.js [--apply] [ROOT]
//
// ROOT defaults to $SEARCH_ROOT, then the current directory.

import { readdirSync, statSync, readFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const rootArg = args.find((arg) => !arg.startsWith('-'))
const root = path.resolve(rootArg || process.env.SEARCH_ROOT || process.cwd())

const flatten = (lists) => lists.reduce((a, b) => a.concat(b), [])

function directories(srcPath) {
  return readdirSync(srcPath)
    .map((file) => path.join(srcPath, file))
    .filter((file) => statSync(file).isDirectory())
}

function directoriesRecursive(srcPath) {
  return [srcPath, ...flatten(directories(srcPath).map(directoriesRecursive))]
}

function relevantFiles(dirs = []) {
  return dirs.flatMap((srcPath) =>
    readdirSync(srcPath)
      .map((file) => path.join(srcPath, file))
      .filter((file) => !statSync(file).isDirectory())
  )
}

const searchTree = directoriesRecursive(root)
const files = relevantFiles(searchTree)
const deleteMe = []
const fixMe = []

for (const filePath of files) {
  const text = readFileSync(filePath, 'utf8')
  const result = text.match(/itemprop="path"/gi)
  if (result && result.length > 3) {
    console.log('fix_me', filePath)
    fixMe.push(filePath)
  } else {
    deleteMe.push(filePath)
  }
}

console.log(`\nroot: ${root}`)
console.log(`fix_me: ${fixMe.length}`)
console.log(`delete_me: ${deleteMe.length}`)

if (!apply) {
  console.log('\nDry run. Pass --apply to delete the listed files.')
  process.exit(0)
}

for (const name of deleteMe) unlinkSync(name)
console.log(`\nDeleted ${deleteMe.length} file(s).`)
