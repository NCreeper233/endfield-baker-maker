// =============================================================================
// 气泡文本尺寸测量
// -----------------------------------------------------------------------------
// 测量策略:
// 1. canvas.measureText 估算每段宽度,得到 innerW 与粗略行数
//    (表情 token 按真实渲染宽展开为若干空格,参与宽度估算)
// 2. 隐藏 ruler DOM 实测精确行数与宽度(ruler 用真实 <img> 表情排版,
//    表情内联固定像素尺寸,加载前即可参与布局)
// 3. 取较大值作为最终结果,避免 canvas 测量误差导致气泡塌陷
//
// 气泡与居中提示文本复用同一测量核心(字体/字号/行高一致),
// 差异仅限最大内宽、内外边距与最小尺寸约束。
// =============================================================================

import { emojiToHtml, measureTextWithEmoji } from '../constants/emoji'
import type { MessageSide, RectSize } from '../types/chat'

/** 气泡尾巴偏移(px):rect 左侧留出空间画尾巴,mine 侧右侧也留同样空间 */
export const BUBBLE_TAIL_OFFSET = 8.2

/**
 * 气泡 SVG 总宽 = 尾巴偏移 + rect 宽(+ mine 侧再补一个尾巴偏移)
 *
 * 容器跟随过渡尺寸:rect 右缘 = svgW - 尾巴偏移,任何时刻 rect 都在 svg 内。
 */
export function bubbleSvgWidth(width: number, side: MessageSide): number {
  return BUBBLE_TAIL_OFFSET + width + (side === 'mine' ? BUBBLE_TAIL_OFFSET : 0)
}

/** 气泡字体字号(px),与会话气泡文字一致 */
export const BUBBLE_FONT_SIZE = 20.88
/** 行高 = 字号 × 1.5,与会话气泡文字一致 */
export const BUBBLE_LINE_HEIGHT = BUBBLE_FONT_SIZE * 1.5
/** 气泡左右内边距(px) */
export const BUBBLE_PAD_X = 13
/** 气泡上下内边距(px) */
export const BUBBLE_PAD_Y = 9
/** 气泡最小宽度(px),单字短消息也保持圆角形状 */
export const BUBBLE_MIN_W = 51.76
/** 气泡最小高度(px) */
export const BUBBLE_MIN_H = 42.47
/** 单行气泡实际高度(px)= 一行行高 + 上下 padding,用于加载气泡与单行文字气泡对齐 */
export const BUBBLE_SINGLE_LINE_H = BUBBLE_LINE_HEIGHT + BUBBLE_PAD_Y * 2
/** 加载气泡 rect 尺寸(自动播放占位;文字气泡从该尺寸过渡到自身尺寸) */
export const LOADING_RECT: RectSize = { w: 100, h: BUBBLE_SINGLE_LINE_H }
/** 气泡最大宽度(px),超出则换行 */
export const BUBBLE_MAX_W = 660
/** 气泡内文最大宽度(px)= 外部最大框宽 − 左右内边距 */
export const BUBBLE_INNER_MAX_W = BUBBLE_MAX_W - BUBBLE_PAD_X * 2
/** 气泡字体栈(用于 canvas 与 ruler 同步) */
export const BUBBLE_FONT = `"HarmonyOS Sans SC Medium", "HarmonyOS Sans SC", "Microsoft YaHei", sans-serif`

/**
 * 显式等待气泡字体真正装入(font-display: swap 时 fonts.ready 可能早于换行测量)
 *
 * 气泡宽度用 BUBBLE_FONT_STACK 在 ruler/canvas 里测量:若字体未就绪会回退
 * Microsoft YaHei,字形宽度不同导致换行数/边距与导出(HarmonyOS)不一致。
 * 截图与测量前都应先 await 本函数。
 */
export async function ensureBubbleFont(): Promise<void> {
  try {
    await document.fonts.load(`${BUBBLE_FONT_SIZE}px ${BUBBLE_FONT}`)
  } catch { /* 保留后备 */ }
  await document.fonts.ready
}

/** 居中提示文本字号(px),与气泡字号一致 */
export const CENTER_FONT_SIZE = BUBBLE_FONT_SIZE
/** 居中提示文本行高 = 字号 × 1.5 */
export const CENTER_LINE_HEIGHT = CENTER_FONT_SIZE * 1.5
/** 居中提示文本最大宽度(px),超出则换行 */
export const CENTER_MAX_W = 1200

/** 气泡测量结果 */
export interface BubbleBox {
  /** 外框 rect 宽度(含 padding) */
  rectW: number
  /** 外框 rect 高度(含 padding) */
  rectH: number
  /** 内文区域宽度(不含 padding) */
  innerW: number
}

/** 单次测量的差异参数(气泡 / 居中文本) */
interface MeasureConfig {
  /** 内容最大宽度(px),超出换行 */
  innerMax: number
  /** 水平内边距(rectW 附加) */
  padX: number
  /** 垂直内边距(rectH 附加) */
  padY: number
  /** 最小外框宽度(px) */
  minW: number
  /** 最小外框高度(px) */
  minH: number
}

/**
 * 隐藏 ruler DOM 单例
 *
 * 设计理由:每次测量都创建 DOM 会触发重排,缓存单例避免性能损耗。
 * 单例绑定到 body,样式与气泡/居中文本一致以保证测量精度(二者字号行高相同)。
 */
let ruler: HTMLDivElement | null = null

function getRuler(): HTMLDivElement {
  if (!ruler) {
    const el = document.createElement('div')
    el.style.cssText =
      `position:fixed;left:-99999px;top:0;visibility:hidden;pointer-events:none;` +
      `white-space:pre-line;word-break:break-word;` +
      `font-family:${BUBBLE_FONT};font-size:${BUBBLE_FONT_SIZE}px;line-height:${BUBBLE_LINE_HEIGHT}px;`
    document.body.appendChild(el)
    ruler = el
  }
  return ruler
}

/**
 * canvas 2D 上下文单例(用于文本宽度估算)
 *
 * 只在首次创建,避免每次测量都 new 一个 canvas 造成 GC 压力。
 */
let canvasCtx: CanvasRenderingContext2D | null = null

function getCanvasCtx(): CanvasRenderingContext2D {
  if (!canvasCtx) {
    const canvas = document.createElement('canvas')
    canvasCtx = canvas.getContext('2d')!
    canvasCtx.font = `${BUBBLE_FONT_SIZE}px ${BUBBLE_FONT}`
  }
  return canvasCtx
}

/**
 * 测量文本对应的渲染尺寸(气泡 / 居中文本共用)
 *
 * 表情以 <img> 渲染(1em 高),ruler 用真实 HTML 排版,实测宽度包含表情
 * 的真实渲染宽度;canvas 估算将表情 token 展开为等宽空格作后备。
 *
 * @param config 测量定义(最大内宽 / 边距 / 最小尺寸)
 * @param text   消息文本(支持 \n 换行,可含表情 token)
 * @returns      外框宽高 + 内文宽度
 */
function measureWith(config: MeasureConfig, text: string): BubbleBox {
  const innerMax = config.innerMax
  const ctx = getCanvasCtx()

  // 第一轮:canvas 估算
  ensureBubbleFont().catch(() => {})
  let innerW = 0
  let canvasLines = 1
  for (const seg of text.split('\n')) {
    const w = measureTextWithEmoji(ctx, seg)
    innerW = Math.max(innerW, Math.min(w, innerMax))
    canvasLines += Math.max(0, Math.ceil(w / innerMax) - 1)
  }

  // 第二轮:ruler DOM 实测,优先采用
  let lines = canvasLines
  let rulerW = 0
  const rulerEl = getRuler()
  rulerEl.style.width = `${innerMax}px`
  // 表情内联 em 尺寸:高度 1em、宽度按原图宽高比,图片加载前也能按真实宽高参与布局
  rulerEl.innerHTML = emojiToHtml(text)
  const rulerLines = Math.round(rulerEl.scrollHeight / BUBBLE_LINE_HEIGHT)
  if (Number.isFinite(rulerLines) && rulerLines > 0) lines = rulerLines
  // 内容宽:取最宽一行的真实渲染宽度。
  // 不能读 scrollWidth——内容不溢出时 scrollWidth 恒等于容器宽(innerMax),
  // 会把短消息撑到最大宽度;getClientRects 返回每行的真实 rect。
  const range = document.createRange()
  range.selectNodeContents(rulerEl)
  let contentW = 0
  for (const r of range.getClientRects()) contentW = Math.max(contentW, r.width)
  rulerW = Math.min(contentW, innerMax)
  innerW = Math.max(innerW, rulerW)

  return {
    rectW: Math.max(config.minW, innerW + config.padX * 2),
    rectH: Math.max(config.minH, lines * BUBBLE_LINE_HEIGHT + config.padY * 2),
    innerW,
  }
}

/**
 * 隐藏 "自然宽" ruler 单例(导出场景专用)
 *
 * 与 getRuler 的区别见 measureNaturalWith。复用浏览器真实排版读取 natural 宽:
 * - 显示宽度固定 innerMax(与真实气泡内文一致),读取"最宽一行"的实轴线框宽;
 * - 该行宽就是内容自然宽(单行文本 = 整行宽;超 innerMax 的行 = innerMax);
 *   语义等价于 .text { width: fit-content }(结果相同)。
 * 注意:不能用 width: fit-content 让 Div 收缩——定位元素 shrink-to-fit 在部分
 * 环境(无头/zoom)下会量成 0,不稳;改由 getClientRects 里最宽行框来量。
 */
let naturalRuler: HTMLDivElement | null = null

function getNaturalRuler(): HTMLDivElement {
  if (!naturalRuler) {
    const el = document.createElement('div')
    el.style.cssText =
      `position:fixed;left:-99999px;top:0;visibility:hidden;pointer-events:none;` +
      `white-space:pre-line;word-break:break-word;` +
      `font-family:${BUBBLE_FONT};font-size:${BUBBLE_FONT_SIZE}px;line-height:${BUBBLE_LINE_HEIGHT}px;`
    document.body.appendChild(el)
    naturalRuler = el
  }
  return naturalRuler
}

/**
 * 以"自然内容宽"语义测量文本渲染尺寸(导出场景专用)
 *
 * 与 measureWith 的差异:
 * - measureWith:宽度钳在 innerMax,短消息也会按最宽行内容宽显示(与屏幕一致);
 * - measureBubbleNatural:宽度 = 最宽每行内容宽(≤ innerMax),贴合导出瞬间浏览器
 *   真实排版,避免沿用早前冻结 innerW 导致换行/边距与导出不一致。
 *
 * 两者实测口径相同(最宽一行 getClientRects),差异只在调用时机与是否允许复用冻结
 * 缓存;natural 版由导出 stage 在字体就绪后重测,且仅导出用。
 *
 * 注意:调用方须先用 ensureBubbleFont() 确认字体就绪,否则浏览器按回退字体自然排版,
 * 结果仍会偏差(导出前字体由 captureRegion 内联,须在同一个阶段内测量)。
 */
function measureNaturalWith(config: MeasureConfig, text: string): BubbleBox {
  const innerMax = config.innerMax
  const rulerEl = getNaturalRuler()
  // 宽度固定 innerMax(与气泡内文一致),仅读取浏览器真实排版里的最宽一行
  rulerEl.style.width = `${innerMax}px`
  rulerEl.style.maxWidth = ''
  // 真实 <img> 表情排版(与气泡一致),图片按其内联 em 尺寸参与布局
  rulerEl.innerHTML = emojiToHtml(text)
  const lines = Math.max(1, Math.round(rulerEl.scrollHeight / BUBBLE_LINE_HEIGHT))
  // 内容宽:取最宽一行的真实渲染宽度(≤ innerMax),与 measureWith 同口径
  const range = document.createRange()
  range.selectNodeContents(rulerEl)
  let contentW = 0
  for (const r of range.getClientRects()) contentW = Math.max(contentW, r.width)
  contentW = Math.min(Math.max(contentW, 0), innerMax)
  return {
    rectW: Math.max(config.minW, contentW + config.padX * 2),
    rectH: Math.max(config.minH, lines * BUBBLE_LINE_HEIGHT + config.padY * 2),
    innerW: contentW,
  }
}

/**
 * 测量文本对应的气泡尺寸(natural 版)
 *
 * 与 measureBubble 的关系:normal 模式(主画布)用 measureBubble(钳 maxWidth),
 * 固定屏幕上的最大显示宽;导出模式用 measureBubbleNatural(浏览器自然宽),
 * 保证导出与浏览器实时排版一致(等效 width:fit-content 语义)。
 *
 * @param text 气泡文本(支持 \n 换行,可含表情 emoji)
 * @returns     气泡 rect 宽高 + 内文宽度
 */
export function measureBubbleNatural(text: string): BubbleBox {
  return measureNaturalWith(
    {
      innerMax: BUBBLE_INNER_MAX_W,
      padX: BUBBLE_PAD_X,
      padY: BUBBLE_PAD_Y,
      minW: BUBBLE_MIN_W,
      minH: BUBBLE_MIN_H,
    },
    text,
  )
}

/**
 * 测量文本对应的气泡尺寸
 *
 * @param text 气泡文本(支持 \n 换行,可含表情 emoji)
 * @returns     气泡 rect 宽高 + 内文宽度
 */
export function measureBubble(text: string): BubbleBox {
  return measureWith(
    {
      innerMax: BUBBLE_INNER_MAX_W,
      padX: BUBBLE_PAD_X,
      padY: BUBBLE_PAD_Y,
      minW: BUBBLE_MIN_W,
      minH: BUBBLE_MIN_H,
    },
    text,
  )
}

/**
 * 测量居中提示文本的渲染尺寸
 *
 * 与气泡测量同法,但无气泡内边距 / 最小尺寸约束:
 * 外框宽高即内容宽高,限宽 CENTER_MAX_W,超出换行。
 *
 * @param text 居中提示文本(支持 \n 换行,可含表情 token)
 * @returns     文本 rect 宽高 + 内文宽度
 */
export function measureCentered(text: string): BubbleBox {
  return measureWith(
    {
      innerMax: CENTER_MAX_W,
      padX: 0,
      padY: 0,
      minW: 0,
      minH: 0,
    },
    text,
  )
}

/**
 * 测量居中提示文本的渲染尺寸(natural 版)
 *
 * 导出场景用(与 measureBubbleNatural 配套):用 fit-content 自然宽语义让浏览器按
 * 导出瞬间真实排版决定宽度,避免沿用冻结宽度导致换行不一致。
 *
 * @param text 居中提示文本(支持 \n 换行,可含表情 token)
 * @returns     文本 rect 宽高 + 内文宽度
 */
export function measureCenteredNatural(text: string): BubbleBox {
  return measureNaturalWith(
    {
      innerMax: CENTER_MAX_W,
      padX: 0,
      padY: 0,
      minW: 0,
      minH: 0,
    },
    text,
  )
}