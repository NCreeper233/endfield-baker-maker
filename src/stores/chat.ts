// =============================================================================
// 聊天领域 store(类型化)
// -----------------------------------------------------------------------------
// 数据结构:
//   cards: Card[]                          —— 主卡(一级卡片)
//     └─ conversations: Conversation[]     —— 子卡(二级卡片,每张主卡 ≥ 1 段)
//        └─ messages: ChatMessage[]        —— 消息列表
//
// 派生(扁平化):
//   conversations = cards.flatMap(c => c.conversations)
//   每段子对话在扁平数组中的下标即为"全局子卡索引"(activeSub)
//
// 布局算法(characterCard.ts)按每张主卡的真实子卡数量计算高度,
// 支持"主卡数量任意、每张主卡子卡数量任意(≥1)"。
// =============================================================================

import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { Card, CardIdentity, ChatMessage, Conversation, MessageSpeaker, PlayerChoice } from '../types/chat'
import {
  findCharacter,
  DEFAULT_AVATAR_URL,
  MINE_AVATAR_URL,
  MINE_AVATAR_FEMALE_URL,
  type CustomCharacter,
  type PronounGender,
} from '../constants/character'
import { MATERIALS } from '../constants/materials'
import { createInitialCards } from '../constants/initialCards'

/**
 * 按角色名查找头像 URL
 *
 * - 传 customId + 自定义注册表:先按 id 查自定义角色(重名时区分的关键)
 * - 未命中再查 character.ts 的内置干员表;都未找到回退 DEFAULT_AVATAR_URL。
 * 头像已本地托管(src/assets/avatars/,经 Vite import.meta.glob 打包)。
 *
 * @param name      角色名(对应 conversation.name / speakerName)
 * @param customId  自定义角色 id(可选;存在时优先查自定义注册表)
 * @param customList 自定义角色注册表(可选;resolveAvatar 为纯函数,注册表由调用方传入)
 * @returns         头像 URL(本地资源 / 自定义 data URL / 默认占位)
 */
function resolveAvatar(
  name: string,
  customId?: string,
  customList?: CustomCharacter[],
): string {
  if (customId && customList) {
    const c = customList.find((x) => x.id === customId)
    if (c) return c.avatar
  }
  return findCharacter(name)?.avatar ?? DEFAULT_AVATAR_URL
}

/** 是否管理员身份(管理员角色名固定为这两个) */
export function isAdminName(name: string): boolean {
  return name === '管理员 (男)' || name === '管理员 (女)'
}

/** 默认"我方身份"(管理员·男,身份缺失时的兜底) */
export const DEFAULT_MY_IDENTITY: CardIdentity = {
  name: '管理员 (男)',
  avatar: MINE_AVATAR_URL,
}

/**
 * "我"的判定谓词:两个身份是否完全一致
 *
 * 只比较 name + customId(身份键),不参与 avatar——
 * 便于用"名称 + 消息里的 speakerCustomId"与卡片身份做对拍。
 * 必须精确匹配姓名(而非 roleNameKey):管理员(男/女)虽是两个独立角色键
 * (admin:male / admin:female),但两者显示名相同("管理员"),判"我"仍需
 * 靠性别全名精确区分,不能用归一化显示名。
 */
export function identityMatches(
  a: { name: string; customId?: string },
  b: { name: string; customId?: string },
): boolean {
  return a.name === b.name && (a.customId ?? undefined) === (b.customId ?? undefined)
}

/** 取某张父卡的"我方身份"(缺失回退默认管理员·男) */
function identityOfCard(card: Card | undefined): CardIdentity {
  return card?.myIdentity ?? DEFAULT_MY_IDENTITY
}

/**
 * 按成员引用解析称呼代词(他/她/它)
 *
 * - 自定义成员(customId 存在):优先查注册表,gender 直接取自自定义角色
 * - 内置成员:查 character.ts 内置表(male / female)
 * - 都未命中返回 undefined,由调用方决定回退(子卡预览私聊默认"她")
 *
 * @param ref        成员引用(name + 可选 customId)
 * @param customList 自定义角色注册表
 */
export function genderOfRef(
  ref: ConversationMember,
  customList: CustomCharacter[],
): PronounGender | undefined {
  if (ref.customId) {
    const c = customList.find((x) => x.id === ref.customId)
    if (c) return c.gender
  }
  return findCharacter(ref.name)?.gender
}

/**
 * 对话成员引用(name + 自定义 id)
 *
 * 内置角色仅有 name;自定义角色额外携带 customId——
 * 重名时(如自定义"梨诺")靠 customId 解析头像/性别,不按名字误命中内置表。
 */
export interface ConversationMember {
  name: string
  /** 自定义角色 id(内置角色缺失) */
  customId?: string
}
/**
 * 按 id 查找自定义角色(纯函数;注册表由调用方传入)
 *
 * @param list 自定义角色注册表
 * @param id   目标 id(undefined 直接返回 undefined)
 */
function findCustomById(list: CustomCharacter[], id: string | undefined): CustomCharacter | undefined {
  if (!id) return undefined
  return list.find((c) => c.id === id)
}

/** 是否"玩家选择点"消息(mine + 携带 choices) */
export function isChoiceMessage(msg: ChatMessage): boolean {
  return msg.side === 'mine' && !!msg.choices?.length
}

/**
 * 计算"选择点组"结束下标:自 from 起连续 mine+choices 消息的下一消息下标。
 *
 * 组内所有消息合并为一个选择面板,玩家一次提交推进整组(store 与 useAutoPlay 共用)。
 *
 * @param msgs 消息数组
 * @param from 起始下标(含)
 * @returns 第一个非选择点消息的下标(无连续选择点时即 from)
 */
export function choiceGroupEnd(msgs: ChatMessage[], from: number): number {
  let end = from
  while (end < msgs.length && isChoiceMessage(msgs[end])) end++
  return end
}

/** 新增选项默认文案(label 与 text 同步) */
const DEFAULT_CHOICE_LABEL = '新选项'

/**
 * 选项 id 全局自增计数器
 *
 * 用全局自增计数器生成 id,避免基于数组下标的 id 在删除中间选项后
 * 再插入新选项时与已存在选项的 index 部分重复(尤其多次插入-删除后
 * 会造成 EditChoiceList 的 :key="choice.id" 冲突)。全局自增
 * 保证 id 永不冲突,且在选项生命周期内稳定不变。
 */
let choiceIdCounter = 0

/** 角色名称显示开关的 localStorage key(设置类数据,独立于工程数据) */
const CHAR_NAMES_STORAGE_KEY = 'endfield-baker-char-names'

/** 读取角色名称显示开关(未记录 / 读取异常回退 false) */
function readCharacterNamesToggle(): boolean {
  try {
    return localStorage.getItem(CHAR_NAMES_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * 统一"选项对象"构造工厂(PlayerChoice 唯一构造点)
 *
 * 无论"以选项发送"新建消息的首个选项,还是行内 + 号插入的新选项,
 * 都经此工厂产出,字段形状完全一致(id/label/text)。
 *
 * @param msgId 所属消息 id(保留参数,不再参与 id 生成)
 * @param index 在 choices 数组中的下标(保留参数,不再参与 id 生成)
 * @param label 选项文案(= 选中后实际发送文本)
 */
function createChoice(messageId: number, index: number, label: string): PlayerChoice {
  // 用全局自增计数器生成 id,避免基于数组下标的 id 在删除/插入后冲突
  void messageId
  void index
  return { id: `c${choiceIdCounter++}`, label, text: label }
}

/** 消息 id 自增工厂:取对话内当前最大 id + 1(所有发送入口共用) */
function nextMessageId(conv: Conversation): number {
  return conv.messages.reduce((max, m) => Math.max(max, m.id), 0) + 1
}

/**
 * 提取对话中出现的"对方"成员(按出现顺序去重)
 *
 * - 排除本卡"我方身份"(精确匹配 name + customId):我方消息 / 与身份一致的
 *   消息一律不计入成员——"我"是群聊标题的后缀(和{身份}的群聊),不是顿号列表成员
 * - other 侧消息:取 speakerName,未指定时回退 conv.name(旧数据兼容)
 * - mine 侧消息:只认显式 speakerName(旧数据无 speakerName 时**不回退**
 *   conv.name——mine 侧是"我"本人,回退会把私聊对象名错误算成成员)
 * - 身份为管理员(男或女)时,该性别的管理员经身份精确匹配被排除;
 *   身份为非管理员时,管理员(男/女)都是真实"对方"成员,可同时出现在群聊
 *   (显示名同"管理员",见 adminDisplayName),保留原名供头像/性别解析
 * - 成员带 customId(自定义角色消息的 speakerCustomId):首见即记录,
 *   同一名字若既是内置又是自定义,取首次出现的 customId(重名区分)
 *
 * 去重按身份键(memberNameKey)而非名字:同一对话内"内置梨诺"与"自定义梨诺"
 * 是两个独立成员(同名不同人),按键去重后两者并存,与跨对话的 unionMembers
 * 使用同一套去重语义;自定义与内置同名时靠 custom:${id} 键区分,可同时保留。
 */
function memberNamesOf(conv: Conversation, identity: CardIdentity): ConversationMember[] {
  const seen = new Set<string>()
  const list: ConversationMember[] = []
  for (const msg of conv.messages) {
    // mine 侧:仅显式 speakerName 参与;other 侧:可回退会话名
    const name = msg.side === 'mine' ? msg.speakerName : msg.speakerName ?? conv.name
    if (!name) continue
    // 与卡片身份精确一致 = "我",不进入成员
    if (identityMatches({ name, customId: msg.speakerCustomId }, identity)) continue
    const key = memberNameKey({ name, customId: msg.speakerCustomId })
    if (!seen.has(key)) {
      seen.add(key)
      list.push({ name, customId: msg.speakerCustomId })
    }
  }
  return list
}

/**
 * 卡片级成员并集(保留首次出现顺序去重)
 *
 * 一张父卡 = 一个会话组:所有子对话的成员取并集,父级卡片与全部子对话
 * 共享同一标题/头像(群聊判定以卡片为单位)。customId 首次出现保留。
 *
 * 去重按身份键(memberNameKey)而非名字:管理员男/女是独立键
 * ('admin:male' / 'admin:female'),两者可同时成为群聊成员
 * (显示名同"管理员",见 adminDisplayName);自定义角色与内置角色
 * 同名时靠 custom:id 键区分,可同时保留。
 *
 * @param convs     一张父卡下的所有子对话
 * @param identity  本卡"我方身份"
 * @returns         成员引用数组(已排除"我",按出现顺序去重)
 */
function unionMembers(convs: Conversation[], identity: CardIdentity): ConversationMember[] {
  const seen = new Set<string>()
  const list: ConversationMember[] = []
  for (const conv of convs) {
    for (const member of memberNamesOf(conv, identity)) {
      const key = memberNameKey(member)
      if (!seen.has(key)) {
        seen.add(key)
        list.push(member)
      }
    }
  }
  return list
}

/**
 * 卡片"我方身份"的显示名(群聊标题"和{xx}的群聊"的后缀)
 *
 * 身份是管理员(男/女)时归一化显示"管理员"(不随性别全名变化);
 * 其他角色直接用原名(如"陈千语")。创建该卡时已定死,不再随消息变化。
 */
function identityLabel(identity: CardIdentity): string {
  return isAdminName(identity.name) ? '管理员' : identity.name
}

/**
 * 管理员姓名的**显示名**:男/女一律显示"管理员",不暴露性别全名
 *
 * 数据内部仍保留完整名(管理员 (男)/(女))用于性别/头像解析,
 * 仅渲染层经此归一化。非管理员原样返回。
 */
export function adminDisplayName(name: string): string {
  return isAdminName(name) ? '管理员' : name
}

/**
 * 角色显示名覆盖表的身份键(卡片级 roleNames 的 key)
 *
 * 四种身份互不冲突(前缀隔离):
 * - 自定义角色(customId 存在) → `custom:${id}`(重名内置/自定义靠 id 区分)
 * - 管理员男 → `admin:male`(管理员 (男) 的真实数据名)
 * - 管理员女 → `admin:female`(管理员 (女) 的真实数据名)
 * - 其余(内置角色 / NPC / 未知名) → `builtin:${name}`
 *
 * 男/女管理员是两个**独立**角色键(可各自改名、群聊里可同时成为两名成员);
 * 但显示名默认都归一化"管理员"(见 adminDisplayName / identityLabel)。
 * 裸标签 "管理员"(identityLabel 归一化后的后缀)保留 'admin' 旧键作别名,
 * 供历史数据 / 极少量裸名 speakerName 兜底,正常解析路径不传它。
 *
 * @param name     角色名
 * @param customId 自定义角色 id(可选)
 */
export function roleNameKey(name: string, customId?: string): string {
  if (customId) return `custom:${customId}`
  if (name === '管理员 (男)') return 'admin:male'
  if (name === '管理员 (女)') return 'admin:female'
  if (name === '管理员') return 'admin'
  return `builtin:${name}`
}

/** 成员引用 → 身份键(memberNameKey / speakerNameKey 共用同一套键规则) */
export function memberNameKey(m: ConversationMember): string {
  return roleNameKey(m.name, m.customId)
}

/**
 * 消息 → 身份键(供渲染层按消息定位覆盖表中的显示名)
 *
 * - mine 侧:按本卡"我方身份"派生键(管理员男/女 → 'admin:male'/'admin:female',
 *   使改名一并对群聊标题后缀生效;自定义身份 → 'custom:id';内置角色 → 'builtin:名字')。
 *   myIdentity 缺省(调用方未传)时回退 'admin:male'(兼容旧调用,默认管理员男)。
 * - other 侧:显式 speakerName 优先,否则回退会话名(旧数据无 speakerName 时);
 *   自定义角色经 speakerCustomId 定位(与内置同名区分)
 * - 匿名说话人(speakerName 为空串,由 addMessageAvatar 制造):按消息 id 独立成键
 *   'anonymous:<id>'——匿名者彼此互不知名,改其中一条的显示名不应波及其余匿名消息
 *   (resolveSpeakerName 读与 ChatArea.onNameUpdate 写都传入同一消息的 id,键才命中)
 */
export function speakerNameKey(
  msg: MessageSpeaker,
  convName: string,
  myIdentity?: CardIdentity,
): string {
  if (msg.side === 'mine') {
    return myIdentity ? roleNameKey(myIdentity.name, myIdentity.customId) : 'admin:male'
  }
  // 空串显式匿名:非 nullish,不能走 `?? convName` 回退
  if (msg.speakerName === '') return `anonymous:${msg.id ?? 'none'}`
  return roleNameKey(msg.speakerName ?? convName, msg.speakerCustomId)
}

/**
 * 对话显示标题(动态命名)
 *
 * 优先级:customTitle(用户手动编辑) > 按卡片级成员自动推导:
 *   - 无成员(只有管理员/我发言或空对话):'未命名会话'
 *   - 1 个成员:该角色名(私聊)
 *   - ≥2 个成员:成员顿号连接 + '和{personaLabel}的群聊'(群聊,例:陈千语、庄方宜和管理员的群聊)
 *
 * 成员名经 displayNameOf 应用卡片级角色显示名覆盖(customTitle 分支不参与覆盖,
 * 保证"手动自定义群聊名不跟随改名")。
 *
 * @param personaLabel "我"的身份显示名(默认"管理员";更换身份后为新角色名)
 * @param displayNameOf 角色显示名解析(未覆盖时返回原 member.name)
 */
function titleOf(
  conv: Conversation,
  members: ConversationMember[],
  personaLabel: string,
  displayNameOf: (m: ConversationMember) => string,
): string {
  // 如果成员数量 ≤1，清除过期的群聊标题
  if (members.length <= 1 && conv.customTitle) {
    // 这里需要确保不会误删用户手动设置的标题
    // 可以添加一个标记来区分自动生成和手动设置的标题
    if (!conv.customTitle) {
      conv.customTitle = undefined
    }
  }
  if (conv.customTitle) return conv.customTitle
  if (members.length === 0) return '未命名会话'
  if (members.length === 1) return displayNameOf(members[0])
  return `${members.map(displayNameOf).join('、')}和${personaLabel}的群聊`
}

/**
 * 对话头像:群聊固定群聊图,私聊取角色头像,空对话回退默认
 *
 * @param members    成员引用(自定义成员靠 customId 解析头像)
 * @param customList 自定义角色注册表(供 resolveAvatar 按 id 查询)
 */
function avatarOf(members: ConversationMember[], customList: CustomCharacter[]): string {
  if (members.length >= 2) return MATERIALS.groupAvatar
  if (members.length === 1) return resolveAvatar(members[0].name, members[0].customId, customList)
  return DEFAULT_AVATAR_URL
}

/**
 * 消息说话人头像解析(聊天区渲染 / 头像选择菜单高亮共用)
 *
 * 两条链路必须完全一致,否则编辑菜单里会出现"点开的头像没有黄圈"。
 * 优先级:
 * - mine:msg.speakerAvatar(发送时写入的身份头像)优先,缺省回退本卡身份头像
 *   (mineUrl 由调用方传本卡"我方身份"的头像)
 * - other:msg.speakerAvatar > findCharacter(msg.speakerName ?? convName) > otherUrl
 *   convName 是会话原始名(旧数据未记录 speakerName 时回退,读对话名查角色);
 *   otherUrl 是会话默认对方头像(群聊回退 NPC 默认图,不在角色表 → 无黄圈属预期)。
 *
 * @param msg         消息(speakerAvatar/speakerName/侧别)
 * @param convName    会话原始名(activeSub 对应 conversation.name)
 * @param otherUrl    other 侧默认头像(单聊角色头像 / 群聊 NPC 默认)
 * @param mineUrl     本卡"我方身份"头像(聊天区右侧气泡默认头像)
 */
function resolveMessageAvatar(
  msg: MessageSpeaker,
  convName: string,
  otherUrl: string,
  mineUrl: string,
): string {
  if (msg.side === 'mine') {
    return msg.speakerAvatar ?? mineUrl
  }
  if (msg.speakerAvatar) return msg.speakerAvatar
  const name = msg.speakerName ?? convName
  if (name) {
    const c = findCharacter(name)
    if (c) return c.avatar
  }
  return otherUrl
}

export const useChatStore = defineStore('chat', () => {
  /** 主卡数据(每张主卡下挂任意数量子卡对话) */
  // 用 createInitialCards() 的独立副本 seed,绝不直接引用 INITIAL_CARDS 常量:
  // store 增删是原地 push / splice,若与模块常量别名会互相泄漏(见 initialCards.ts)。
  const cards = ref<Card[]>(createInitialCards())

  /**
   * 自定义角色注册表(全局生效)
   *
   * - 不随某段对话存在,由角色选择面板的 + 按钮创建
   * - IndexedDB 持久化 + 随 .baker 工程导入/导出(见 useChatPersistence)
   * - 允许与内置角色重名,靠 id(customId)区分
   */
  const customCharacters = ref<CustomCharacter[]>([])

  /** 新增或覆盖自定义角色(同 id 幂等替换,保持注册表稳定) */
  function addCustomCharacter(c: CustomCharacter) {
    const i = customCharacters.value.findIndex((x) => x.id === c.id)
    if (i === -1) customCharacters.value.push(c)
    else customCharacters.value[i] = c
  }

  /**
   * 删除自定义角色(已引用的消息仍保留各自 speakerAvatar,渲染不回退)
   *
   * 同时清扫各卡片 roleNames 覆盖表中指向该角色的孤儿键(custom:<id>):
   * 角色删除后这些键永远无法再命中,却会随 .baker 导出、残留为脏数据;
   * 清空整张表时把字段置 undefined,保持数据干净。
   */
  function removeCustomCharacter(id: string) {
    customCharacters.value = customCharacters.value.filter((c) => c.id !== id)
    const orphanKey = `custom:${id}`
    for (const card of cards.value) {
      if (!card.roleNames) continue
      let removed = false
      for (const key of Object.keys(card.roleNames)) {
        if (key === orphanKey) {
          delete card.roleNames[key]
          removed = true
        }
      }
      if (removed && Object.keys(card.roleNames).length === 0) card.roleNames = undefined
    }
  }

  /** 整体替换注册表(导入 .baker 时调用,调用方负责先净化) */
  function importCustomCharacters(list: CustomCharacter[]) {
    customCharacters.value = list
  }

  /** 每张主卡的折叠状态(默认全部收起) */
  const collapsed = ref<boolean[]>(cards.value.map(() => true))

  /**
   * 扁平化后的全部子卡对话(按主卡顺序串联)
   *
   * 全局子卡索引(activeSub / playedCounts 等)均针对此扁平数组。
   */
  const conversations = computed<Conversation[]>(() =>
    cards.value.flatMap((c) => c.conversations),
  )

  /** 子卡总数 */
  const subTotal = computed(() => conversations.value.length)

  /** 当前激活的子卡全局索引(null = 未选中任何对话) */
  const activeSub = ref<number | null>(null)

  /**
   * 是否处于编辑模式
   *
   * - false(默认):播放模式,自动播放消息,选项用 ChoicePanel 弹出
   * - true       :编辑模式,全量显示消息,选项内联可编辑,气泡文字可编辑
   *
   * 切换到编辑模式:stop() 停止播放
   * 切换回播放模式:activeSub = null 回到起始页
   */
  const isEditMode = ref(false)

  /**
   * 是否显示对话内角色名称(小号灰字悬浮于带头像的气泡上方)
   *
   * 设置类数据:localStorage 独立 key 持久化(与 useCustomBackground 同类,
   * 不随 .baker 导出、不受清空对话影响)。读取异常/写入失败静默降级。
   */
  const showCharacterNames = ref(readCharacterNamesToggle())

  function toggleShowCharacterNames() {
    showCharacterNames.value = !showCharacterNames.value
    try {
      localStorage.setItem(CHAR_NAMES_STORAGE_KEY, showCharacterNames.value ? '1' : '0')
    } catch {
      // 存储失败:仅本次会话生效,刷新恢复默认,不影响主流程
      console.warn('[store] 角色名称开关保存失败,刷新后将重置')
    }
  }

  /**
   * 顶部聊天条图片下标(三图循环切换)
   *
   * 存于 store:导出模式渲染的独立 ChatArea 实例共享同一份状态,
   * 保证导出的聊天条样式与主界面当前切换到的完全一致。
   */
  const stripVariantIndex = ref(0)

  /**
   * 每张主卡的"起始全局子卡索引"(用于 activeSub → cardIndex 反查)
   *
   * 长度 = 主卡数 + 1(末位追加总和便于区间计算)。
   * 例如主卡下子卡数 [1,2,2,2,2,2],则 starts = [0,1,3,5,7,9,11]。
   */
  const cardSubStarts = computed<number[]>(() => {
    const starts: number[] = [0]
    let acc = 0
    for (const c of cards.value) {
      acc += c.conversations.length
      starts.push(acc)
    }
    return starts
  })

  /**
   * 每张主卡下的全局子卡索引区间 [start, end)
   *
   * 用于 CharacterCardItem 遍历渲染该主卡下的所有子卡。
   */
  const cardSubRanges = computed<{ start: number; count: number }[]>(() =>
    cards.value.map((_, i) => ({
      start: cardSubStarts.value[i],
      count: cardSubStarts.value[i + 1] - cardSubStarts.value[i],
    })),
  )

  /** 当前激活的主卡索引(activeSub 所属主卡;null 时为 0) */
  const activeCardIndex = computed(() => {
    if (activeSub.value === null) return 0
    for (let i = cardSubStarts.value.length - 1; i >= 0; i--) {
      if (activeSub.value >= cardSubStarts.value[i]) return i
    }
    return 0
  })

  /** 当前对话的消息列表(未选中时为空数组) */
  const messages = computed<ChatMessage[]>(() =>
    activeSub.value === null ? [] : conversations.value[activeSub.value].messages,
  )

  /**
   * 每段子对话的动态派生数据(title/avatar/members)
   *
   * 群聊判定以父级卡片为单位:members 取该卡片下**所有**子对话成员的并集
   * (一张主卡 = 一个群聊,父级卡片与全部子对话共享同一个群聊名/头像)。
   * 随消息增删实时变化:新消息改变成员构成时,标题/头像自动切换
   * (私聊 → 群聊 → 自定义名)。customTitle 存在时该子对话的 title 固定为自定义名。
   */
  const conversationMeta = computed(() =>
    cards.value.flatMap((card) => {
      // 本卡"我方身份"(缺失回退管理员·男)。卡片级成员并集(已排除"我")+
      // 卡片级"我"的身份显示名(管理员 → "管理员",其他角色 → 该角色名)。
      // 群聊标题的"和{personaLabel}的群聊"后缀 = 本卡身份,创建时已定死。
      const cardIdentity = identityOfCard(card)
      const members = unionMembers(card.conversations, cardIdentity)
      const personaLabel = identityLabel(cardIdentity)
      // 卡片级角色显示名覆盖表:改名仅改显示,不改写消息数据;
      // 同一父卡下所有会话共享同一张表(各父卡独立,互不影响)。
      const roleNames = card.roleNames ?? {}
      // 成员显示名:覆盖优先,否则原 member.name(头像解析仍按原始 name/customId,不受影响);
      // 管理员(男/女)归一化显示"管理员"(数据保留性别全名供头像/性别解析)
      const displayNameOf = (m: ConversationMember) =>
        roleNames[memberNameKey(m)] ?? adminDisplayName(m.name)
      // "我"的身份显示名同样可被覆盖(mine 侧"管理员"改名 → 群聊标题后缀跟随);
      // 用本卡真实身份名派生键(管理员 → 对应性别键),而非归一化显示标签
      // ("管理员"裸标签无法确定性别,会查不到性别专属的改名)
      const displayPersona =
        roleNames[roleNameKey(cardIdentity.name, cardIdentity.customId)] ?? personaLabel
      // 自定义群聊头像仅群聊(成员 ≥2)生效;私聊 / 未命名回退动态头像
      const isGroup = members.length >= 2
      const avatar =
        isGroup && card.groupAvatar
          ? card.groupAvatar
          : avatarOf(members, customCharacters.value)
      // 同一父卡下所有子对话共用同一套 members/persona/avatar;
      // title 额外允许各子对话用 customTitle 单独覆盖(否则即为卡片级动态群聊名)。
      return card.conversations.map((conv) => ({
        title: titleOf(conv, members, displayPersona, displayNameOf),
        avatar,
        members,
      }))
    }),
  )

  /** 当前对话的动态派生数据(null = 未选中对话) */
  const currentConversationMeta = computed(() =>
    activeSub.value === null ? null : conversationMeta.value[activeSub.value],
  )

  /** 当前对话的对方姓名(动态命名;显示在聊天条;未选中时为空串) */
  const counterpartName = computed<string>(() => currentConversationMeta.value?.title ?? '')

  /**
   * 当前对话"对方"默认头像 URL(聊天区用)
   *
   * 注意:群聊头像**只**出现在左侧父级卡片(conversationMeta.avatar),
   * 聊天区不显示群聊头像。此处规则:
   *   - 私聊(1 个成员):该角色头像
   *   - 群聊 / 空对话:回退默认头像(各消息实际头像由 speakerAvatar 逐条覆盖)
   * 切换对话时自动响应式更新。
   */
  const currentOtherAvatarUrl = computed(() => {
    const meta = currentConversationMeta.value
    if (meta && meta.members.length === 1)
      return resolveAvatar(meta.members[0].name, meta.members[0].customId, customCharacters.value)
    return DEFAULT_AVATAR_URL
  })

  // ---- 会话创作 -----------------------------------------------------------
  /**
   * 当前发送身份(name + avatar + customId)
   *
   * 由 EditModePanel 底部"我的头像"角色选择面板设置;
   * 发送消息时判定 side:与当前卡片"我方身份"精确一致 → mine,否则 → other。
   * 切换对话 / 新建对话时同步为该卡的身份(底部选择可临时覆盖,切卡后归位)。
   */
  const myIdentity = ref<CardIdentity>({ ...DEFAULT_MY_IDENTITY })

  /**
   * 设置当前发送身份(EditModePanel 角色选择面板 / 数据导入 / 恢复调用)
   *
   * 管理员身份强制使用 store 内置 URL(MINE_AVATAR_URL / MINE_AVATAR_FEMALE_URL),
   * 忽略传入的 avatar 参数(导入旧版本数据时 myIdentity.avatar 可能与当前内置
   * URL 不一致,强制覆盖最安全)。
   *
   * @param name   角色名
   * @param avatar 角色头像 URL(管理员身份时被忽略,改用内置 URL)
   * @param customId 自定义角色 id(自定义角色身份时传入,与内置角色重名区分)
   */
  function setMyIdentity(name: string, avatar: string, customId?: string) {
    if (isAdminName(name)) {
      const adminAvatar = name === '管理员 (女)' ? MINE_AVATAR_FEMALE_URL : MINE_AVATAR_URL
      myIdentity.value = { name, avatar: adminAvatar }
    } else {
      myIdentity.value = { name, avatar, customId }
    }
  }

  /** 当前激活父卡的"我方身份"(缺失回退默认管理员·男) */
  const activeCardIdentity = computed<CardIdentity>(() =>
    identityOfCard(cards.value[activeCardIndex.value]),
  )

  /** 当前激活父卡的"我方身份"头像(聊天区右侧气泡 / 头像菜单高亮解析用) */
  const activeCardIdentityAvatar = computed(() => activeCardIdentity.value.avatar)

  /**
   * 编辑模式:更换消息的说话人身份(头像选择菜单调用)
   *
   * 硬约束:管理员(mine 侧)消息不可更换,直接拒绝(不写消息、不改 myIdentity)。
   *
   * 粒度:只改目标消息所在的"说话人连击段"(run)——同一侧别、身份相同的
   * **连续**消息(身份 = speakerName ?? conv.name)。因为同一根连击段只显示
   * 一个头像,把整段一起换掉才能保证:所有可见头像依次换完后,对话名称里
   * 不再残留旧角色名(例:私聊汤汤,汤汤连发多条只露一个头像,只改单条则
   * 隐藏消息仍按旧身份算成员 → 群聊名残留"汤汤")。同时不跨段扩散:
   * 相邻 mine 消息或异身份消息会截断连击段,每个头像分别可独立控制(决策 5)。
   *
   * @param messageId 目标消息 id
   * @param name      新角色名
   * @param avatar    新角色头像 URL
   * @param customId  新角色自定义 id(内置角色 undefined)
   */
  function changeMessageIdentity(messageId: number, name: string, avatar: string, customId?: string) {
    if (activeSub.value === null) return
    const conv = conversations.value[activeSub.value]
    const msgs = conv.messages
    const i = msgs.findIndex((m) => m.id === messageId)
    if (i < 0 || msgs[i].side === 'mine') return
    const oldIdentity = msgs[i].speakerName ?? conv.name
    const inRun = (m: ChatMessage) => m.side === 'other' && (m.speakerName ?? conv.name) === oldIdentity
    let from = i
    while (from - 1 >= 0 && inRun(msgs[from - 1])) from--
    let to = i
    while (to + 1 < msgs.length && inRun(msgs[to + 1])) to++
    for (let j = from; j <= to; j++) {
      msgs[j].speakerName = name
      msgs[j].speakerAvatar = avatar
      msgs[j].speakerCustomId = customId
    }
  }

  /**
   * 编辑模式:给没有独立头像的合并消息(连续同人连发只露一个头像)单独补头像
   *
   * 默认补上 NPC 占位头像(icon_sns_npc_single_a,与未命名会话一致);
   * speakerName 置空串:空名不进入成员推导(标题不会因此带出某角色名),
   * 该消息成为独立的匿名说话人。之后点击新头像进角色菜单可换成具名角色。
   * mine 侧(管理员本人)不适用,直接拒绝。
   *
   * @param messageId 目标消息 id
   */
  function addMessageAvatar(messageId: number) {
    if (activeSub.value === null) return
    const conv = conversations.value[activeSub.value]
    const msg = conv.messages.find((m) => m.id === messageId)
    if (!msg || msg.side === 'mine') return
    msg.speakerAvatar = DEFAULT_AVATAR_URL
    msg.speakerName = ''
  }

  /**
   * 是否可在当前父卡下直接追加子会话
   *
   * 选中了子对话 且 父级卡片展开 时为 true:聊天按钮直接加子卡,不弹身份弹窗。
   */
  const canAddChild = computed(() =>
    activeSub.value !== null && !collapsed.value[activeCardIndex.value],
  )

  /**
   * 新建会话——情况 1:在选中子对话所在父卡下追加子会话
   *
   * 群聊判定 = 该卡片下所有子对话成员的并集。新子卡自动选中
   * (空对话 play 被 playedCount >= length 拦截,不会误播)。
   * 需要同步维护 playedCounts(playCounts 初始化是快照,新增必须补齐)。
   */
  function createChildConversation() {
    if (activeSub.value === null) return
    const card = cards.value[activeCardIndex.value]
    card.conversations.push({ name: '未命名会话', messages: [] })
    // playedCounts 按全局子卡索引对应,必须用 splice 在新子卡位置插入 0,
    // 否则中间卡片追加子会话时后续子卡的 playedCounts 会错位。
    const newSubIndex = cardSubStarts.value[activeCardIndex.value + 1] - 1
    playedCounts.value.splice(newSubIndex, 0, 0)
    activeSub.value = newSubIndex
  }

  /**
   * 新建会话——情况 2/3:新建独立父级"未命名会话"卡,并设置本卡"我方身份"
   *
   * identity 由创建弹窗(IdentityDialog)选择,**创建后不可修改**;
   * 缺省(直接调用不传)回退默认管理员·男。
   *
   * @param identity 本卡"我方身份"(name/avatar/customId)
   */
  function createParentConversation(identity: CardIdentity = DEFAULT_MY_IDENTITY) {
    cards.value.push({
      conversations: [{ name: '未命名会话', messages: [] }],
      myIdentity: {
        name: identity.name,
        avatar: identity.avatar,
        ...(identity.customId ? { customId: identity.customId } : {}),
      },
    })
    collapsed.value.push(false)
    playedCounts.value.push(0)
    // 依赖 conversations 计算属性已同步求值(push 后立即访问 .value 触发 lazy 求值)
    activeSub.value = conversations.value.length - 1
  }

  /**
   * 发送一条消息(编辑模式底部面板调用)
   *
   * - 空输入静默不发送(trim 后为空直接返回)
   * - side 判定:当前发送身份与卡片"我方身份"精确一致 → mine(右侧);否则 → other(左侧)
   * - asOption:以"玩家选择点"方式发送(mine + choices,播放时合并为选择面板);
   *   新消息的首个选项复用 insertChoice 统一插入逻辑(afterIndex=-1,label=输入文字)
   *   ⚠ 选项消息固定以**卡片身份**(mine 侧)发出,与底部当前发送身份解耦:
   *   选项是"玩家选择点",播放时由玩家点击 → 以卡片身份发送选中文本。
   *
   * @param text     输入框文本
   * @param asOption 是否作为选项发送
   */
  function sendMessage(text: string, asOption = false) {
    if (activeSub.value === null) return
    const trimmed = text.trim()
    if (!trimmed) return
    const conv = conversations.value[activeSub.value]
    const nextId = nextMessageId(conv)
    // 选项消息固定以卡片身份(mine 侧)发出,与 myIdentity 解耦:
    // 即使当前发送身份是某个角色,选项仍是"玩家自己"的动作
    const cardIdentity = activeCardIdentity.value
    const isMe = asOption ? true : identityMatches(myIdentity.value, cardIdentity)
    const speaker = isMe ? cardIdentity : myIdentity.value
    const msg: ChatMessage = {
      id: nextId,
      side: isMe ? 'mine' : 'other',
      text: asOption ? '' : trimmed,
      speakerName: speaker.name,
      speakerAvatar: speaker.avatar,
      speakerCustomId: speaker.customId,
    }
    if (asOption) {
      msg.choices = []
      conv.messages.push(msg)
      insertChoice(activeSub.value, nextId, -1, trimmed)
      return
    }
    conv.messages.push(msg)
  }

  /**
   * 发送图片消息(编辑模式底部面板"上传图片"按钮调用)
   *
   * 与 sendMessage 的区别:无文本校验、text 为空串、携带 image(dataURL)。
   * 渲染时显示为纯图片,无气泡。
   *
   * @param image 图片 dataURL
   * @param width 显示宽度(已按上限等比计算,不超过 CHAT_IMAGE.w)
   * @param height 显示高度(同 width)
   */
  function sendImage(image: string, width: number, height: number) {
    if (activeSub.value === null) return
    const conv = conversations.value[activeSub.value]
    const nextId = nextMessageId(conv)
    const cardIdentity = activeCardIdentity.value
    const isMe = identityMatches(myIdentity.value, cardIdentity)
    const speaker = isMe ? cardIdentity : myIdentity.value
    const msg: ChatMessage = {
      id: nextId,
      side: isMe ? 'mine' : 'other',
      text: '',
      image,
      imageW: width,
      imageH: height,
      speakerName: speaker.name,
      speakerAvatar: speaker.avatar,
      speakerCustomId: speaker.customId,
    }
    conv.messages.push(msg)
  }

  /**
   * 发送居中提示文本(编辑模式底部面板"居中文本"按钮调用)
   *
   * 与 sendMessage 的区别:text 为输入全文、居中标记 centered=true,
   * 无气泡 / 无角色归属(side 仅作占位,渲染时不显示任何人像)。
   *
   * @param text 输入框文本(trim 后不能为空)
   */
  function sendCenteredMessage(text: string) {
    if (activeSub.value === null) return
    const trimmed = text.trim()
    if (!trimmed) return
    const conv = conversations.value[activeSub.value]
    const nextId = nextMessageId(conv)
    conv.messages.push({
      id: nextId,
      side: 'mine',
      text: trimmed,
      centered: true,
    })
  }

  /**
   * 发送分段矩形面板(编辑模式底部面板"任务面板"按钮调用)
   *
   * 与 sendCenteredMessage 同性质:无气泡 / 无角色归属,水平居中;
   * 但渲染为固定尺寸(1089×78)的圆角 #2a2a2a 矩形。
   * 与居中文本的区别:text 可为空(纯色块),也可承载面板内文案。
   *
   * @param text 面板内文案(可为空串)
   */
  function sendPanelMessage(text: string) {
    if (activeSub.value === null) return
    const conv = conversations.value[activeSub.value]
    const nextId = nextMessageId(conv)
    conv.messages.push({
      id: nextId,
      side: 'mine',
      text,
      panel: true,
    })
  }

  /**
   * 删除当前选中的子对话(编辑模式底部面板"删除对话"确认后调用)
   *
   * - 父级卡片含多个子对话:只删除当前子对话,选中跳到同卡相邻段
   *   (原位置有后续段取之,否则取新末段)
   * - 父级卡片仅一个子对话:连带删除整张父卡,同时同步 collapsed /
   *   playedCounts;选中跳到下一张卡首段 → 上一张卡末段 → 全部删空为 null
   */
  function deleteActiveConversation() {
    if (activeSub.value === null) return
    const sub = activeSub.value
    const cardIndex = activeCardIndex.value
    const start = cardSubStarts.value[cardIndex]
    const count = cardSubStarts.value[cardIndex + 1] - start
    const localIdx = sub - start

    if (count > 1) {
      // 仅删除该子卡(保持父卡展开状态与其余子卡不变)
      cards.value[cardIndex].conversations.splice(localIdx, 1)
      playedCounts.value.splice(sub, 1)
      const newCount = count - 1
      activeSub.value = localIdx < newCount ? start + localIdx : start + newCount - 1
      return
    }

    // 唯一子卡:连带删除整张父卡
    cards.value.splice(cardIndex, 1)
    collapsed.value.splice(cardIndex, 1)
    playedCounts.value.splice(start, 1)
    if (cards.value.length === 0) {
      activeSub.value = null
    } else if (cardIndex < cards.value.length) {
      // 下一张主卡的首段
      activeSub.value = cardSubStarts.value[cardIndex]
    } else {
      // 删除的是最后一张主卡:取新末张主卡的末段
      activeSub.value = cardSubStarts.value[cards.value.length] - 1
    }
  }

  /**
   * 设置对话的群聊自定义名(编辑模式聊天条调用)
   *
   * 空串 / 全空白时清空 customTitle,回退到动态自动命名。
   *
   * @param subIndex 子卡全局索引
   * @param title    新对话名(空串 = 清除自定义名)
   */
  function setCustomTitle(subIndex: number, title: string) {
    const conv = conversations.value[subIndex]
    if (!conv) return
    const trimmed = title.trim()
    if (trimmed === '') {
      // 用显式赋值 undefined 替代 delete,避免 delete 在不同 reactive
      // 实现下响应式语义不一致。下游读取用 ?? / in 均兼容。
      conv.customTitle = undefined
    } else {
      conv.customTitle = trimmed
    }
  }

  /**
   * 设置某张父级卡片的自定义群聊头像(编辑模式点击父卡头像的裁剪弹窗调用)
   *
   * 头像以 dataURL 存在卡片上,随卡片持久化 / 导入导出;
   * 仅群聊(卡片级成员 ≥2)生效,私聊 / 未命名对话回退动态头像。
   * avatar 传 undefined 表示清除自定义头像,回退默认群聊图。
   *
   * @param cardIndex 父级卡片索引
   * @param avatar    自定义群聊头像 dataURL(undefined = 恢复默认)
   * @param source    裁剪前的原始源图 dataURL(与 avatar 同步保存;
   *                  再次打开弹窗预载入源图重新裁剪,避免只有裁好方的图)
   */
  function setCardGroupAvatar(cardIndex: number, avatar: string | undefined, source?: string) {
    const card = cards.value[cardIndex]
    if (!card) return
    card.groupAvatar = avatar
    // 有头像时同步记录源图(缺省回退头像本身);清除头像时一并清空源图
    card.groupAvatarSource = avatar === undefined ? undefined : source ?? avatar
  }

  /**
   * 读取某张父卡的角色显示名覆盖表(供渲染层按身份键查显示名)
   *
   * @param cardIndex 父级卡片索引
   * @returns 覆盖表(未设置时为空对象)
   */
  function roleNamesOf(cardIndex: number): Record<string, string> {
    return cards.value[cardIndex]?.roleNames ?? {}
  }

  /**
   * 设置某张父卡下某角色的显示名(编辑模式点击气泡上方角色名小字调用)
   *
   * 仅写入卡片级覆盖表(card.roleNames),不改写消息原始 speakerName 数据;
   * 显示名经 conversationMeta / resolveSpeakerName 渲染时替换,随卡片持久化 / 导入导出。
   * 空串 / 全空白 = 删除该键,回退该角色原显示名;整表清空时字段置 undefined 保持数据干净。
   *
   * @param cardIndex  父级卡片索引
   * @param key        角色身份键(roleNameKey / speakerNameKey 派生)
   * @param displayName 新显示名(空串 = 恢复默认)
   */
  function setCardRoleName(cardIndex: number, key: string, displayName: string) {
    const card = cards.value[cardIndex]
    if (!card || !key) return
    const trimmed = displayName.trim()
    if (trimmed === '') {
      if (!card.roleNames) return
      delete card.roleNames[key]
      if (Object.keys(card.roleNames).length === 0) card.roleNames = undefined
      return
    }
    if (!card.roleNames) card.roleNames = {}
    card.roleNames[key] = trimmed
  }

  /**
   * 玩家选择文本覆盖表(消息 id → 玩家选中的文本)
   *
   * 'mine' 消息携带 choices 时,运行时由玩家点击选项填充:
   *   - 不修改源消息 text(保持数据不可变,便于重放)
   *   - playedMessages / subPreviewTexts 读取时优先取覆盖表
   *   - 切换对话 / 重新播放时通过 resetChoiceTexts 清空
   */
  const choiceTexts = ref<Record<number, string>>({})

  /**
   * 当前待玩家选择的选择点组(null = 无需选择)
   *
   * 连续多条 mine+choices 消息为一组(合并为一个选择面板)。
   * useAutoPlay 预判到选择点时设置此项并暂停定时器;
   * ChoicePanel 组件据此渲染按钮(摊平组内所有 choices);
   * submitChoice 清空此项并推进播放,useAutoPlay 监听 null 变化恢复时序。
   */
  const pendingChoice = ref<{ messages: ChatMessage[] } | null>(null)

  /**
   * 取消息最终显示文本(应用玩家选择覆盖)
   *
   * @param msg 消息对象
   * @returns   玩家选择文本(若有)否则消息原文
   */
  function resolveMessageText(msg: ChatMessage): string {
    return choiceTexts.value[msg.id] ?? msg.text
  }

  /**
   * 清空玩家选择覆盖表(导入 / 清空工程时调用)
   *
   * choiceTexts 以消息 id 为键,而消息 id 在各对话内从 1 自增且不全局唯一;
   * 数据整体替换后,新数据的 id 可能与旧选择冲突,残留覆盖会盖掉新数据的真实
   * 文本。退出编辑模式虽会清空,但导入发生在编辑模式内,仍需在此显式清空。
   */
  function clearChoiceTexts() {
    choiceTexts.value = {}
  }

  /**
   * 每张主卡的干员数据(name + avatar URL)
   *
   * 取每张主卡首段子对话的动态派生 title/avatar
   * (新建会话 → "未命名会话" + 默认头像;群聊 → 群聊名 + 群聊头像)。
   */
  const cardCharacters = computed(() =>
    cards.value.map((c, i) => {
      const meta = conversationMeta.value[cardSubStarts.value[i]]
      return {
        name: meta?.title ?? c.conversations[0]?.name ?? '',
        avatar: meta?.avatar ?? resolveAvatar(c.conversations[0]?.name ?? ''),
      }
    }),
  )

  // ---- 自动播放状态 ---------------------------------------------------------
  /** 每段子对话已播放完毕的消息数(长度 = 子卡总数) */
  const playedCounts = ref<number[]>(conversations.value.map(() => 0))

  /** 当前正在播放的对话索引(null = 无播放) */
  const playingSub = ref<number | null>(null)

  /**
   * 是否处于 loading 阶段(显示 LoadingBubble 的判据)
   *
   * 为独立 ref,由 useAutoPlay 在时序中显式控制:
   *   - loading 阶段开始:setLoading(true)
   *   - advance() 后:setLoading(false)
   *   - content 阶段保持 false,文字停留阅读
   *   - 下一周期 loading 阶段:setLoading(true)
   */
  const isLoading = ref(false)

  /** 设置 loading 状态(供 useAutoPlay 在时序中调用) */
  function setLoading(v: boolean) {
    isLoading.value = v
  }

  /** 每段子对话是否已播放完毕(playedCount ≥ messages.length) */
  const subPlayedFlags = computed<boolean[]>(() =>
    playedCounts.value.map(
      (count, i) => count >= conversations.value[i].messages.length,
    ),
  )

  /**
   * 子卡预览文本(应用玩家选择覆盖,组内折叠)
   *
   * - 编辑模式:直接显示最后一条消息(无需播放;选择点组内折叠到组首条,
   *   组首条为选择点时预览 "[选项]")
   * - 播放模式:未播放(playedCount=0)返回空串;播放中返回最近一条
   *   "未被折叠"的已播放消息;播放完返回对话最后一句;
   *   选择点组:已选择 → 显示发送上去的选项文本,未选择 → 显示选择点前
   *   最后一条真实消息(不显示 "[选项]")
   */
  const subPreviewTexts = computed<string[]>(() =>
    playedCounts.value.map((count, i) => {
      const msgs = conversations.value[i].messages
      if (msgs.length === 0) return ''
      let idx = isEditMode.value ? msgs.length - 1 : count - 1
      while (idx > 0 && isChoiceMessage(msgs[idx]) && isChoiceMessage(msgs[idx - 1])) idx--
      if (!isEditMode.value && count <= 0) return ''
      const msg = msgs[idx]
      if (!msg) return ''
      // 图片消息:预览显示 "[图片]"
      if (msg.image) return '[图片]'
      // 玩家选择点消息:
      // - 播放模式:组内已有玩家选择 → 显示发送上去的选项文本;
      //   未选择 → 显示选择点前最后一条真实消息(而非 "[选项]")
      // - 编辑模式:预览显示 "[选项]" 标记
      if (isChoiceMessage(msg)) {
        if (isEditMode.value) return '[选项]'
        // 组内任一条消息被选中过,就用它的发送文本(玩家可能选组内靠后的消息)
        let j = idx
        while (j < msgs.length && isChoiceMessage(msgs[j])) {
          const chosen = choiceTexts.value[msgs[j].id]
          if (chosen) return chosen
          j++
        }
        // 未选择:回退到组前最后一条真实消息(折叠循环已保证 msgs[idx-1] 非选择点)
        const prev = msgs[idx - 1]
        if (prev) return prev.image ? '[图片]' : resolveMessageText(prev)
        return ''
      }
      return resolveMessageText(msg)
    }),
  )

  /**
   * 取已播放消息的最终显示文本(应用玩家选择覆盖)
   *
   * 选择点组折叠后只保留组首条。玩家选中的选项可能属于组内靠后的消息
   * (两次"以选项发送"连发两条选择消息,点第二条的选项),此时组首条也要
   * 显示该选中文本——即无论选项属于组内哪一条消息,折叠后统一回退到已选
   * 文本,避免"点了选项2 却显示组首条占位文本"的偏差。
   *
   * 与 subPreviewTexts 的组内扫描逻辑一致,保证播放模式气泡与子卡预览一致。
   *
   * @param msgs 当前对话全量消息
   * @param i    目标消息下标(已播放窗口内)
   */
  function resolveFoldedText(msgs: ChatMessage[], i: number): string {
    if (!isChoiceMessage(msgs[i])) return resolveMessageText(msgs[i])
    // 从组首条起向后扫完整组:任一消息有玩家选择文本即采用(组内最多一次提交)
    let j = i
    while (j < msgs.length && isChoiceMessage(msgs[j])) {
      const chosen = choiceTexts.value[msgs[j].id]
      if (chosen) return chosen
      j++
    }
    return resolveMessageText(msgs[i])
  }

  /**
   * 当前对话已播放的消息列表(应用玩家选择覆盖,供 ChatArea 渲染;未选中时为空)
   *
   * 选择点组内仅保留首条(折叠),组首条文本 = 玩家选中文本(若有)。
   * 编辑模式渲染 messages 全量,不折叠。
   */
  const playedMessages = computed<ChatMessage[]>(() => {
    if (activeSub.value === null) return []
    const count = playedCounts.value[activeSub.value]
    const msgs = conversations.value[activeSub.value].messages
    const out: ChatMessage[] = []
    for (let i = 0; i < count; i++) {
      // 连续选择点组折叠:仅保留组首条(与 subPreviewTexts 的折叠规则一致)
      if (i > 0 && isChoiceMessage(msgs[i]) && isChoiceMessage(msgs[i - 1])) continue
      const msg = msgs[i]
      out.push({ ...msg, text: resolveFoldedText(msgs, i) })
    }
    return out
  })

  /**
   * 当前 LoadingBubble 应有的朝向
   *
   * 取下一条待播放消息的方向;无下一条(已播完)或未在播放则返回 null。
   */
  const loadingSide = computed<'other' | 'mine' | null>(() => {
    if (activeSub.value === null) return null
    if (playingSub.value !== activeSub.value) return null
    const count = playedCounts.value[activeSub.value]
    const msg = conversations.value[activeSub.value].messages[count]
    // 居中提示文本无角色归属,不显示 LoadingBubble(静默出现)
    if (msg?.centered) return null
    // 分段矩形面板同样无角色归属,静默出现
    if (msg?.panel) return null
    // 图片消息为纯图片展示,播放时不显示气泡加载动画
    if (msg?.image) return null
    return msg?.side ?? null
  })

  /**
   * 下一条待播放的消息(供 useAutoPlay 预判是否为玩家选择点)
   *
   * - 未在播放或已播完:返回 null
   * - 否则:返回 messages[playedCount]
   */
  const nextMessage = computed<ChatMessage | null>(() => {
    if (activeSub.value === null) return null
    if (playingSub.value !== activeSub.value) return null
    const count = playedCounts.value[activeSub.value]
    return conversations.value[activeSub.value].messages[count] ?? null
  })

  /**
   * 开始播放指定对话
   *
   * 已播放完毕的对话不重启(保留 playedCount)。
   * 实际定时器推进由 useAutoPlay composable 监听 playingSub 启动。
   */
  function play(sub: number) {
    if (playedCounts.value[sub] >= conversations.value[sub].messages.length) return
    playingSub.value = sub
  }

  /**
   * 停止播放(保留已播放进度,不重置 playedCount,清除 loading 与选择面板状态)
   *
   * 设计决策:stop 不重置 playedCounts,故播放完毕的对话切走再切回不会重播
   * (play 内 `playedCounts[sub] >= length` 守卫拦截)。这是有意为之的"断点续播"
   * 语义:用户中途切走查看其他对话,切回时从断点继续而非从头。若需重播,应通过
   * toggleEditMode 退出编辑模式(会重置所有 playedCounts)再重新播放。
   */
  function stop() {
    playingSub.value = null
    isLoading.value = false
    pendingChoice.value = null
  }

  /**
   * 玩家提交选择(ChoicePanel 调用)
   *
   * 流程:
   *   1. 记录选中选项的文本到 choiceTexts 覆盖表(playedMessages 自动响应)
   *   2. 清空 pendingChoice(ChoicePanel 自动隐藏)
   *   3. advanceToGroupEnd() 一次推进到组尾
   *   4. useAutoPlay 监听到 pendingChoice 变 null 恢复时序
   *
   * @param sourceMsgId 被选中的选项所属消息 id(组内摊平选项时用于定位覆盖表)
   * @param choice      玩家点击的选项
   */
  function submitChoice(sourceMsgId: number, choice: PlayerChoice) {
    if (pendingChoice.value === null) return
    // 校验 sourceMsgId 确属当前待选组,防御 UI 传错。
    // choice.text 为显式空串时回退到 label(空串视为未设置)。
    if (!pendingChoice.value.messages.some((m) => m.id === sourceMsgId)) return
    choiceTexts.value[sourceMsgId] = choice.text || choice.label
    pendingChoice.value = null
    advanceToGroupEnd()
  }

  /**
   * 从当前选择点开始,一次推进到"选择点组"末尾
   *
   * 组 = 从 playedCount 起连续的 mine+choices 消息。
   * 推进后组内首条以玩家选中文本进入已播放列表(折叠渲染),播完则停止。
   */
  function advanceToGroupEnd() {
    if (playingSub.value === null) return
    const sub = playingSub.value
    const msgs = conversations.value[sub].messages
    const next = choiceGroupEnd(msgs, playedCounts.value[sub])
    playedCounts.value[sub] = next
    // advance 后进入 content 阶段,隐藏 LoadingBubble,显示新文字气泡
    isLoading.value = false
    if (next >= msgs.length) {
      playingSub.value = null
    }
  }

  /** 推进当前播放对话的已播放消息数 +1,播完则自动停止 */
  function advance() {
    if (playingSub.value === null) return
    const sub = playingSub.value
    const next = playedCounts.value[sub] + 1
    playedCounts.value[sub] = next
    // advance 后进入 content 阶段,隐藏 LoadingBubble,显示新文字气泡
    isLoading.value = false
    if (next >= conversations.value[sub].messages.length) {
      playingSub.value = null
    }
  }

  // 切换对话:先停止旧对话播放(无论是否已播完),再尝试播放新对话。
  // 同时把底部"发送身份"同步为当前卡片的"我方身份"(底部选择可临时覆盖,切卡后归位)。
  // 编辑模式下不自动播放:仅展示全量消息供编辑,避免选中对话触发后台定时器
  // 序列(setLoading/advance 静默推进 playedCounts,且可能误设 pendingChoice)。
  watch(activeSub, (sub) => {
    stop()
    if (sub !== null) myIdentity.value = { ...activeCardIdentity.value }
    if (sub !== null && !isEditMode.value) play(sub)
  }, { immediate: true })

  /**
   * 切换指定主卡的折叠状态
   *
   * @param index 主卡索引
   */
  function toggleCollapse(index: number) {
    collapsed.value[index] = !collapsed.value[index]
  }

  /**
   * 选中指定子卡(切换当前对话)
   *
   * @param index 子卡全局索引(在扁平 conversations 中的下标)
   */
  function selectSub(index: number) {
    activeSub.value = index
  }

  /**
   * 切换编辑模式 / 播放模式
   *
   * - 进入编辑模式:停止播放,保留当前 activeSub(若已选中对话,直接编辑该对话)
   * - 退出编辑模式:停止播放 + activeSub = null(回到起始页) +
   *                清空 choiceTexts 覆盖表(让编辑后的 msg.text/choice.text 生效)
   *
   * 编辑内容已直接写入 cards,无需额外保存。
   * 但 playedMessages 会用 choiceTexts[msg.id] ?? msg.text 覆写 text,
   * 旧玩家选择残留会盖掉编辑后的 msg.text,故退出编辑模式必须清空。
   */
  function toggleEditMode() {
    if (isEditMode.value) {
      // 退出编辑模式:回到起始页 + 清空玩家选择覆盖 +
      // 重置所有对话播放进度(重新播放时从头开始)
      stop()
      activeSub.value = null
      choiceTexts.value = {}
      playedCounts.value = conversations.value.map(() => 0)
      isEditMode.value = false
    } else {
      // 进入编辑模式:停止播放,保留当前选中对话
      stop()
      isEditMode.value = true
    }
  }

  /**
   * 整体替换卡片树并重置全部运行时态
   *
   * DataManagerDialog.applyCards(导入/清空)与 useChatPersistence.loadProject
   * (恢复)都需要"替换 cards + 重置 7 个运行时态字段"。收敛为统一 action,
   * 保证重置逻辑唯一来源,字段集合只在一处维护。
   *
   * 重置字段:collapsed(全收起)/ playedCounts(归零)/ activeSub(null)/
   *          playingSub(null)/ isLoading(false)/ pendingChoice(null)/
   *          choiceTexts(清空)
   *
   * @param next 新的卡片树(调用方负责 sanitize)
   */
  function replaceAllCards(next: Card[]) {
    cards.value = next
    collapsed.value = next.map(() => true)
    playedCounts.value = next.flatMap((c) => c.conversations.map(() => 0))
    activeSub.value = null
    playingSub.value = null
    isLoading.value = false
    pendingChoice.value = null
    clearChoiceTexts()
  }

  /**
   * 更新指定对话中某条消息的 text(编辑模式用)
   *
   * @param subIndex  子卡全局索引(扁平 conversations 下标)
   * @param messageId 消息 id(ChatMessage.id,从 1 开始)
   * @param text      新文本
   */
  function updateMessageText(subIndex: number, messageId: number, text: string) {
    const conv = conversations.value[subIndex]
    const msg = conv?.messages.find((m) => m.id === messageId)
    if (!msg) return
    msg.text = text
  }

  /**
   * 更新任务面板的可切换样式(左端图标 / 竖条颜色 / 右端装饰)
   *
   * 样式存于消息上:导出模式渲染的独立 ChatArea 实例读取同一份消息数据,
   * 保证导出的面板样式与主界面当前切换到的完全一致。
   *
   * @param subIndex  子卡全局索引
   * @param messageId 消息 id
   * @param style     待更新的样式字段(只更新传入的部分)
   */
  function updatePanelStyle(
    subIndex: number,
    messageId: number,
    style: Partial<{ panelIcon: number; panelBarColor: number; panelDecoAlt: boolean }>,
  ) {
    const conv = conversations.value[subIndex]
    const msg = conv?.messages.find((m) => m.id === messageId)
    if (!msg) return
    if (style.panelIcon !== undefined) msg.panelIcon = style.panelIcon
    if (style.panelBarColor !== undefined) msg.panelBarColor = style.panelBarColor
    if (style.panelDecoAlt !== undefined) msg.panelDecoAlt = style.panelDecoAlt
  }

  /**
   * 循环切换到下一张顶部聊天条图片
   *
   * 同样存于 store:导出模式 ChatArea 实例共享,导出图与主界面样式一致。
   */
  function cycleStrip(): void {
    stripVariantIndex.value = (stripVariantIndex.value + 1) % 3
  }

  /**
   * 更新指定消息的某个选项的 label(编辑模式用)
   *
   * 同步更新 label 与 text:
   *   - label 始终更新(按钮显示文案)
   *   - text 始终更新(玩家选中后实际发送的消息文本)
   *
   * @param subIndex    子卡全局索引
   * @param messageId   消息 id
   * @param choiceIndex 选项在 choices 数组中的下标
   * @param label       新选项文案
   */
  function updateChoiceLabel(
    subIndex: number,
    messageId: number,
    choiceIndex: number,
    label: string,
  ) {
    const conv = conversations.value[subIndex]
    const msg = conv?.messages.find((m) => m.id === messageId)
    if (!msg?.choices?.[choiceIndex]) return
    msg.choices[choiceIndex].label = label
    msg.choices[choiceIndex].text = label
  }

  /**
   * 删除指定消息的某个选项(编辑模式用)
   *
   * 从 choices 数组中移除对应下标;若删空(数组长度变为 0),则该选项消息
   * 已无任何保留意义("以选项发送"建出的消息 text 为空串,删空即空壳),
   * 整条消息一并删除,避免残留"空气泡"(一条内宽为 0、无法编辑的气泡)。
   *
   * @param subIndex    子卡全局索引
   * @param messageId   消息 id
   * @param choiceIndex 要删除的选项在 choices 数组中的下标
   * @returns           是否因删空选项而连带删除了整条消息。
   *                    **调用方必须检查返回值**:返回 true 时消息已不存在,
   *                    需同步清理 localTexts / hoverId / avatarTarget 等本地状态。
   */
  function removeChoice(subIndex: number, messageId: number, choiceIndex: number): boolean {
    const conv = conversations.value[subIndex]
    const msg = conv?.messages.find((m) => m.id === messageId)
    if (!msg?.choices?.length) return false
    msg.choices.splice(choiceIndex, 1)
    if (msg.choices.length === 0) {
      const idx = conv.messages.indexOf(msg)
      if (idx !== -1) conv.messages.splice(idx, 1)
      return true
    }
    return false
  }

  /**
   * 统一"添加选项"入口:在指定消息的某个下标之后插入一个新选项(编辑模式用)
   *
   * 两条入口共用本函数,唯一差异是目标消息与插入位置:
   *   - 行内 + 号:afterIndex = 被点击选项的下标(插入第 i+1 位),label 用默认文案
   *   - 以选项发送:新消息首选项 afterIndex = -1(插入第 0 位),label 为输入文字
   *
   * 新选项对象的构造统一由 createChoice 工厂完成(id/label/text 字段一致)。
   * 若消息原本无 choices,则创建空数组后插入。
   *
   * @param subIndex    子卡全局索引
   * @param messageId   消息 id
   * @param afterIndex  插入位置基准:在其后插入(-1 = 插入数组首位)
   * @param label       新选项文案(默认 DEFAULT_CHOICE_LABEL)
   */
  function insertChoice(
    subIndex: number,
    messageId: number,
    afterIndex: number,
    label: string = DEFAULT_CHOICE_LABEL,
  ) {
    const conv = conversations.value[subIndex]
    const msg = conv?.messages.find((m) => m.id === messageId)
    if (!msg) return
    if (!msg.choices) msg.choices = []
    const index = afterIndex + 1
    msg.choices.splice(index, 0, createChoice(msg.id, index, label))
  }

  /**
   * 删除指定对话中的某条消息(编辑模式用)
   *
   * 消息 id 全局递增且不重用,删除后剩余消息 id 保持稳定,不影响布局重算。
   *
   * @param subIndex  子卡全局索引(扁平 conversations 下标)
   * @param messageId 要删除的消息 id
   */
  function deleteMessage(subIndex: number, messageId: number) {
    const conv = conversations.value[subIndex]
    if (!conv) return
    const idx = conv.messages.findIndex((m) => m.id === messageId)
    if (idx === -1) return
    conv.messages.splice(idx, 1)
  }

  /**
   * 复制一条居中提示文本(编辑模式"居中文本行"的 + 按钮调用)
   *
   * 在原消息之后插入一条文本完全相同的新居中文本行(新 id 全局递增不重用)。
   *
   * @param subIndex  子卡全局索引(扁平 conversations 下标)
   * @param messageId 要复制的居中文本消息 id
   */
  function duplicateCenteredMessage(subIndex: number, messageId: number) {
    const conv = conversations.value[subIndex]
    if (!conv) return
    const idx = conv.messages.findIndex((m) => m.id === messageId)
    const src = idx === -1 ? undefined : conv.messages[idx]
    if (!src?.centered) return
    const nextId = nextMessageId(conv)
    conv.messages.splice(idx + 1, 0, {
      id: nextId,
      side: src.side,
      text: src.text,
      centered: true,
    })
  }

  /**
   * 在指定消息之后插入一条"以该消息所属角色发言"的新消息(编辑模式加号按钮调用)
   *
   * 角色 = 悬停消息自身的说话人身份(side / speakerName / speakerAvatar /
   * speakerCustomId 全部复制自源消息),因此新消息与源消息同侧同角色,
   * 头像/性别解析完全一致。默认文本"新消息",插入后可点击气泡内联编辑。
   *
   * @param subIndex  子卡全局索引(扁平 conversations 下标)
   * @param messageId 作为插入锚点的消息 id(新消息紧跟其后)
   */
  function insertMessageAfter(subIndex: number, messageId: number) {
    const conv = conversations.value[subIndex]
    if (!conv) return
    const idx = conv.messages.findIndex((m) => m.id === messageId)
    const src = idx === -1 ? undefined : conv.messages[idx]
    if (!src) return
    conv.messages.splice(idx + 1, 0, {
      id: nextMessageId(conv),
      side: src.side,
      text: '新消息',
      speakerName: src.speakerName,
      speakerAvatar: src.speakerAvatar,
      speakerCustomId: src.speakerCustomId,
    })
  }

  return {
    // 数据
    cards,
    customCharacters,
    addCustomCharacter,
    removeCustomCharacter,
    importCustomCharacters,
    conversations,
    collapsed,
    cardSubRanges,
    cardSubStarts,
    subTotal,
    activeSub,
    activeCardIndex,
    messages,
    counterpartName,
    currentOtherAvatarUrl,
    activeCardIdentity,
    activeCardIdentityAvatar,
    cardCharacters,
    // 会话创作
    myIdentity,
    setMyIdentity,
    canAddChild,
    changeMessageIdentity,
    addMessageAvatar,
    createChildConversation,
    createParentConversation,
    sendMessage,
    sendImage,
    sendCenteredMessage,
    sendPanelMessage,
    deleteActiveConversation,
    setCustomTitle,
    setCardGroupAvatar,
    setCardRoleName,
    roleNamesOf,
    // 动态命名
    conversationMeta,
    currentConversationMeta,
    // 自动播放
    playedCounts,
    playingSub,
    subPlayedFlags,
    subPreviewTexts,
    playedMessages,
    isLoading,
    loadingSide,
    nextMessage,
    setLoading,
    play,
    stop,
    advance,
    // 玩家选择
    pendingChoice,
    submitChoice,
    clearChoiceTexts,
    toggleCollapse,
    selectSub,
    // 编辑模式
    isEditMode,
    toggleEditMode,
    // 角色名称显示开关(localStorage 持久化)
    showCharacterNames,
    toggleShowCharacterNames,
    replaceAllCards,
    updateMessageText,
    updatePanelStyle,
    cycleStrip,
    stripVariantIndex,
    updateChoiceLabel,
    removeChoice,
    insertChoice,
    deleteMessage,
    duplicateCenteredMessage,
    insertMessageAfter,
    // 公共头像解析(聊天区渲染 / 编辑菜单高亮共用)
    resolveMessageAvatar,
  }
})
