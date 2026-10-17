import { defineConfig, type DefaultTheme } from 'vitepress'
import {
  upstreamDocsSidebars,
  upstreamManifestBranches
} from './generated-upstream-docs'

const githubUrl = 'https://github.com/UwUniverse'

function normalizeBase(value: string | undefined) {
  const trimmed = value?.trim() ?? ''
  if (!trimmed || trimmed === '/') return '/'
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}/`
}

const base = normalizeBase(process.env.VITEPRESS_BASE)

const docsSidebar = upstreamDocsSidebars

const localizedDocsText = {
  en: {
    '/docs/bringup-17/': ['Bring-up guide', 'Overview'],
    '/docs/bringup-17/recovery-crypto': 'Recovery data decryption',
    '/docs/moment/': ['Moment', 'Overview'],
    '/docs/moment/launching-apps': 'Launch apps',
    '/docs/moment/navigation-handle': 'Double-tap navigation bar',
    '/docs/moment/moment-arc': 'MomentArc',
    '/docs/moment/notifications': 'Open notifications',
    '/docs/moment/recents-gesture': 'Swipe up in Recents',
    '/docs/moment/multiple-windows': 'Multiple windows and focus',
    '/docs/moment/move-and-resize': 'Move and resize',
    '/docs/moment/controls': 'Controls menu',
    '/docs/moment/compact-mode': 'Compact mode',
    '/docs/moment/landscape': 'Landscape support',
    '/docs/moment/back': 'Back action',
    '/docs/moment/settings': 'Settings and scope',
    '/docs/moment/debugging': 'Debug commands',
    '/docs/uwuBackGroundManager/': ['uwuBackGroundManager', 'Documentation'],
    '/docs/ClipboardAccess/': ['Clipboard access', 'Overview'],
    '/docs/CustomFonts/': ['Custom fonts', 'Overview'],
    '/docs/ExternalDesktop/': ['External desktop', 'Overview'],
    '/docs/Kotj/': ['Kotj', 'Overview'],
    '/docs/LauncherAtAGlance/': ['Launcher at a glance', 'Overview'],
    '/docs/MaintainerMetadata/': ['Device maintainer metadata', 'Overview'],
    '/docs/PerAppVolume/': ['Per-app volume', 'Overview'],
    '/docs/SystemIcons/': ['System icons', 'Overview'],
    '/docs/uni/': ['Uni build system', 'Overview'],
    '/docs/appjumpinjection/': ['App jump injection', 'Overview'],
    '/docs/AppSensorPolicy/': ['App sensor access', 'Overview'],
    '/docs/Prism/': ['Prism', 'Overview'],
    '/docs/SmartSuggestions/': ['Smart suggestions', 'Overview'],
    '/docs/SmartSuggestions/clipboard-apps': 'Clipboard app suggestions',
    '/docs/SmartSuggestions/music': 'Music suggestions',
    '/docs/SmartSuggestions/sms-codes': 'SMS code suggestions',
    '/docs/SmartSuggestions/torch': 'Flashlight suggestions',
    '/docs/soong-only/': ['Soong-only', 'Overview'],
    '/docs/soong-only/build-flow': 'Soong-only build flow',
    '/docs/soong-only/image-generation': 'Soong-only image generation',
    '/docs/soong-only/uwu_kernel/configuration': 'uwu_kernel configuration reference',
    '/docs/soong-only/uwu_kernel/index': 'uwu_kernel build system',
    '/docs/soong-only/uwu_kernel/migration': 'Migrating from Make kernel builds to uwu_kernel',
    '/docs/soong-only/uwu_kernel/outputs': 'uwu_kernel outputs and dependencies',
    '/docs/soong-only/uwu_kernel/troubleshooting': 'uwu_kernel troubleshooting',
    '/docs/soong-only/validation': 'Soong-only build validation',
    '/docs/StatusBarLyric/': ['StatusBarLyric', 'Overview']
  },
  'zh-tw': {
    '/docs/bringup-17/': ['裝置移植指南', '概覽'],
    '/docs/bringup-17/recovery-crypto': 'Recovery data 解密',
    '/docs/moment/': ['Moment', '概覽'],
    '/docs/moment/launching-apps': '啟動應用程式',
    '/docs/moment/navigation-handle': '導覽列雙擊',
    '/docs/moment/moment-arc': 'MomentArc',
    '/docs/moment/notifications': '開啟通知',
    '/docs/moment/recents-gesture': '最近工作上滑手勢',
    '/docs/moment/multiple-windows': '多視窗與焦點',
    '/docs/moment/move-and-resize': '移動與縮放',
    '/docs/moment/controls': '操作選單',
    '/docs/moment/compact-mode': '摺疊模式',
    '/docs/moment/landscape': '橫向螢幕適配',
    '/docs/moment/back': '返回操作',
    '/docs/moment/settings': '設定與適用範圍',
    '/docs/moment/debugging': '除錯指令',
    '/docs/uwuBackGroundManager/': ['uwuBackGroundManager', '文件'],
    '/docs/ClipboardAccess/': ['剪貼簿存取權限', '概覽'],
    '/docs/CustomFonts/': ['自訂字型', '概覽'],
    '/docs/ExternalDesktop/': ['外接螢幕桌面', '概覽'],
    '/docs/Kotj/': ['Kotj', '概覽'],
    '/docs/LauncherAtAGlance/': ['Launcher 一覽', '概覽'],
    '/docs/MaintainerMetadata/': ['裝置維護者資訊', '概覽'],
    '/docs/PerAppVolume/': ['個別應用程式音量', '概覽'],
    '/docs/SystemIcons/': ['系統小圖示', '概覽'],
    '/docs/uni/': ['Uni 建置系統', '概覽'],
    '/docs/appjumpinjection/': ['應用程式跳轉控制', '概覽'],
    '/docs/AppSensorPolicy/': ['應用程式感測器存取', '概覽'],
    '/docs/Prism/': ['Prism', '概覽'],
    '/docs/SmartSuggestions/': ['智慧建議', '概覽'],
    '/docs/SmartSuggestions/clipboard-apps': '剪貼簿應用程式建議',
    '/docs/SmartSuggestions/music': '音樂建議',
    '/docs/SmartSuggestions/sms-codes': 'SMS 驗證碼建議',
    '/docs/SmartSuggestions/torch': '手電筒建議',
    '/docs/soong-only/': ['Soong-only', '概覽'],
    '/docs/soong-only/build-flow': 'Soong-only 建置流程',
    '/docs/soong-only/image-generation': 'Soong-only 映像檔生成',
    '/docs/soong-only/uwu_kernel/configuration': 'uwu_kernel 設定參考',
    '/docs/soong-only/uwu_kernel/index': 'uwu_kernel 建置系統',
    '/docs/soong-only/uwu_kernel/migration': '從 Make 核心建置遷移至 uwu_kernel',
    '/docs/soong-only/uwu_kernel/outputs': 'uwu_kernel 輸出與相依性',
    '/docs/soong-only/uwu_kernel/troubleshooting': 'uwu_kernel 疑難排解',
    '/docs/soong-only/validation': 'Soong-only 建置驗證',
    '/docs/StatusBarLyric/': ['StatusBarLyric', '概覽']
  }
} as const

function localizeDocsSidebar(locale: 'en' | 'zh-tw') {
  const labels = localizedDocsText[locale]
  const prefix = `/${locale}`

  function visit(items: typeof docsSidebar): typeof docsSidebar {
    return items.flatMap((item) => {
      if (item.link?.endsWith('/uwuBackGroundManager/english')) return []

      const isDocLink = item.link?.startsWith('/docs/')
      const label = item.link ? labels[item.link as keyof typeof labels] : undefined
      const text = Array.isArray(label)
        ? label[item.items ? 0 : 1]
        : label ?? item.text

      return [{
        ...item,
        text: isDocLink ? text : item.text,
        link: isDocLink ? `${prefix}${item.link}` : item.link,
        items: item.items ? visit(item.items as typeof docsSidebar) : item.items
      }]
    })
  }

  return visit(docsSidebar)
}

const traditionalDocsSidebar = localizeDocsSidebar('zh-tw')
const englishDocsSidebar = localizeDocsSidebar('en')

const manifestItems = upstreamManifestBranches.map(({ text, file }) => ({
  text,
  link: `/guide/platform-manifests/${file}`
}))

const traditionalManifestItems = upstreamManifestBranches.map(({ text, file }) => ({
  text,
  link: `/zh-tw/guide/platform-manifests/${file}`
}))

const englishManifestItems = upstreamManifestBranches.map(({ text, file }) => ({
  text,
  link: `/en/guide/platform-manifests/${file}`
}))

const manifestSidebar = {
  text: 'platform_manifests',
  collapsed: false,
  items: manifestItems
}

const traditionalManifestSidebar = {
  text: 'platform_manifests',
  collapsed: false,
  items: traditionalManifestItems
}

const englishManifestSidebar = {
  text: 'Platform manifests',
  collapsed: false,
  items: englishManifestItems
}

const issueSidebar = {
  text: 'Issue',
  collapsed: false,
  items: [
    { text: 'WebSite-issue', link: '/issues/website/' },
    { text: 'Github issue', link: '/issues/github/' }
  ]
}

const traditionalIssueSidebar = {
  text: '議題',
  collapsed: false,
  items: [
    { text: 'WebSite-issue', link: '/zh-tw/issues/website/' },
    { text: 'Github issue', link: '/zh-tw/issues/github/' }
  ]
}

const englishIssueSidebar = {
  text: 'Issue',
  collapsed: false,
  items: [
    { text: 'WebSite-issue', link: '/en/issues/website/' },
    { text: 'Github issue', link: '/en/issues/github/' }
  ]
}

const baseTheme: DefaultTheme.Config = {
  siteTitle: 'uwuAOSP',
  socialLinks: [{ icon: 'github', link: githubUrl }],
  footer: {
    message: '<a href="https://www.gnu.org/licenses/gpl-3.0.html" target="_blank" rel="noreferrer">GPL-3.0 Licensed</a>',
    copyright: 'Copyright © 2026 UwUniverse'
  },
  i18nRouting: true,
  sidebar: {
    '/guide/': [
      {
        text: '开始使用',
        items: [{ text: '快速开始', link: '/guide/' }]
      },
      manifestSidebar
    ],
    '/issues/': [issueSidebar]
  }
}

const simplifiedChineseTheme: DefaultTheme.Config = {
  ...baseTheme,
  nav: [
    { text: '更新日志', link: '/blog/' },
    { text: '文档', link: '/docs/' },
    { text: '快速开始', link: '/guide/' },
    { text: '功能演示', link: '/demo/' },
    { text: '用户交流', link: '/community/' },
    { text: 'Issue', link: '/issues/website/' }
  ],
  langMenuLabel: '切换语言',
  darkModeSwitchLabel: '外观',
  lightModeSwitchTitle: '切换到浅色模式',
  darkModeSwitchTitle: '切换到深色模式',
  sidebarMenuLabel: '菜单',
  returnToTopLabel: '回到顶部',
  sidebar: {
    '/guide/': [
      {
        text: '开始使用',
        items: [{ text: '快速开始', link: '/guide/' }]
      },
      manifestSidebar
    ],
    '/docs/': docsSidebar,
    '/docs/main/': docsSidebar,
    '/docs/moment/': docsSidebar,
    '/docs/uwuBackGroundManager/': docsSidebar,
    '/issues/': [issueSidebar]
  }
}

const traditionalChineseTheme: DefaultTheme.Config = {
  ...baseTheme,
  nav: [
    { text: '更新日誌', link: '/zh-tw/blog/' },
    { text: '文件', link: '/zh-tw/docs/' },
    { text: '快速開始', link: '/zh-tw/guide/' },
    { text: '功能展示', link: '/zh-tw/demo/' },
    { text: '使用者交流', link: '/zh-tw/community/' },
    { text: '議題', link: '/zh-tw/issues/website/' }
  ],
  langMenuLabel: '切換語言',
  darkModeSwitchLabel: '外觀',
  lightModeSwitchTitle: '切換到淺色模式',
  darkModeSwitchTitle: '切換到深色模式',
  sidebarMenuLabel: '選單',
  returnToTopLabel: '回到頂部',
  outlineTitle: '本頁目錄',
  sidebar: {
    '/zh-tw/guide/': [
      {
        text: '開始使用',
        items: [{ text: '快速開始', link: '/zh-tw/guide/' }]
      },
      traditionalManifestSidebar
    ],
    '/zh-tw/docs/': traditionalDocsSidebar,
    '/zh-tw/docs/main/': traditionalDocsSidebar,
    '/zh-tw/docs/moment/': traditionalDocsSidebar,
    '/zh-tw/docs/uwuBackGroundManager/': traditionalDocsSidebar,
    '/zh-tw/issues/': [traditionalIssueSidebar]
  }
}

const englishTheme: DefaultTheme.Config = {
  ...baseTheme,
  nav: [
    { text: 'Blog', link: '/en/blog/' },
    { text: 'Docs', link: '/en/docs/' },
    { text: 'Quick start', link: '/en/guide/' },
    { text: 'Feature demo', link: '/en/demo/' },
    { text: 'Community', link: '/en/community/' },
    { text: 'Issue', link: '/en/issues/website/' }
  ],
  langMenuLabel: 'Change language',
  darkModeSwitchLabel: 'Appearance',
  lightModeSwitchTitle: 'Switch to light theme',
  darkModeSwitchTitle: 'Switch to dark theme',
  sidebarMenuLabel: 'Menu',
  returnToTopLabel: 'Return to top',
  sidebar: {
    '/en/guide/': [
      {
        text: 'Get started',
        items: [{ text: 'Quick start', link: '/en/guide/' }]
      },
      englishManifestSidebar
    ],
    '/en/docs/': englishDocsSidebar,
    '/en/docs/main/': englishDocsSidebar,
    '/en/docs/moment/': englishDocsSidebar,
    '/en/docs/uwuBackGroundManager/': englishDocsSidebar,
    '/en/issues/': [englishIssueSidebar]
  }
}

export default defineConfig({
  base,
  title: 'uwuAOSP',
  description: 'uwuAOSP',
  head: [
    ['link', { rel: 'icon', type: 'image/png', href: `${base}turtle-cheese-wedge.png` }]
  ],
  themeConfig: simplifiedChineseTheme,
  locales: {
    root: {
      label: '简体中文',
      lang: 'zh-CN',
      themeConfig: simplifiedChineseTheme
    },
    'zh-tw': {
      label: '繁體中文',
      lang: 'zh-TW',
      themeConfig: traditionalChineseTheme
    },
    en: {
      label: 'English',
      lang: 'en-US',
      themeConfig: englishTheme
    }
  }
})
