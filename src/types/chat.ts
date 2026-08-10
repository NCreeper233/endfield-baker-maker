// =============================================================================
// 聊天领域类型定义
// -----------------------------------------------------------------------------
// 设计原则:布局方向(side)与说话人身份(speakerName/speakerAvatar)解耦。
//   - side 只决定气泡朝向 / 头像位置,只有 'other' | 'mine' 两个值
//   - speakerName / speakerAvatar 决定显示谁在说话,支持群聊多 other 说话人
//
// 扩展兼容性:
//   - 1v1 对话:不传 speakerName/speakerAvatar,默认取 conversation.name / character 查询
//   - 群聊:每条 other 消息可指定不同 speakerName/speakerAvatar
//   - 玩家选择:'mine' 消息可携带 choices 数组,运行时弹出选择面板
// =============================================================================

import type { BubbleBox } from '../utils/measure'
import type { AvatarStack } from '../constants/design'

/** 消息方向:other=对方(左侧气泡) / mine=我方(右侧气泡) */
export type MessageSide = 'other' | 'mine'

/**
 * 玩家选择项
 *
 * 当 'mine' 消息携带 choices 时,自动播放会在该消息处暂停,
 * 弹出选择面板等待玩家点击。点击后选项的 text 作为该消息的发送文本。
 *
 * 后续自定义扩展预留(暂不实现):
 * - condition: 选项显示条件(如前置选择结果)
 * - nextBranch: 跳转到指定分支
 * - effects: 选项副作用(如增加好感度)
 */
export interface PlayerChoice {
  /** 选项唯一标识(后续分支引用用) */
  id?: string | number
  /** 按钮显示文案 */
  label: string
  /**
   * 选中后实际发送的消息文本
   * 不传则默认使用 label
   */
  text?: string
}

/**
 * 聊天消息
 *
 * 核心字段(id/side/text)必填,扩展字段全部可选:
 *   - speakerName / speakerAvatar:群聊多说话人支持
 *   - choices:玩家选择点
 */
export interface ChatMessage {
  /** 消息在当前对话内的序号(用作 v-for key) */
  id: number
  /** 发送方向,决定气泡朝向与头像 */
  side: MessageSide
  /** 消息文本(支持 \n 换行) */
  text: string
  /**
   * 图片消息(dataURL)
   *
   * 存在时渲染为纯图片(无气泡),text 通常为空串。
   */
  image?: string
  /** 图片显示宽度(px,按自然尺寸等比计算,不超过 CHAT_IMAGE 上限) */
  imageW?: number
  /** 图片显示高度(px,同 imageW) */
  imageH?: number
  /**
   * 说话人显示名(群聊用)
   *
   * - other 侧:不传则取 conversation.name
   * - mine  侧:通常不传(我方固定身份)
   */
  speakerName?: string
  /**
   * 说话人头像 URL(群聊用)
   *
   * - other 侧:不传则按 speakerName / conversation.name 查 character.ts
   * - mine  侧:不传则取我方默认头像
   */
  speakerAvatar?: string
  /**
   * 玩家选择项(仅 side='mine' 时有意义)
   *
   * - 提供:自动播放到此消息暂停,弹出选择面板,玩家点击后发送选项文本
   * - 不提供:直接自动播放该消息的 text(向后兼容现有对话)
   */
  choices?: PlayerChoice[]
  /**
   * 居中提示文本(编辑模式底部面板"居中文本"按钮发送)
   *
   * 存在时渲染为无气泡、无角色、水平居中的纯白小号文本:
   * - 不显示头像 / 气泡 / 角色归属
   * - 自动播放时静默出现(不显示 LoadingBubble)
   */
  centered?: boolean
  /**
   * 分段矩形面板(编辑模式底部面板"任务面板"按钮发送)
   *
   * 存在时渲染为一个固定尺寸(1089×78)的圆角 #2a2a2a 矩形:
   * - 无气泡 / 无头像 / 无角色归属,水平居中
   * - text 可承载面板内文案(可编辑),当前默认空文本(纯色块)
   * - 自动播放时静默出现(不显示 LoadingBubble)
   */
  panel?: boolean
  /** 面板左端图标下标(char/activity/fac 三选一,见 ChatPanel.panelIcons) */
  panelIcon?: number
  /** 面板左端竖条颜色下标(三色循环,见 ChatPanel.barColors) */
  panelBarColor?: number
  /** 面板右端装饰图是否切换为第二张(默认 false = 21 号图) */
  panelDecoAlt?: boolean
}

/** 任务面板可点击切换的样式状态(图标 / 竖条颜色 / 右端装饰) */
export interface PanelStyle {
  panelIcon?: number
  panelBarColor?: number
  panelDecoAlt?: boolean
}

/**
 * 说话人身份信息(布局/渲染层解析出的"谁在说话")
 *
 * 收敛自消息的 side + speakerName/speakerAvatar 三元组,
 * 供 store 解析链 / useChatRows / ChatMessageRow 共用同一形状。
 */
export type MessageSpeaker = Pick<ChatMessage, 'side' | 'speakerAvatar' | 'speakerName'>

/** 对话数据:一个干员子卡对应一段对话 */
export interface Conversation {
  /** 干员名(当前 UI 固定显示在聊天条标题;群聊场景下为主对话名) */
  name: string
  /** 消息列表 */
  messages: ChatMessage[]
  /**
   * 用户手动编辑的对话名(群聊用)
   *
   * 存在时优先于动态自动命名(conversationTitle);
   * 空串 / 缺失时回退到按成员自动推导的标题。
   */
  customTitle?: string
}

/**
 * 主卡(一级卡片)
 *
 * 一张主卡下挂载任意数量(≥1)的子卡(Conversation)。
 * 主卡头像/名称取自其首段子对话的 name。
 */
export interface Card {
  /** 该主卡下的子卡对话列表(长度 ≥ 1) */
  conversations: Conversation[]
}

/** 过渡起始尺寸(px):文字气泡从加载气泡尺寸平滑过渡到自身尺寸 */
export interface RectSize {
  w: number
  h: number
}

/**
 * 单条已播放消息的布局结果(useChatRows 输出,模板直接消费)
 *
 * - 编辑模式:全量消息,优先用 localTexts 的实时输入文本
 * - 播放模式:playedMessages 切片,应用玩家选择覆盖
 */
export interface ChatRow {
  /** 源消息(编辑模式全量 / 播放模式已播放切片) */
  msg: ChatMessage
  /** 用于显示和测量的文本(编辑模式取自 localTexts,播放模式取自 store) */
  displayText: string
  /** 气泡测量结果(传给 ChatBubble,避免 ChatBubble 重复 measure 触发重排) */
  box: BubbleBox
  /** 气泡盒左边缘(相对 chat-area 坐标) */
  left: number
  /** 气泡顶部(相对 chat-area 坐标) */
  bubbleTop: number
  /** 头像顶部(相对 chat-area 坐标) */
  avatarTop: number
  /** 头像容器左边缘(相对 chat-area 坐标) */
  avatarX: number
  /** 是否显示头像(方向改变 / 同方向换说话人时为 true) */
  showAvatar: boolean
  /** 头像三层槽位(传入 ChatAvatar) */
  stack: AvatarStack
  /** 过渡起始尺寸(首屏 / 已渲染过的气泡为 undefined,新追加为上一气泡尺寸) */
  prevRect?: RectSize
  /** 编辑模式:选项按钮独占行的 top(相对 chat-area 坐标,非 scroll);
   *  无 choices 或非编辑模式时为 0 */
  choicesTop: number
  /** 该消息在垂直方向的实际占用底部(相对 chat-area 坐标)
   *  普通消息 = bubbleTop + box.rectH
   *  编辑模式有 choices(不显示气泡)= choicesTop + choicesHeight */
  bottom: number
}
