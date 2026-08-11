// =============================================================================
// 聊天区绝对定位工具与按钮几何
// -----------------------------------------------------------------------------
// 纯函数 + 常量,无任何状态:
//  - pos():生成 { left/top/width/height } 样式对象(所有模板定位共用)
//  - bubbleBodyLR():气泡主体水平区间(删除/热区按钮共用)
//  - delBtnHotZoneStyle / delBtnStyle / addBtnStyle:编辑模式消息操作按钮定位
//  - 消息删除按钮常量
// 供 ChatArea.vue 与 useChatRows 共享,避免组件内重复定义。
// 聊天布局常量(末尾装饰 / 尾部留白 / 选项面板间距)收敛于 constants/design.ts。
// =============================================================================

import { CHAT_SCROLL } from '../constants/design'
import { BUBBLE_TAIL_OFFSET } from './measure'
import type { CSSProperties } from 'vue'
import type { ChatRow } from '../types/chat'

/**
 * 绝对定位盒的 style 对象
 *
 * 兼容 Vue 模板 :style 的 StyleValue 类型约束。
 */
export type BoxStyle = CSSProperties

/**
 * 生成绝对定位盒的 style 对象
 *
 * @param x  left
 * @param y  top
 * @param w  width
 * @param h  height
 */
export function pos(x: number, y: number, w: number, h: number): BoxStyle {
  return {
    left: `${x}px`,
    top: `${y}px`,
    width: `${w}px`,
    height: `${h}px`,
  }
}

// ---- 角色名称悬浮(带头像消息的气泡上方) --------------------------------------
/** 名称行高(px,须与 .chat-speaker-name 的 font-size/line-height 一致) */
export const SPEAKER_NAME_LINE = 15
/** 名称下方留白(px):名称底边与气泡顶部的间距 */
export const SPEAKER_NAME_GAP = 2
/** 名称额外上移量(px):在气泡上方空隙内再抬高,视觉居中于空隙 */
export const SPEAKER_NAME_LIFT = 7
/** 我方名称向头像方向水平偏移(px):mine 侧名称右缘锚定气泡右缘后,再向右侧(头像侧)平移 */
export const SPEAKER_NAME_MINE_AVATAR_OFFSET = 15

/**
 * 角色名称悬浮样式:锚定在气泡上缘上方、贴气泡侧缘,悬浮于消息间空隙
 *
 * 名称不占布局(absolute),靠每行带头像前的间距(跨方向 33 / 换人 60)容纳,
 * 故无需改动布局常量。方向锚定跟随气泡:
 * - other:左缘起向右排(left)
 * - mine:右缘起向左排(text-align:right + translateX(-100%)),并再向头像侧平移 15px
 *
 * @param side         消息方向
 * @param bubbleLeft   气泡盒左缘(滚动坐标)
 * @param bubbleRight  气泡盒右缘(滚动坐标)
 * @param bubbleTop    气泡盒顶部(滚动坐标)
 */
export function speakerNameStyle(
  side: 'other' | 'mine',
  bubbleLeft: number,
  bubbleRight: number,
  bubbleTop: number,
): BoxStyle {
  const left = side === 'other' ? bubbleLeft : bubbleRight + SPEAKER_NAME_MINE_AVATAR_OFFSET
  return {
    left: `${left}px`,
    top: `${bubbleTop - SPEAKER_NAME_LINE - SPEAKER_NAME_GAP - SPEAKER_NAME_LIFT}px`,
    transform: side === 'other' ? 'none' : 'translateX(-100%)',
    textAlign: side === 'other' ? 'left' : 'right',
  }
}

// ---- 编辑模式消息操作按钮常量 ------------------------------------------------
/** 删除按钮图标原始尺寸 42×43(不缩放):视觉宽 */
export const MSG_DEL_BTN_W = 36
/** 删除按钮视觉高 */
export const MSG_DEL_BTN_H = 37
/** 删除按钮与气泡主体的水平间距 */
export const MSG_DEL_GAP = 10
/** 触发区域超出气泡边缘的额外宽度(气泡外左/右 15px 也触发按钮显示) */
export const MSG_DEL_HOT = 15

/** "补头像"按钮视觉图标尺寸 36×36(icon_btn_cancel 旋转 45°:X → +) */
export const PLUS_VIS = 36
/** "补头像"按钮悬停判定区在视觉外每侧再扩的宽度(更易触发) */
export const PLUS_HIT = 10

/** 气泡尾巴偏移(px),与 measure.BUBBLE_TAIL_OFFSET 一致 */
const TAIL = BUBBLE_TAIL_OFFSET

/**
 * 气泡主体水平区间(滚动坐标)
 *
 * 居中提示文本 / 分段面板无气泡尾巴,主体左缘 = 内容左缘(无 TAIL 偏移);
 * 其余消息气泡盒左缘需向右让出尾巴区。
 */
function bubbleBodyLR(row: ChatRow): { bodyLeft: number; bodyRight: number } {
  const scrolledLeft = row.left - CHAT_SCROLL.x
  const bodyLeft = scrolledLeft + (row.msg.centered || row.msg.panel ? 0 : TAIL)
  return { bodyLeft, bodyRight: bodyLeft + row.box.rectW }
}

/**
 * 删除按钮的扩展触发区样式(仅驱动 hoverId 显示按钮,不显示任何内容)
 *
 * 功能:除悬停在消息本体外,悬停到消息气泡左/右侧 15px 的空白地带也能显示删除按钮。
 * - mine : 气泡主体左缘向左 15px 的条带
 * - other: 气泡主体右缘向右 15px 的条带
 * - 分段面板(panel):删除按钮恒在右侧,右缘向右 15px 的条带
 * - 居中提示文本(centered):删除/添加按钮均在文本右缘之外,此处从文本右缘起
 *   覆盖整个按钮区(删除钮 + 添加钮 + 间距),悬停即显示两个按钮;
 *   不覆盖文字本体,保证居中文本仍可点击编辑。
 */
export function delBtnHotZoneStyle(row: ChatRow): BoxStyle {
  const { bodyLeft, bodyRight } = bubbleBodyLR(row)
  const scrolledTop = row.bubbleTop - CHAT_SCROLL.y
  const height = Math.max(row.box.rectH, MSG_DEL_BTN_H)
  // 居中提示文本:右缘外条带 = 删除钮 + 添加钮(含其悬停判定外扩)所占区域
  if (row.msg.centered) {
    const width = MSG_DEL_GAP + MSG_DEL_BTN_W + MSG_DEL_GAP + PLUS_VIS + PLUS_HIT * 2
    return pos(bodyRight, scrolledTop, width, height)
  }
  // 分段面板:删除按钮恒在右侧(其他消息仍按我方在左 / 对方在右)
  const onRight = row.msg.side === 'other' || !!row.msg.panel
  const hot = onRight
    ? { left: bodyRight, width: MSG_DEL_HOT }
    : { left: bodyLeft - MSG_DEL_HOT, width: MSG_DEL_HOT }
  return pos(hot.left, scrolledTop, hot.width, height)
}

/**
 * 删除消息按钮的定位样式
 *
 * - 我方(mine):气泡左侧(气泡主体左缘 = 气泡盒左 + 尾巴偏移)
 * - 对方(other):气泡右侧(气泡主体右缘 = 气泡盒左 + 尾巴偏移 + 气泡宽)
 * 垂直方向相对气泡中线居中。
 */
export function delBtnStyle(row: ChatRow): BoxStyle {
  const { bodyLeft, bodyRight } = bubbleBodyLR(row)
  const scrolledTop = row.bubbleTop - CHAT_SCROLL.y
  // 居中提示文本 / 分段面板:删除按钮恒在右侧(mine 消息其余仍按我方在左 / 对方在右)
  const btnLeft = row.msg.side === 'mine' && !row.msg.panel && !row.msg.centered
    ? bodyLeft - MSG_DEL_BTN_W - MSG_DEL_GAP
    : bodyRight + MSG_DEL_GAP
  const btnTop = scrolledTop + (row.box.rectH - MSG_DEL_BTN_H) / 2
  return pos(btnLeft, btnTop, MSG_DEL_BTN_W, MSG_DEL_BTN_H)
}

/**
 * "添加"按钮的定位样式:位于删除按钮(icon_btn_cancel)右侧
 *
 * 两种形态(同一工厂,hasTail 区分气泡有无尾巴):
 * - hasTail=true("补头像"按钮):只出现在对方(other)消息上(无头像的合并消息),
 *   气泡主体右缘起往右排,与删除按钮成对出现
 * - hasTail=false(居中提示文本):无气泡尾巴,主体右缘 = 文字右缘
 * 视觉图标 36×36 在扩大的悬停判定盒(每侧扩 PLUS_HIT)内居中,
 * 位置中心与删除按钮水平对齐。
 */
export function addBtnStyle(row: ChatRow, hasTail: boolean): BoxStyle {
  const scrolledTop = row.bubbleTop - CHAT_SCROLL.y
  const bodyLeft = row.left - CHAT_SCROLL.x + (hasTail ? TAIL : 0)
  const bodyRight = bodyLeft + row.box.rectW
  const visLeft = bodyRight + MSG_DEL_GAP + MSG_DEL_BTN_W + MSG_DEL_GAP
  const visTop = scrolledTop + (row.box.rectH - PLUS_VIS) / 2
  const box = PLUS_VIS + PLUS_HIT * 2
  return pos(visLeft - PLUS_HIT, visTop - PLUS_HIT, box, box)
}
