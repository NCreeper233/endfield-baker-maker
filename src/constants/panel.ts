// =============================================================================
// 底部面板共用几何(播放模式 ChoicePanel / 编辑模式 EditModePanel / ChatArea)
// -----------------------------------------------------------------------------
// 三个模块此前各自硬编码同一套贴底公式与常量,收敛于此保证口径一致:
//   - 面板左/宽 = chat_strip_detail 左右各缩 2px
//   - 面板顶 = detail 底边 - 面板高 - 3px
//   - 顶部装饰图:距面板上端 5px,水平居中,悬浮于面板上边缘上方
//   - 面板上方遮罩横条:与面板同宽,底边贴面板上缘,向上延展 EDGE_MASK_H
// =============================================================================

import { CHAT_SHOTS } from './design'

/** 面板位置:左 = detail 左边界 + 2px,宽 = detail 宽 - 4px(左右各缩 2px) */
export const PANEL = {
  left: CHAT_SHOTS.detail.x + 2,
  width: CHAT_SHOTS.detail.w - 4,
} as const

/** 面板最小高度(px):三个选项刚好放下的现状高度 */
export const PANEL_MIN_H = 230
/** 选项按钮高度(px,与按钮 CSS 一致) */
export const PANEL_BTN_H = 46
/** 选项按钮间距(px,与按钮 CSS gap 一致) */
export const PANEL_BTN_GAP = 22
/** 面板上下留空(px) */
export const PANEL_PAD_V = 20
/** 面板上方遮罩横条高度(px):消息贴近面板时渐隐的过渡带 */
export const PANEL_EDGE_MASK_H = 60
/** 顶部装饰图原始尺寸(px,用于绝对定位) */
export const PANEL_TOP_DECO_W = 1312
export const PANEL_TOP_DECO_H = 16

/**
 * 面板高度(px):随选项数动态调整
 *
 * 最小为 PANEL_MIN_H;更多选项时按"上下留空 + 按钮 × 按钮高 + 间距"自然增高。
 *
 * @param optionCount 摊平后的选项总数
 */
export function panelHeight(optionCount: number): number {
  return Math.max(
    PANEL_MIN_H,
    PANEL_PAD_V * 2 + optionCount * PANEL_BTN_H + Math.max(0, optionCount - 1) * PANEL_BTN_GAP,
  )
}

/**
 * 面板顶(px):detail 底边 - 面板高 - 3px(整体上移 3px,播放/编辑模式一致)
 *
 * @param height 面板实际高度
 */
export function panelTop(height: number): number {
  return CHAT_SHOTS.detail.y + CHAT_SHOTS.detail.h - height - 3
}

/** 遮罩横条坐标:与面板同宽,底边对齐面板上边缘,向上延展 EDGE_MASK_H */
export const PANEL_EDGE_MASK = {
  left: PANEL.left,
  width: PANEL.width,
  height: PANEL_EDGE_MASK_H,
} as const

/** 顶部装饰图相对面板的偏移:距上端 5px,水平居中 */
export const PANEL_TOP_DECO_REL = {
  top: -PANEL_TOP_DECO_H - 5,
  left: (PANEL.width - PANEL_TOP_DECO_W) / 2,
} as const