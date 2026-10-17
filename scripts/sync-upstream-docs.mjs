import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const workspace = process.cwd()
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'uwuaosp-upstream-'))
const docsRepository = process.env.UPSTREAM_DOCS_REPOSITORY ?? 'https://github.com/uwuAOSP/Docs.git'
const manifestsRepository = process.env.UPSTREAM_MANIFESTS_REPOSITORY ?? 'https://github.com/uwuAOSP/platform_manifests.git'

function run(command, args, cwd = tempRoot) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit']
  }).trim()
}

function cloneBranch(repository, branch, directory) {
  const target = path.join(tempRoot, directory)
  run('git', ['clone', '--depth', '1', '--branch', branch, '--single-branch', repository, target])
  return target
}

function listBranches(repository) {
  return run('git', ['ls-remote', '--heads', repository])
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.replace(/^\S+\s+refs\/heads\//, ''))
    .filter(Boolean)
}

function markdownFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const source = path.join(directory, entry.name)

    if (entry.isDirectory()) return markdownFiles(source)
    return entry.isFile() && entry.name.endsWith('.md') ? [source] : []
  })
}

function relativeMarkdownPath(sourceRoot, sourceFile) {
  const relative = path.relative(sourceRoot, sourceFile)
  return path.basename(relative).toLowerCase() === 'readme.md'
    ? path.join(path.dirname(relative), 'index.md')
    : relative
}

function rewriteReadmeLinks(content) {
  return content.replace(
    /\]\(([^)\s]*?)README\.md(#[^)]+)?\)/gi,
    (_, prefix, hash = '') => `](${prefix || './'}${hash})`
  )
}

function addSiteOnlyUniChart(content) {
  return content.replace(
    /!\[[^\]]+\]\(assets\/clean-build-time\.svg\)/,
    '<UniBuildCharts locale="zh" />'
  )
}

function preserveSiteOnlyFiles(destinationRoot, relativeNames) {
  const saved = new Map()

  for (const name of relativeNames) {
    const file = path.join(destinationRoot, name)
    if (fs.existsSync(file)) saved.set(name, fs.readFileSync(file))
  }

  return saved
}

function restoreSiteOnlyFiles(destinationRoot, saved) {
  for (const [name, content] of saved) {
    const file = path.join(destinationRoot, name)
    if (fs.existsSync(file)) continue
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
}

function documentationAssets(directory) {
  const extensions = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.svg', '.webp'])

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '.git') return []
    const source = path.join(directory, entry.name)
    if (entry.isDirectory()) return documentationAssets(source)
    return entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())
      ? [source]
      : []
  })
}

function replaceMarkdownDirectory(sourceRoot, destinationRoot) {
  fs.rmSync(destinationRoot, { recursive: true, force: true })
  fs.mkdirSync(destinationRoot, { recursive: true })

  for (const sourceFile of markdownFiles(sourceRoot)) {
    const destination = path.join(destinationRoot, relativeMarkdownPath(sourceRoot, sourceFile))
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    const content = rewriteReadmeLinks(fs.readFileSync(sourceFile, 'utf8'))
    fs.writeFileSync(destination, content)
  }

  for (const sourceFile of documentationAssets(sourceRoot)) {
    const destination = path.join(destinationRoot, path.relative(sourceRoot, sourceFile))
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(sourceFile, destination)
  }
}

function copyMarkdownIfPresent(sourceRoot, sourceName, destination, replacements = []) {
  const source = path.join(sourceRoot, sourceName)

  if (!fs.existsSync(source)) return false

  fs.mkdirSync(path.dirname(destination), { recursive: true })
  let content = fs.readFileSync(source, 'utf8')

  for (const [from, to] of replacements) {
    content = content.replaceAll(from, to)
  }

  fs.writeFileSync(destination, rewriteReadmeLinks(content))
  return true
}

function branchDirectory(branch) {
  const segments = branch.split('/')

  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Unsafe upstream branch name: ${branch}`)
  }

  return destination(path.join('docs', 'docs', ...segments))
}

function branchLink(branch) {
  return `/docs/${branch}/`
}

function fileLink(branch, file) {
  const relative = file.split(path.sep).join('/')
  return relative === 'index.md'
    ? branchLink(branch)
    : `/docs/${branch}/${relative.replace(/\.md$/, '')}`
}

function sidebarItems(sourceRoot, branch) {
  const preferredFiles = branch === 'moment'
    ? [
        'index.md',
        'launching-apps.md',
        'navigation-handle.md',
        'moment-arc.md',
        'notifications.md',
        'recents-gesture.md',
        'multiple-windows.md',
        'move-and-resize.md',
        'controls.md',
        'compact-mode.md',
        'landscape.md',
        'back.md',
        'settings.md',
        'debugging.md'
      ]
    : []

  return markdownFiles(sourceRoot)
    .map((file) => path.relative(sourceRoot, file))
    .sort((left, right) => {
      const leftIndex = preferredFiles.indexOf(left)
      const rightIndex = preferredFiles.indexOf(right)
      return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex)
        - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex)
        || left.localeCompare(right)
    })
    .map((file) => {
      const content = fs.readFileSync(path.join(sourceRoot, file), 'utf8')
      const title = branch === 'uwuBackGroundManager' && file === 'index.md'
        ? '文档'
        : branch === 'uwuBackGroundManager' && file === 'english.md'
          ? 'English'
          : file === 'recovery-crypto.md' && content.startsWith('# 新设备 Recovery data 解密适配流程')
            ? 'Recovery data 解密'
            : file === 'index.md'
              ? '概览'
              : content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? path.basename(file, '.md')

      return {
        text: title,
        link: fileLink(branch, file)
      }
    })
}

function writeSidebarFile(sidebars, manifestBranches) {
  fs.writeFileSync(
    destination('docs/.vitepress/generated-upstream-docs.ts'),
    [
      `export const upstreamDocsSidebars = ${JSON.stringify(sidebars, null, 2)}`,
      `export const upstreamManifestBranches = ${JSON.stringify(manifestBranches, null, 2)}`
    ].join('\n') + '\n'
  )
}

function clearMarkdownFiles(directory) {
  fs.mkdirSync(directory, { recursive: true })

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      fs.rmSync(path.join(directory, entry.name), { force: true })
    }
  }
}

function manifestFileName(branch) {
  const knownNames = {
    'wip/uwu-16.2-tesseract-ocr-deps': 'tesseract-ocr-deps.md'
  }

  return knownNames[branch] ?? `${branch.replaceAll('/', '-')}.md`
}

function destination(relativePath) {
  return path.join(workspace, relativePath)
}

try {
  const hiddenBranches = new Set(['AboutDevice'])
  const upstreamBranches = listBranches(docsRepository)
    .filter((branch) => branch !== 'main' && !hiddenBranches.has(branch))
  const preferredOrder = ['moment', 'uwuBackGroundManager']
  const docsBranches = [
    ...preferredOrder.filter((branch) => upstreamBranches.includes(branch)),
    ...upstreamBranches
      .filter((branch) => !preferredOrder.includes(branch))
      .sort((left, right) => left.localeCompare(right))
  ]
  const docsSidebars = []

  for (const branch of hiddenBranches) {
    fs.rmSync(branchDirectory(branch), { recursive: true, force: true })
  }

  for (const branch of docsBranches) {
    const cloneDirectory = `docs-${branch.replaceAll('/', '-')}`
    const upstream = cloneBranch(docsRepository, branch, cloneDirectory)
    const branchDestination = branchDirectory(branch)

    if (branch === 'uwuBackGroundManager') {
      fs.rmSync(branchDestination, { recursive: true, force: true })
      fs.mkdirSync(branchDestination, { recursive: true })
      copyMarkdownIfPresent(
        upstream,
        'CN.md',
        path.join(branchDestination, 'index.md'),
        [['./README.md', './english']]
      )
      copyMarkdownIfPresent(
        upstream,
        'README.md',
        path.join(branchDestination, 'english.md'),
        [
          [/\[English\]\(\.\/README\.md\)\s*\|\s*\[简体中文\]\(\.\/CN\.md\)/g, ''],
          ['./CN.md', './']
        ]
      )
    } else {
      const preserved = branch === 'bringup-17'
        ? preserveSiteOnlyFiles(branchDestination, ['recovery-crypto.md'])
        : new Map()
      replaceMarkdownDirectory(upstream, branchDestination)
      if (branch === 'uni') {
        const index = path.join(branchDestination, 'index.md')
        fs.writeFileSync(index, addSiteOnlyUniChart(fs.readFileSync(index, 'utf8')))
      }
      if (branch === 'bringup-17') {
        restoreSiteOnlyFiles(branchDestination, preserved)
      }
    }

    const items = sidebarItems(branchDestination, branch)
    if (items.length === 0) continue

    docsSidebars.push({
      text: branch,
      link: branchLink(branch),
      collapsed: false,
      items
    })
  }

  const manifestBranches = listBranches(manifestsRepository)
    .sort((left, right) => left.localeCompare(right))
  const manifests = manifestBranches.map((branch) => ({
    branch,
    relativeDestination: path.join(
      'docs',
      'guide',
      'platform-manifests',
      manifestFileName(branch)
    )
  }))

  const manifestSources = []
  for (const { branch, relativeDestination } of manifests) {
    const cloneDirectory = `manifests-${branch.replaceAll('/', '-')}`
    const manifest = cloneBranch(manifestsRepository, branch, cloneDirectory)
    manifestSources.push({ manifest, relativeDestination })
  }

  clearMarkdownFiles(destination(path.join('docs', 'guide', 'platform-manifests')))

  for (const { manifest, relativeDestination } of manifestSources) {
    copyMarkdownIfPresent(manifest, 'README.md', destination(relativeDestination))
  }

  writeSidebarFile(docsSidebars, manifests.map(({ branch, relativeDestination }) => ({
    text: branch,
    file: path.basename(relativeDestination, '.md')
  })))
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
