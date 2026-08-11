// =============================================================================
// 聊天区消息布局计算(useChatRows)
// -----------------------------------------------------------------------------
// 职责:
//   1. rows: 计算每条已播放消息的布局(left/top/avatarTop/showAvatar/stack)
//   2. lastRow / loadingLayout / showLoadingAvatar: 自动播放 LoadingBubble 布局
//   3. contentBottom / endDecoTop / padTop: 滚动内容底部与尾部空间
//   4. choicePanelHeight 系列: 选项面板出现时 chat-scroll 的让位高度
//   5. resolveSpeakerAvatar / speakerKeyOf: 消息说话人头像解析(模板共用)
//
// 设计理由:
//   - 纯计算 + store 驱动,无 DOM 操作,可独立测试
//   - freshContext 以可变对象注入(非响应式),由 ChatArea 的 watcher 翻转,
//     避免将布局上下文做成响应式导致 rows 额外重算
// =============================================================================

import { computed, watch, type Ref } from 'vue'
import { storeToRefs } from 'pinia'
import { adminDisplayName, isAdminName, speakerNameKey, useChatStore } from '../stores/chat'
import {
  AVATAR_TOP_TO_BUBBLE,
  CHAT,
  CHAT_END_DECO,
  CHAT_GAP,
  CHAT_IMAGE,
  CHAT_PANEL,
  CHAT_SCROLL,
  CHOICE_GAP,
  TAIL_SPACE,
  avatarBubbleTop,
  avatarStack,
} from '../constants/design'
import { PANEL_BTN_H, PANEL_BTN_GAP, panelHeight as calcPanelHeight } from '../constants/panel'
import { BUBBLE_SINGLE_LINE_H, LOADING_RECT, bubbleSvgWidth, type BubbleBox } from '../utils/measure'
import type { ChatMessage, ChatRow, MessageSpeaker, RectSize } from '../types/chat'

/** useChatRows 输入参数 */
export interface ChatRowsOptions {
  /** 气泡文本测量函数(useBubbleMeasure.measure) */
  measure: (text: string) => BubbleBox
  /** 居中提示文本测量函数(与 measure 同源,屏幕态与导出态共用同一测量函数保证换行一致) */
  measureCentered: (text: string) => BubbleBox
  /** 编辑模式本地文本缓存(消息 id → 实时输入文本,由 ChatArea 持有) */
  localTexts: Ref<Record<number, string>>
  /** 编辑模式开关(与 ChatArea 共用同一 store ref) */
  isEditMode: Ref<boolean>
}

/** 首个选项的占位文本(播放模式加载阶段 / 编辑模式无 text 时显示选项首项文案) */
function choicePlaceholderText(msg: ChatMessage): string {
  const first = msg.choices?.[0]
  return first ? (first.label ?? first.text ?? '') : ''
}

/**
 * 播放模式下,mine 消息的 text 在玩家选择前可能尚未确定。
 * 此时显示第一个选项的 label 作为占位文本(若有 choices),否则用 text。
 * 编辑模式直接用 text。
 * (仅用于测量/显示;与 store.resolveMessageText——读取玩家选择覆盖表——语义不同)
 */
function measureTextOf(msg: ChatMessage): string {
  return msg.choices?.length && !msg.text ? choicePlaceholderText(msg) : msg.text
}

/**
 * 计算消息行间距
 *
 * 间距规则:
 *   1. 连续选项列表(编辑模式):PANEL_BTN_GAP(按钮间距)
 *   2. 居中/面板/同方向:再细分——
 *      a. 居中/面板:CHAT_GAP.cross(打断对话流)
 *      b. 同方向换说话人:CHAT_GAP.speaker(给新头像留位)
 *      c. 同人连发:CHAT_GAP.same
 *   3. 跨方向:CHAT_GAP.cross
 */
function computeGap(ctx: {
  hasChoices: boolean
  prevHasChoices: boolean
  isCentered: boolean
  isPanel: boolean
  side: 'other' | 'mine'
  prevSide: 'other' | 'mine' | null
  prevSpeakerKey: string | null
  speakerKey: string
}): number {
  // 1. 连续选项列表:按钮间距
  if (ctx.hasChoices && ctx.prevHasChoices) return PANEL_BTN_GAP
  // 2. 居中/面板 或 同方向
  if (ctx.isCentered || ctx.isPanel || ctx.side === ctx.prevSide) {
    // 2a. 居中/面板打断对话流:cross 间距
    if (ctx.isCentered || ctx.isPanel) return CHAT_GAP.cross
    // 2b. 同方向换说话人:speaker 间距(给新头像留位)
    if (ctx.prevSpeakerKey !== null && ctx.prevSpeakerKey !== ctx.speakerKey) {
      return CHAT_GAP.speaker
    }
    // 2c. 同人连发:same 间距
    return CHAT_GAP.same
  }
  // 3. 跨方向:cross 间距
  return CHAT_GAP.cross
}

/**
 * 聊天区消息布局管线
 *
 * @param options 测量函数 / 本地文本缓存 / 编辑模式开关
 * @returns       布局 computed 集合 + 尺寸过渡上下文(layoutContext)
 */
export function useChatRows(options: ChatRowsOptions) {
  const { measure, measureCentered: centerMeasureOf, localTexts, isEditMode } = options
  const chatStore = useChatStore()
  const { messages, playedMessages, pendingChoice, isLoading, loadingSide } = storeToRefs(chatStore)

  /** 当前对话的对话名(旧数据消息无 speakerName 时的身份回退,未选中时为空串) */
  const activeConvName = computed(() =>
    chatStore.activeSub === null ? '' : chatStore.conversations[chatStore.activeSub]?.name ?? '',
  )

  /** 当前对话的对方/我方默认头像 URL(群聊 per-message 可覆盖) */
  const otherAvatarUrl = computed(() => chatStore.currentOtherAvatarUrl)
  /** 我方默认头像 = 当前父卡"我方身份"的头像(聊天区右侧气泡默认头像) */
  const mineAvatarUrl = computed(() => chatStore.activeCardIdentityAvatar)

  /**
   * 解析单条消息的说话人头像 URL(支持群聊 per-message 覆盖)
   *
   * 直接走 store 导出的公共 resolveMessageAvatar,与头像选择菜单(EditModePanel)
   * 的高亮解析完全一致,避免两处解析链差异导致"点开的头像没有黄圈"。
   */
  function resolveSpeakerAvatar(msg: MessageSpeaker): string {
    return chatStore.resolveMessageAvatar(
      msg,
      activeConvName.value,
      otherAvatarUrl.value,
      mineAvatarUrl.value,
    )
  }

  /**
   * 单条消息的说话人显示名(角色名称悬浮气泡用)
   *
   * 与 resolveSpeakerAvatar 同源解析(键一致,头像换人即换名):
   * - other 侧:显式 speakerName(群聊 per-message),否则回退会话名
   * - mine 侧:显式 speakerName(发送时写入的身份),否则回退当前发送身份名
   * - 最后应用当前父卡的卡片级显示名覆盖(card.roleNames,仅影响显示,
   *   不改写消息数据;气泡名 / LoadingBubble 名 / 导出离屏渲染共用此函数)
   */
  function resolveSpeakerName(msg: MessageSpeaker): string {
    const identity = chatStore.activeCardIdentity
    let base: string
    if (msg.side === 'mine') {
      // mine 侧显式 speakerName(发送时写入的身份)优先;缺省回退本卡"我方身份"
      // 的显示名(身份是管理员时归一化"管理员",不随性别全名变化)。
      const name = msg.speakerName
      base = name && !isAdminName(name) ? name : (isAdminName(identity.name) ? '管理员' : identity.name)
    } else {
      // other 侧:显式 speakerName(群聊 per-message),否则回退会话名;
      // 管理员(男/女)统一显示"管理员"(数据内部保留性别全名)
      base = adminDisplayName(msg.speakerName ?? activeConvName.value)
    }
    const card = chatStore.cards[chatStore.activeCardIndex]
    const overlay = card?.roleNames?.[speakerNameKey(msg, activeConvName.value, identity)]
    return overlay ?? base
  }

  /**
   * 说话人身份键:该消息实际渲染的头像 URL(与 resolveSpeakerAvatar 完全一致)
   *
   * 用于判断"同方向是否换了说话人":身份键不同 → 视为新说话人开口,
   * 需要重新显示头像(群聊多角色场景)。
   */
  function speakerKeyOf(msg: MessageSpeaker): string {
    return resolveSpeakerAvatar(msg)
  }

  /**
   * 尺寸过渡上下文(非响应式)
   *
   * fresh=true  表示处于 chat-in 入场期(无 LoadingBubble,无文字气泡过渡)
   * fresh=false 表示入场结束(文字气泡 prevRect = LOADING_RECT)
   * 由 ChatArea 的 watcher 翻转:activeSub 变化 → true;首条 LoadingBubble
   * 显示(post flush)→ false。
   *
   * 刻意不做成 ref:
   *   1. fresh=true 在 activeSub watcher 内同步翻转,早于 playedMessages 重算,
   *      rows 首次计算时读到的一定是 true。
   *   2. fresh=false 在 isLoading watcher(flush:post)内翻转,此时 rows 已完成
   *      首次计算(fresh=true 生效)。下次 rows 重算(playedCount++ 时)读到 false,
   *      新增行 prevRect=LOADING_RECT,正确触发尺寸过渡。
   *   3. 若做成 ref,fresh 翻转会触发 rows 重算,导致已渲染的行 prevRect 从
   *      undefined 变为 LOADING_RECT,触发 ChatBubble watch(prevRect) 重新执行
   *      triggerTransition,所有已显示气泡"脉冲"一次(先缩到加载尺寸再弹回)。
   *      非响应式设计正是为了避免这个副作用。
   */
  const layoutContext = { fresh: true }

  /**
   * 每条消息首次参与布局时的 prevRect 快照(消息 id → prevRect)
   *
   * rows 重算时一律复用首次值,避免已挂载气泡的 prevRect 被后续
   * layoutContext.fresh 翻转改写:
   *   - 若某气泡在 fresh=true 期间首渲染(prevRect=undefined,chat-in 入场),
   *     之后 fresh=false 时重算会把它的 prevRect 推导为 LOADING_RECT,
   *     触发 ChatBubble watch(prevRect) 对已显示气泡重复 triggerTransition
   *     ("脉冲"重播,覆盖"续播已播一半的会话"场景)。
   *   - 选择点气泡在 pendingChoice 出现时 fresh 已翻转(false),首渲染即快照
   *     LOADING_RECT,播放正常生长过渡,之后亦不再变化。
   *
   * 键为消息 id(各对话内从 1 自增、非全局唯一),切换对话时清空。
   */
  const frozenPrevRects = new Map<number, RectSize | undefined>()

  watch(
    () => chatStore.activeSub,
    () => frozenPrevRects.clear(),
    { immediate: true },
  )

  // ---- 选项面板让位 ----------------------------------------------------------
  /**
   * 当前待选面板高度(px):与 ChoicePanel 的 panelHeight 共用同一公式
   */
  const choicePanelHeight = computed(() => {
    const n = (pendingChoice.value?.messages ?? []).reduce(
      (sum, m) => sum + (m.choices?.length ?? 0),
      0,
    )
    return calcPanelHeight(n)
  })

  /** ChoicePanel 顶部到 chat-scroll 原始底部的距离(= 面板高 + 3) */
  const choicePanelTopOffset = computed(() => choicePanelHeight.value + 3)

  /** 让消息让出选项面板空间的缩减量 */
  const choicePanelReserve = computed(() => choicePanelTopOffset.value - TAIL_SPACE + CHOICE_GAP)

  /**
   * chat-scroll 实际高度
   *
   * 编辑模式:使用原始 CHAT_SCROLL.h(无 ChoicePanel,不需要让出空间)
   * 播放模式:pendingChoice 存在时减去 ChoicePanel 高度,让消息让出选项面板空间
   *           否则使用原始 CHAT_SCROLL.h
   */
  const chatScrollHeight = computed(() => {
    if (isEditMode.value) return CHAT_SCROLL.h
    return pendingChoice.value ? CHAT_SCROLL.h - choicePanelReserve.value : CHAT_SCROLL.h
  })

  // ---- 消息行布局 ------------------------------------------------------------
  /**
   * 计算所有已播放消息的布局
   *
   * 算法要点:
   * - 首条消息:avatarTop = CHAT.anchorAvatarTop,bubbleTop = avatarBubbleTop(avatarTop, side)
   * - 后续消息:bubbleTop = cursor + (同方向 same / 跨方向 cross),avatarTop = bubbleTop - AVATAR_TOP_TO_BUBBLE
   * - showAvatar:与上一条消息方向不同时显示头像
   *
   * prevRect 规则:
   * - 首屏(layoutContext.fresh):全部 undefined(走整体 chat-in)
   * - 非首屏:每条消息 prevRect=LOADING_RECT(从加载气泡尺寸过渡到真实尺寸)
   * - 编辑模式:全部 undefined(无过渡,全量显示)
   *
   * 编辑模式下,mine 消息携带 choices 时,选项按钮独占一行垂直空间:
   *   - 气泡底部 cursor 推进后,再加间距 + choicesHeight 作为下一条消息起点
   *   - choicesTop = bubbleBottom + CHOICE_GAP(独立行,不与气泡同行)
   */
  const rows = computed<ChatRow[]>(() => {
    // 编辑模式:用全量消息;播放模式:用已播放切片
    const source = isEditMode.value ? messages.value : playedMessages.value
    const list: ChatRow[] = []
    let prevSide: 'other' | 'mine' | null = null
    // 仅跟踪"真实渲染了气泡"的消息方向(选项按钮条不渲染气泡,视为气泡流中断)
    let prevBubbleSide: 'other' | 'mine' | null = null
    // 上一条气泡消息的说话人身份键(群聊换人时重新显示头像)
    let prevSpeakerKey: string | null = null
    // 上一条是否为"选项列表"消息(编辑模式):连续选项列表之间按按钮间距衔接
    let prevHasChoices = false
    let cursor = 0
    for (const msg of source) {
      // 编辑模式:优先用 localTexts 缓存(实时输入),回退 msg.text;
      //   若 msg.text 为空且有 choices,用第一个选项的 label 作为显示文本
      //   (避免渲染空气泡;用户编辑选项时气泡会跟随更新)
      // 播放模式:用 measureTextOf(首选项占位)
      const fallbackText = isEditMode.value && !msg.text && msg.choices?.length
        ? choicePlaceholderText(msg)
        : msg.text
      const displayText = isEditMode.value
        ? (localTexts.value[msg.id] ?? fallbackText)
        : measureTextOf(msg)
      // 图片消息:不测量文本,用发送时计算的真实显示尺寸(纯图片无气泡)
      const hasImage = !!msg.image
      // 居中提示文本:无气泡无角色,按小字号居中文本测量
      const isCentered = !!msg.centered
      // 分段矩形面板:固定尺寸,不测量文本(1089×78)
      const isPanel = !!msg.panel
      const box = hasImage
        ? { rectW: msg.imageW ?? CHAT_IMAGE.w, rectH: msg.imageH ?? CHAT_IMAGE.h, innerW: msg.imageW ?? CHAT_IMAGE.w }
        : isPanel
          ? { rectW: CHAT_PANEL.w, rectH: CHAT_PANEL.h, innerW: CHAT_PANEL.w }
          : isCentered
            ? centerMeasureOf(displayText)
            : measure(displayText)

      const svgW = (isCentered || isPanel) ? 0 : bubbleSvgWidth(box.rectW, msg.side)
      // 编辑模式下若有 choices:不显示气泡,按钮直接从 bubbleTop 开始(无气泡高度 + 无 CHOICE_GAP)
      const hasChoices = isEditMode.value && !!msg.choices?.length
      const speakerKey = speakerKeyOf(msg)
      // 方向改变 或 同方向换了说话人 → 显示头像(群聊换人各自带头像);
      // 选项消息 / 居中文本 / 分段面板本身无气泡无头像,其后的第一条气泡视为新一组,无条件带头像
      const showAvatar = (hasChoices || isCentered || isPanel)
        ? false
        : prevBubbleSide !== msg.side || prevSpeakerKey !== speakerKey
      let avatarTop: number
      let bubbleTop: number
      if (list.length === 0) {
        avatarTop = CHAT.anchorAvatarTop
        // 居中文本 / 分段面板无头像,首条直接锚定首条消息气泡顶部高度附近
        bubbleTop = (isCentered || isPanel) ? CHAT.anchorAvatarTop : avatarBubbleTop(avatarTop, msg.side)
      } else {
        // 间距:跨方向 cross / 同方向换人 speaker(给新头像留位) / 同人连发 same
        // 连续两条"选项列表"(编辑模式)视为同一选项列:行距用按钮间距 PANEL_BTN_GAP,
        // 与"单条消息内逐位插入按钮"及播放模式合并面板(gap:22)的节距完全一致
        const gap = computeGap({
          hasChoices,
          prevHasChoices,
          isCentered,
          isPanel,
          side: msg.side,
          prevSide,
          prevSpeakerKey,
          speakerKey,
        })
        bubbleTop = cursor + gap
        avatarTop = bubbleTop - AVATAR_TOP_TO_BUBBLE[msg.side]
      }
      const avatarX = msg.side === 'other' ? CHAT.otherAvatarX : CHAT.mineAvatarX
      const left = (isCentered || isPanel)
        // 居中文本 / 分段面板:在滚动容器内水平居中
        ? CHAT_SCROLL.x + (CHAT_SCROLL.w - box.rectW) / 2
        : (msg.side === 'other' ? CHAT.otherBubbleX : CHAT.mineBubbleRight - svgW)

      const choicesTop = hasChoices ? bubbleTop : 0
      const choicesHeight = hasChoices
        ? (msg.choices!.length * (PANEL_BTN_H + PANEL_BTN_GAP)) - PANEL_BTN_GAP
        : 0

      // prevRect:每消息首次布局时冻结快照,之后永不再变。
      // 新出现的消息按当前 fresh 取值(chat-in 期间 undefined,否则 LOADING_RECT);
      // 已出现过(含续播恢复)的消息复用首次值,防止已挂载气泡的
      // prevRect 被后续 fresh 翻转改写而重复播放过渡动画。
      let prevRect: RectSize | undefined
      if (frozenPrevRects.has(msg.id)) {
        prevRect = frozenPrevRects.get(msg.id)
      } else {
        prevRect = (layoutContext.fresh || isEditMode.value) ? undefined : LOADING_RECT
        frozenPrevRects.set(msg.id, prevRect)
      }

      list.push({
        msg,
        displayText,
        box,
        left,
        bubbleTop,
        avatarTop,
        avatarX,
        showAvatar,
        stack: avatarStack(avatarX, avatarTop),
        prevRect,
        // 编辑模式选项独占行的 top(相对 chat-scroll 内坐标);无 choices 时为 0
        choicesTop,
        // 该消息在垂直方向的实际占用底部(相对 chat-area 坐标)
        // 普通消息 = bubbleTop + box.rectH
        // 编辑模式有 choices(不显示气泡)= choicesTop + choicesHeight
        bottom: hasChoices ? choicesTop + choicesHeight : bubbleTop + box.rectH,
      })
      // cursor 推进:若有 choices,只加选项高度
      cursor = hasChoices
        ? choicesTop + choicesHeight
        : bubbleTop + box.rectH
      // 居中文本 / 分段面板打断对话流:prevSide 置 null,其后第一条气泡按 cross 间距起排
      prevSide = (isCentered || isPanel) ? null : msg.side
      // 选项列表消息打断头像链:其后第一条气泡重新带头像
      prevBubbleSide = (hasChoices || isCentered || isPanel) ? null : msg.side
      prevSpeakerKey = (hasChoices || isCentered || isPanel) ? null : speakerKey
      prevHasChoices = hasChoices
    }
    return list
  })

  /** 末行(用于推算 LoadingBubble 起点与内容底部) */
  const lastRow = computed(() => rows.value[rows.value.length - 1])

  /**
   * LoadingBubble 布局
   *
   * - top: 末行底部 + 跨方向间距(模拟下一条消息起点)
   * - 首条消息尚无末行时,锚定到首条消息气泡顶部
   * - left: other 侧取 otherBubbleX,mine 侧取右边界减加载气泡 svgW
   * - 加载气泡自身从 width=0 展开到 100,无需 prevRect
   */
  const loadingLayout = computed(() => {
    const side = loadingSide.value
    if (!side || !isLoading.value) return null

    const loadSvgW = bubbleSvgWidth(LOADING_RECT.w, side)
    const left = side === 'other' ? CHAT.otherBubbleX : CHAT.mineBubbleRight - loadSvgW
    let bubbleTop: number
    if (lastRow.value) {
      // 用 lastRow.box(已缓存),避免重复 measure 触发重排
      // 间距取决于末行与下一条(loadingSide)的关系:
      //   跨方向 cross / 同方向换说话人 speaker / 同人连发 same
      // 间距必须与 advance 后文字气泡的间距一致,否则"瞬移"。
      const next = chatStore.nextMessage
      const lastKey = speakerKeyOf(lastRow.value.msg)
      const nextKey = next ? speakerKeyOf(next) : null
      const gap = lastRow.value.msg.side === side
        ? (lastKey !== nextKey ? CHAT_GAP.speaker : CHAT_GAP.same)
        : CHAT_GAP.cross
      bubbleTop = lastRow.value.bottom + gap
    } else {
      bubbleTop = avatarBubbleTop(CHAT.anchorAvatarTop, side)
    }
    const avatarTop = bubbleTop - AVATAR_TOP_TO_BUBBLE[side]
    const avatarX = side === 'other' ? CHAT.otherAvatarX : CHAT.mineAvatarX
    // 加载气泡头像:群聊换人时直接显示新说话人的头像(缺省走默认,绝不用群聊头像图)
    const next = chatStore.nextMessage
    const portraitUrl = next
      ? resolveSpeakerAvatar(next)
      : (side === 'other' ? otherAvatarUrl.value : mineAvatarUrl.value)

    /**
     * 加载气泡占用的布局高度:下一条消息文本的测量高度(多行消息预留完整高度)
     *
     * 若不预留,advance 后真实气泡从加载占位(单行 42px)过渡到多行高度,
     * 内容高度瞬间增长,而 scrollToBottom 在 nextTick 已滚到最终高度,
     * 滚动条先跳、气泡后长,每个多行消息都造成一次滚动条跳动。
     * 按真实高度预留后,滚动高度在"加载 → 真实气泡"之间保持不变,不再跳动。
     */
    const loadH = next
      ? next.image
        ? (next.imageH ?? CHAT_IMAGE.h)
        : next.panel
          ? CHAT_PANEL.h
          : Math.max(BUBBLE_SINGLE_LINE_H, measure(measureTextOf(next)).rectH)
      : BUBBLE_SINGLE_LINE_H

    return {
      left,
      top: bubbleTop,
      loadW: loadSvgW,
      loadH,
      avatarTop,
      avatarX,
      stack: avatarStack(avatarX, avatarTop),
      side,
      portraitUrl,
      speakerName: next ? resolveSpeakerName(next) : '',
      speakerKey: next ? speakerKeyOf(next) : null,
    }
  })

  /** 是否显示 LoadingBubble 头像(空流首条 / 与末行方向不同 / 换说话人) */
  const showLoadingAvatar = computed(() => {
    if (!loadingLayout.value) return false
    if (!lastRow.value) return true
    return lastRow.value.msg.side !== loadingLayout.value.side
      || speakerKeyOf(lastRow.value.msg) !== loadingLayout.value.speakerKey
  })

  /**
   * 滚动内容底部 y(相对 chat-scroll):
   * LoadingBubble 存在时以其为末行(高度取下一条消息的真实测量高度,
   * 使滚动高度在"加载 → 真实气泡"之间保持不变),否则取已播放末行
   */
  const contentBottom = computed(() => {
    // 编辑模式不渲染 LoadingBubble(模板已用 !isEditMode 守卫),contentBottom 也不能
    // 按 loading 布局预留空间,否则 pad/滚动高度会随自动播放的加载循环来回弹跳。
    if (!isEditMode.value && loadingLayout.value) {
      return loadingLayout.value.top + loadingLayout.value.loadH - CHAT_SCROLL.y
    }
    if (!lastRow.value) return 0
    return lastRow.value.bottom - CHAT_SCROLL.y
  })

  /** 末尾装饰 top(相对 chat-scroll) */
  const endDecoTop = computed(() => contentBottom.value + CHAT_END_DECO.gap)

  /** 尾部留白 top(相对 chat-scroll) */
  const padTop = computed(() => endDecoTop.value + CHAT_END_DECO.h + CHAT_END_DECO.gap)

  return {
    layoutContext,
    rows,
    lastRow,
    loadingLayout,
    showLoadingAvatar,
    contentBottom,
    endDecoTop,
    padTop,
    choicePanelHeight,
    choicePanelTopOffset,
    choicePanelReserve,
    chatScrollHeight,
    resolveSpeakerAvatar,
    resolveSpeakerName,
    activeConvName,
  }
}
