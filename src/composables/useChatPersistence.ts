// =============================================================================
// 数据持久化(useChatPersistence)
// -----------------------------------------------------------------------------
//   - 介质:IndexedDB(库 endfield-baker-v1,单 objectStore "data")
//   - 自动保存:deep watch(cards / myIdentity / adminGender)→ nextTick → 300ms 防抖 →
//     深拷贝(JSON 往返)写库;运行时态(activeSub/playedCounts/…)不持久化
//   - 启动恢复:loadProject() 读取并校验,失败/超时静默回退初始数据,不阻塞渲染
//   - 导出/导入:lz-string 压缩 JSON 单文件(.baker),手写类型守卫校验 + 白名单净化
//   - 结构版本:库名后缀(endfield-baker-v1) + 库内 version 记录"双保险"
// =============================================================================
import { watch } from 'vue'
import lzString from 'lz-string'
import { useChatStore } from '../stores/chat'
import { CHARACTERS, MINE_AVATAR_FEMALE_URL, MINE_AVATAR_URL } from '../constants/character'
import { CHAT_IMAGE } from '../constants/design'
import type { Card, ChatMessage, Conversation, PlayerChoice } from '../types/chat'

const { compressToUint8Array, decompressFromUint8Array } = lzString

const DB_NAME = 'endfield-baker-v1'
const STORE_NAME = 'data'
const KEY_CARDS = 'cards'
const KEY_IDENTITY = 'myIdentity'
const KEY_ADMIN_GENDER = 'adminGender'
const KEY_VERSION = 'version'

/** 写库防抖窗口(ms):消息含 dataURL 图片,防高频序列化大对象 */
const SAVE_DEBOUNCE_MS = 300
/** 打开数据库超时(ms):首屏等待上限,超时按失败静默处理 */
const DB_TIMEOUT_MS = 8000

/** 工程文件版本号(结构变更时升版本并做迁移) */
export const PROJECT_VERSION = 2
/** 导出文件扩展名(本工具专属备份格式,非通用格式) */
export const EXPORT_FILE_EXT = '.baker'

/** 我方身份(与 store.myIdentity 同构) */
export interface IdentityData {
  name: string
  avatar: string
}

/** 工程文件序列化结构 */
export interface ProjectPayload {
  version: number
  cards: Card[]
  myIdentity: IdentityData
  adminGender: 'male' | 'female'
}

// ---- 类型守卫(手写校验,不引第三方校验库) -----------------------------------
function isPlayerChoice(v: unknown): v is PlayerChoice {
  if (!v || typeof v !== 'object') return false
  const c = v as Record<string, unknown>
  return (
    typeof c.label === 'string' &&
    (c.id === undefined || typeof c.id === 'string' || typeof c.id === 'number') &&
    (c.text === undefined || typeof c.text === 'string')
  )
}

function isChatMessage(v: unknown): v is ChatMessage {
  if (!v || typeof v !== 'object') return false
  const m = v as Record<string, unknown>
  return (
    typeof m.id === 'number' &&
    (m.side === 'other' || m.side === 'mine') &&
    typeof m.text === 'string' &&
    (m.image === undefined || typeof m.image === 'string') &&
    (m.imageW === undefined || typeof m.imageW === 'number') &&
    (m.imageH === undefined || typeof m.imageH === 'number') &&
    (m.speakerName === undefined || typeof m.speakerName === 'string') &&
    (m.speakerAvatar === undefined || typeof m.speakerAvatar === 'string') &&
    (m.choices === undefined || (Array.isArray(m.choices) && m.choices.every(isPlayerChoice))) &&
    (m.centered === undefined || typeof m.centered === 'boolean') &&
    (m.panel === undefined || typeof m.panel === 'boolean') &&
    (m.panelIcon === undefined || typeof m.panelIcon === 'number') &&
    (m.panelBarColor === undefined || typeof m.panelBarColor === 'number') &&
    (m.panelDecoAlt === undefined || typeof m.panelDecoAlt === 'boolean')
  )
}

function isConversation(v: unknown): v is Conversation {
  if (!v || typeof v !== 'object') return false
  const c = v as Record<string, unknown>
  return (
    typeof c.name === 'string' &&
    Array.isArray(c.messages) &&
    c.messages.every(isChatMessage) &&
    (c.customTitle === undefined || typeof c.customTitle === 'string')
  )
}

function isCard(v: unknown): v is Card {
  if (!v || typeof v !== 'object') return false
  const c = v as Record<string, unknown>
  return Array.isArray(c.conversations) && c.conversations.length >= 1 && c.conversations.every(isConversation)
}

/** 校验任意值是否为卡片树(导出给外部校验用) */
export function isCards(v: unknown): v is Card[] {
  return Array.isArray(v) && v.every(isCard)
}

/** 校验任意值是否为我方身份 */
export function isIdentityData(v: unknown): v is IdentityData {
  if (!v || typeof v !== 'object') return false
  const i = v as Record<string, unknown>
  return typeof i.name === 'string' && typeof i.avatar === 'string'
}

// ---- 白名单净化(重建纯对象,剔除未知字段) -----------------------------------
function sanitizePlayerChoice(c: PlayerChoice): PlayerChoice {
  const out: PlayerChoice = { label: c.label }
  if (c.id !== undefined) out.id = c.id
  if (c.text !== undefined) out.text = c.text
  return out
}

// 白名单净化:重建纯对象,剔除未知字段。
// 注意:此处透传的字段集合必须与 isChatMessage 校验集合一致,且等于 ChatMessage
// 的全部可选字段——新增模型字段时,校验器与净化器必须同步补充(历史教训:
// panel 字段曾漏加,导致该消息刷新/导入后被静默降级为普通消息)。
function sanitizeChatMessage(m: ChatMessage): ChatMessage {
  const out: ChatMessage = { id: m.id, side: m.side, text: m.text }
  if (m.image !== undefined) {
    out.image = m.image
    // 图片消息必须携带显示尺寸,缺失/非法时回退设计稿上限,避免 NaN 布局
    out.imageW = typeof m.imageW === 'number' && m.imageW > 0 ? m.imageW : CHAT_IMAGE.w
    out.imageH = typeof m.imageH === 'number' && m.imageH > 0 ? m.imageH : CHAT_IMAGE.h
  }
  if (m.speakerName !== undefined) {
    // 头像 URL 会随素材版本变化(如 png→webp、改分辨率重打包),旧库里的 URL
    // 可能已失效。speakerName 命中内置角色(含管理员)时重新解析为当前本地资源
    // URL;未知名保留原值(可能为自定义/NPC 头像,无法按名解析)。
    const c = CHARACTERS.find((x) => x.name === m.speakerName)
    out.speakerName = m.speakerName
    if (c) out.speakerAvatar = c.avatar
    else if (m.speakerAvatar !== undefined) out.speakerAvatar = m.speakerAvatar
  } else if (m.speakerAvatar !== undefined) {
    out.speakerAvatar = m.speakerAvatar
  }
  if (m.choices !== undefined) out.choices = m.choices.map(sanitizePlayerChoice)
  if (m.centered !== undefined) out.centered = m.centered
  if (m.panel !== undefined) out.panel = m.panel
  if (m.panelIcon !== undefined) out.panelIcon = m.panelIcon
  if (m.panelBarColor !== undefined) out.panelBarColor = m.panelBarColor
  if (m.panelDecoAlt !== undefined) out.panelDecoAlt = m.panelDecoAlt
  return out
}

function sanitizeConversation(c: Conversation): Conversation {
  const out: Conversation = { name: c.name, messages: c.messages.map(sanitizeChatMessage) }
  if (c.customTitle !== undefined) out.customTitle = c.customTitle
  return out
}

function sanitizeCards(cards: Card[]): Card[] {
  return cards.map((c) => ({ conversations: c.conversations.map(sanitizeConversation) }))
}

function sanitizeIdentityData(i: IdentityData): IdentityData {
  // 头像 URL 会随素材版本变化(如 png→webp),旧库里的 URL 可能已失效。
  // 已知角色名(含管理员)一律重新解析为本地当前资源 URL;未知名保留原值。
  const name = i.name
  if (name === '管理员 (男)') return { name, avatar: MINE_AVATAR_URL }
  if (name === '管理员 (女)') return { name, avatar: MINE_AVATAR_FEMALE_URL }
  const c = CHARACTERS.find((x) => x.name === name)
  if (c) return { name, avatar: c.avatar }
  return { name, avatar: i.avatar }
}

/** 管理员性别净化:仅接受 'male' | 'female',其余一律回退 'male' */
function sanitizeAdminGender(v: unknown): 'male' | 'female' {
  return v === 'female' ? 'female' : 'male'
}

// ---- 结构版本迁移 ------------------------------------------------------------
// 版本升级策略:版本不匹配不再整体丢弃旧数据,而是逐级迁移。
// 库名(endfield-baker-v1)保持不变,细粒度版本由库内 version 记录承担。
//
// 迁移器纪律(与净化器白名单同一套约束):
//   - 纯函数:输入"源版本结构"的原始 plain object,输出"下一版本结构"的原始对象
//   - 在结构校验之前运行(旧数据本身过不了新校验器),只做字段增补/改名/补默认值,
//     不做任何业务推导
//   - 新增模型字段时,校验器(isChatMessage 等)、净化器(sanitize*)与迁移器
//     三处必须同步维护(参照 panel 字段历史教训)
//   - 缺某级迁移器(升级断档)宁可拒绝加载也不猜测,避免乱读旧档
type Migrator = (raw: Record<string, unknown>) => Record<string, unknown>

/** 迁移器注册表:key = 源版本号,把该版本结构升到 version+1(逐级串联) */
const MIGRATORS: Record<number, Migrator> = {
  // 1 → 2:新增 adminGender(管理员性别)。
  // 旧数据无此字段,从身份姓名推断:身份为"管理员 (女)"视为 female,其余为默认 male。
  // 幂等:目标字段已存在(过期 version 记录导致的重复迁移)时原样返回,绝不覆盖现有值。
  1: (raw) => {
    if (raw.adminGender !== undefined) return raw
    const id = raw.myIdentity as Record<string, unknown> | undefined
    const gender = id?.name === '管理员 (女)' ? 'female' : 'male'
    return { ...raw, adminGender: gender }
  },
}

/**
 * 把原始数据从 from 版本逐级迁移到 to 版本
 *
 * @throws 缺某级迁移器时抛出,调用方据此拒绝加载而非乱读
 */
function migrateRaw(raw: unknown, from: number, to: number): unknown {
  let cur = raw
  for (let v = from; v < to; v++) {
    const mig = MIGRATORS[v]
    if (!mig) throw new Error(`缺少 ${v} → ${v + 1} 的迁移器`)
    cur = mig(cur as Record<string, unknown>)
  }
  return cur
}

// ---- IndexedDB 封装(模块级单例连接) -----------------------------------------
let dbPromise: Promise<IDBDatabase> | null = null

/**
 * 是否禁止自动写入(库内结构版本高于本应用版本时置真)。
 *
 * 数据来自更新版本:本应静默回退初始数据,若此时任何 store 变更触发 auto-save,
 * 会把含未知字段的新数据整体覆写成旧格式 → 不可逆丢失。置真后 debounceWrite
 * 跳过写库,直到用户升级回新版本再正常读写,旧数据始终完整保留。
 */
let blockWrites = false

function getDb(): Promise<IDBDatabase> {
  // 打开失败时置回 null,让后续写入重新尝试——否则一次超时/占用会让本次会话内
  // 所有自动保存静默失败(module 级 promise 缓存 rejected 后无法自行恢复)。
  if (!dbPromise) {
    dbPromise = openDb().catch((err) => {
      dbPromise = null
      throw err
    })
  }
  return dbPromise
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME)
    let settled = false
    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error('打开数据库超时'))
    }, DB_TIMEOUT_MS)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => {
      if (settled) {
        request.result.close()
        return
      }
      settled = true
      window.clearTimeout(timer)
      resolve(request.result)
    }
    request.onerror = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      reject(request.error ?? new Error('打开数据库失败'))
    }
    request.onblocked = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      reject(new Error('数据库被占用'))
    }
  })
}

function putRecord(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('写入失败'))
    tx.onabort = () => reject(tx.error ?? new Error('写入中止'))
  })
}

function getRecord(db: IDBDatabase, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('读取失败'))
  })
}

// ---- 导出 / 导入序列化 ------------------------------------------------------
/** 序列化卡片树 + 身份 + 管理员性别为压缩字节(与 deserializeProject 对称,内部先白名单净化) */
export function serializeProject(
  cards: Card[],
  myIdentity: IdentityData,
  adminGender: 'male' | 'female',
): Uint8Array {
  const payload: ProjectPayload = {
    version: PROJECT_VERSION,
    cards: sanitizeCards(cards),
    myIdentity: sanitizeIdentityData(myIdentity),
    adminGender: sanitizeAdminGender(adminGender),
  }
  return compressToUint8Array(JSON.stringify(payload))
}

/**
 * 解压并校验工程文件。
 *
 * 校验失败抛出 Error(调用方负责提示,不触碰现有数据)。
 * 版本处理:旧版本(version < 当前)经迁移器逐级升级后再校验;
 * 新版本(version > 当前)拒绝加载(无法降级);缺迁移器视为不支持。
 */
export function deserializeProject(bytes: ArrayBuffer | Uint8Array): ProjectPayload {
  const text = decompressFromUint8Array(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
  if (!text) throw new Error('文件内容无法解压')
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('文件不是有效的 JSON 数据')
  }
  if (!raw || typeof raw !== 'object') throw new Error('文件结构无效')
  const payload = raw as Record<string, unknown>
  const fileVersion = payload.version
  if (typeof fileVersion !== 'number') throw new Error('文件版本无效')
  if (fileVersion > PROJECT_VERSION) {
    throw new Error(`文件来自更新版本:${fileVersion}`)
  }
  let migrated: Record<string, unknown> = payload
  if (fileVersion < PROJECT_VERSION) {
    try {
      migrated = migrateRaw(payload, fileVersion, PROJECT_VERSION) as Record<string, unknown>
    } catch {
      throw new Error(`不支持的文件版本:${fileVersion}`)
    }
  }
  if (!isCards(migrated.cards)) throw new Error('卡片数据无效')
  if (!isIdentityData(migrated.myIdentity)) throw new Error('身份数据无效')
  return {
    version: PROJECT_VERSION,
    cards: sanitizeCards(migrated.cards as Card[]),
    myIdentity: sanitizeIdentityData(migrated.myIdentity as IdentityData),
    adminGender: sanitizeAdminGender(migrated.adminGender),
  }
}

function timestamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** 序列化 + 压缩 + 下载 .baker 文件 */
export function downloadProject(
  cards: Card[],
  myIdentity: IdentityData,
  adminGender: 'male' | 'female',
): void {
  const bytes = new Uint8Array(serializeProject(cards, myIdentity, adminGender))
  const blob = new Blob([bytes], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `BAKER-${timestamp()}${EXPORT_FILE_EXT}`
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 立即 revoke 在个别浏览器会中断正在进行的下载,延后到本轮事件循环后再释放
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

// ---- 持久化生命周期 ---------------------------------------------------------
/**
 * 注册自动保存并返回启动恢复函数。
 *
 * 需在应用挂载前调用(如 main.ts),保证:
 *   - 恢复数据先于首帧渲染,不出现"初始数据 → 已存数据"跳变
 *   - deep watch 对 cards / myIdentity 的修改自动落库
 */
export function useChatPersistence(store: ReturnType<typeof useChatStore>) {
  const debounceWrite = (key: string, get: () => unknown) => {
    let timer: number | undefined
    return () => {
      if (blockWrites) return
      window.clearTimeout(timer)
      timer = window.setTimeout(async () => {
        try {
          const db = await getDb()
          await putRecord(db, key, JSON.parse(JSON.stringify(get())))
          // 结构版本随数据一起落库,保证库内 version 记录 = 写出该份数据的代码版本
          if (KEY_VERSION !== key) await putRecord(db, KEY_VERSION, PROJECT_VERSION)
        } catch (err) {
          console.warn(`[persist] 写入 ${key} 失败`, err)
        }
      }, SAVE_DEBOUNCE_MS)
    }
  }

  const scheduleCards = debounceWrite(KEY_CARDS, () => store.cards)
  const scheduleIdentity = debounceWrite(KEY_IDENTITY, () => store.myIdentity)
  const scheduleAdminGender = debounceWrite(KEY_ADMIN_GENDER, () => store.adminGender)

  // 保存 watch 句柄,供 HMR / 测试场景调用 disposeWatchers 清理。
  // 生产环境 main.ts 单次调用不清理,组件卸载时整个应用销毁,无内存泄漏。
  const unwatchCards = watch(() => store.cards, scheduleCards, { deep: true })
  const unwatchIdentity = watch(() => store.myIdentity, scheduleIdentity, { deep: true })
  const unwatchAdminGender = watch(() => store.adminGender, scheduleAdminGender)
  // 恢复后不再触发自动保存的 nextTick 竞态(写入本身防抖,无副作用)

  /** 停止自动保存监听(HMR 重载 / 测试 teardown 调用) */
  function disposeWatchers() {
    unwatchCards()
    unwatchIdentity()
    unwatchAdminGender()
  }

  /**
   * 从 IndexedDB 恢复数据。
   *
   * 失败 / 超时静默回退初始数据,绝不抛出。
   * 库内 version 记录为"双保险":库名自带后缀代号(endfield-baker-v1),
   * 内部再记一份结构版本。
   *   - 版本更高(数据来自更新版本):无法降级,静默回退初始数据
   *   - 版本更低:经迁移器逐级升级后再校验恢复,恢复后 store 变更触发
   *     deep watch 自动回写,DB 的 version 记录随之升到当前版本
   *   - 无 version 记录:视为 version 1(唯一历史格式,兼容 .baker 时期数据)
   */
  async function loadProject(): Promise<void> {
    try {
      const db = await getDb()
      const [cardsRaw, identityRaw, versionRaw, adminGenderRaw] = await Promise.all([
        getRecord(db, KEY_CARDS),
        getRecord(db, KEY_IDENTITY),
        getRecord(db, KEY_VERSION),
        getRecord(db, KEY_ADMIN_GENDER),
      ])
      const fromVersion = typeof versionRaw === 'number' ? versionRaw : 1
      if (fromVersion > PROJECT_VERSION) {
        console.warn(`[persist] 库内结构版本 ${fromVersion} 高于本应用 ${PROJECT_VERSION}(数据来自更新版本),使用初始数据`)
        // 禁止本会话自动保存:否则首帧后任何 store 变更都会把更新版本的
        // 数据(含未知字段)整体覆写为旧格式,造成不可逆丢失。旧数据就此保留,
        // 待升级回新版本后正常读写。
        blockWrites = true
        return
      }
      let cardsData = cardsRaw
      let identityData = identityRaw
      let adminGenderData = adminGenderRaw
      if (fromVersion < PROJECT_VERSION) {
        try {
          const migrated = migrateRaw(
            { version: fromVersion, cards: cardsRaw, myIdentity: identityRaw, adminGender: adminGenderRaw },
            fromVersion,
            PROJECT_VERSION,
          ) as Record<string, unknown>
          cardsData = migrated.cards
          identityData = migrated.myIdentity
          adminGenderData = migrated.adminGender
        } catch (err) {
          console.warn('[persist] 旧版本数据迁移失败,使用初始数据', err)
          return
        }
      }
      if (isCards(cardsData)) {
        // 收敛到 store.replaceAllCards action,与 DataManagerDialog
        // 共用同一套运行时态重置逻辑,避免两处独立维护 7 个字段。
        store.replaceAllCards(sanitizeCards(cardsData))
      }
      if (isIdentityData(identityData)) {
        // 身份恢复统一走 setMyIdentity:管理员身份时同步全局性别
        // (adminGender 独立于 myIdentity,但身份恰为管理员时两者必须一致,
        //  保证刷新后性别不跳回;角色身份不受影响)。
        // 先恢复文件/库内记录的 adminGender,再 setMyIdentity:管理员名称会
        // 覆盖性别(身份优先,维持"管理员名 ↔ 性别"一致);角色身份不受影响。
        const clean = sanitizeIdentityData(identityData)
        store.adminGender = sanitizeAdminGender(adminGenderData)
        store.setMyIdentity(clean.name, clean.avatar)
      }
    } catch (err) {
      console.warn('[persist] 读取失败,使用初始数据', err)
    }
  }

  return { loadProject, disposeWatchers }
}
