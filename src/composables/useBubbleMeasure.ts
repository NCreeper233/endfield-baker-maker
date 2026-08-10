// =============================================================================
// useBubbleMeasure:气泡尺寸测量(带缓存)
// -----------------------------------------------------------------------------
// computed 重算时同一段文本会被反复测量,用 Map 缓存 text -> BubbleBox 避免
// 重复触发 ruler DOM 重排;编辑消息文本后调用 clearCache 失效缓存。
// =============================================================================

import { measureBubble, measureBubbleNatural, type BubbleBox } from '../utils/measure'

/** 普通测量缓存(主画布屏幕态) */
const cache = new Map<string, BubbleBox>()
/** 导出自然测量缓存(与普通测量隔离,避免互相污染/冻结) */
const naturalCache = new Map<string, BubbleBox>()

/**
 * 气泡测量 composable
 *
 * @param options.natural 导出自然模式:measure 用 fit-content 自然宽语义
 *                        (浏览器实时排版),且走独立缓存,不读屏上冻结的普通缓存
 * @returns measure(text) 测量函数(带缓存)
 *          clearCache()  清空缓存(后续编辑消息文本时调用)
 */
export function useBubbleMeasure(options?: { natural?: boolean }) {
  const natural = options?.natural ?? false
  const hitsMap = natural ? naturalCache : cache

  /**
   * 测量文本对应的气泡尺寸(命中缓存则直接返回)
   *
   * @param text  消息文本
   */
  function measure(text: string): BubbleBox {
    const hit = hitsMap.get(text)
    if (hit) return hit
    const result = natural ? measureBubbleNatural(text) : measureBubble(text)
    hitsMap.set(text, result)
    return result
  }

  /** 清空当前模式缓存 */
  function clearCache() {
    hitsMap.clear()
  }

  return { measure, clearCache }
}

/**
 * 清空导出自然测量缓存(模块级)
 *
 * ChatExportStage 在等气泡字体真正就绪后、挂载 ChatArea 之前调用:每个导出会话都
 * 让气泡在"正确字体下的浏览器自然排版"重新测量,不沿用历史冻结宽度。
 * 只清 naturalCache,不影响主画布屏幕态的普通测量缓存。
 */
export function clearNaturalBubbleMeasureCache() {
  naturalCache.clear()
}
