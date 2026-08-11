// =============================================================================
// 方形图片裁剪(useSquareCrop)
// -----------------------------------------------------------------------------
// 为自定义角色弹窗的"上传图片 → 方形裁剪"服务:
//   - 载入图片后 cover 适配方形视口(图片铺满且不露边)
//   - 拖拽平移(钳制在铺满范围内)、缩放(滑杆 / 滚轮,下限 cover、上限 cover×4)
//   - exportSquare() 把当前视口所见区域导出为方形 data URL(默认 512×512)
//
// 几何模型:
//   - 视口是 displaySize×displaySize 的方形,overflow:hidden
//   - 图片以 scale(显示 px / 源 px)摆放,left/top = offsetX/offsetY
//   - offsetX ∈ [displaySize - naturalW·scale, 0](图片始终覆盖视口)
//   - 缩放时以视口中心为不动点,保证缩放前后看到的中心内容一致
// =============================================================================
import { computed, ref, shallowRef } from 'vue'

/** 视口方形边长(px) */
const DEFAULT_DISPLAY_SIZE = 220
/** 最高缩放倍数(相对 cover 基准) */
const MAX_ZOOM_MULTIPLIER = 4
/** 导出方形边长(px) */
const DEFAULT_EXPORT_SIZE = 512

/** 读取文件为 data URL(失败 reject) */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

/**
 * @param options.displaySize 视口边长(px,须与视口 CSS 尺寸一致)
 *
 * 指针事件由调用方在视口元素上绑定(模板 @pointerdown/Move/Up):
 * 视口元素可能晚于挂载才出现(v-if 控制),组合式本身不自我挂监听。
 */
export function useSquareCrop(options: { displaySize?: number } = {}) {
  const { displaySize = DEFAULT_DISPLAY_SIZE } = options

  /** 已载入的原图(未上传 / clear 后为 null) */
  const img = shallowRef<HTMLImageElement | null>(null)
  /** 是否正在解码图片 */
  const loading = ref(false)
  /** 缩放倍数(显示 px / 源 px,≥ coverScale) */
  const scale = ref(1)
  /** 图片相对视口左上角 x 偏移(px,≤0) */
  const offsetX = ref(0)
  /** 图片相对视口左上角 y 偏移(px,≤0) */
  const offsetY = ref(0)

  let naturalW = 0
  let naturalH = 0
  /** cover 基准缩放:恰好铺满视口 */
  let coverScale = 1

  let dragging = false
  let lastX = 0
  let lastY = 0

  const minScale = () => coverScale
  const maxScale = () => coverScale * MAX_ZOOM_MULTIPLIER

  /** 钳制平移,保证图片任意角都盖住视口(不露背景) */
  function clampOffsets() {
    if (!img.value || naturalW === 0) {
      offsetX.value = 0
      offsetY.value = 0
      return
    }
    const w = naturalW * scale.value
    const h = naturalH * scale.value
    const minX = displaySize - w
    const minY = displaySize - h
    offsetX.value = Math.min(0, Math.max(minX, offsetX.value))
    offsetY.value = Math.min(0, Math.max(minY, offsetY.value))
  }

  /** 回到 cover 适配(初始 / 重新加载图片时) */
  function resetFit() {
    if (!img.value || naturalW === 0) return
    scale.value = coverScale
    offsetX.value = (displaySize - naturalW * coverScale) / 2
    offsetY.value = (displaySize - naturalH * coverScale) / 2
    clampOffsets()
  }

  /** 载入用户选择的图片并 cover 适配 */
  async function loadFile(file: File): Promise<void> {
    if (!file.type.startsWith('image/')) throw new Error('请选择图片文件')
    const dataUrl = await readFileAsDataUrl(file)
    await loadUrl(dataUrl)
  }

  /** 载入已有 dataURL(如预载入已保存的自定义头像)并 cover 适配 */
  async function loadUrl(dataUrl: string): Promise<void> {
    loading.value = true
    try {
      const el = new Image()
      el.src = dataUrl
      await el.decode()
      naturalW = el.naturalWidth
      naturalH = el.naturalHeight
      if (naturalW === 0 || naturalH === 0) throw new Error('图片尺寸无效')
      coverScale = Math.max(displaySize / naturalW, displaySize / naturalH)
      img.value = el
      resetFit()
    } finally {
      loading.value = false
    }
  }

  /** 清空已载入图片(换图 / 关闭弹窗时) */
  function clear() {
    img.value = null
    naturalW = 0
    naturalH = 0
    scale.value = 1
    offsetX.value = 0
    offsetY.value = 0
    dragging = false
  }

  function hasImage() {
    return !!img.value && naturalW > 0
  }

  /** 图片在视口内的显示位置/尺寸 */
  const imageStyle = computed(() => {
    if (!hasImage()) return {}
    return {
      left: `${offsetX.value}px`,
      top: `${offsetY.value}px`,
      width: `${naturalW * scale.value}px`,
      height: `${naturalH * scale.value}px`,
    }
  })

  /** 已将中心设为不动点缩放 */
  function setScale(next: number) {
    if (!hasImage()) return
    const clamped = Math.min(maxScale(), Math.max(minScale(), next))
    if (clamped === scale.value) return
    const cx = displaySize / 2
    const cy = displaySize / 2
    const ratio = clamped / scale.value
    offsetX.value = cx - ratio * (cx - offsetX.value)
    offsetY.value = cy - ratio * (cy - offsetY.value)
    scale.value = clamped
    clampOffsets()
  }

  /** 滚轮 / +/- 按钮:以基准的幂次缩放(delta>0 放大) */
  function zoomBy(delta: number) {
    setScale(scale.value * Math.pow(1.12, delta))
  }

  /** 滑杆:ratio ∈ [0,1] 映射到 [cover, cover×4] */
  function setScaleFromRatio(ratio: number) {
    setScale(minScale() + ratio * (maxScale() - minScale()))
  }

  /** 当前缩放比例(0=cover,1=最大) */
  const zoomRatio = computed(() => {
    if (maxScale() === minScale()) return 0
    return (scale.value - minScale()) / (maxScale() - minScale())
  })

  // ---- 指针拖拽(由调用方在视口元素上绑定;pointer capture 保证拖出视口仍能跟随) ----
  function onPointerDown(e: PointerEvent) {
    if (!hasImage()) return
    dragging = true
    lastX = e.clientX
    lastY = e.clientY
    ;(e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId)
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging) return
    offsetX.value += e.clientX - lastX
    offsetY.value += e.clientY - lastY
    lastX = e.clientX
    lastY = e.clientY
    clampOffsets()
  }

  function onPointerUp(e: PointerEvent) {
    dragging = false
    ;(e.currentTarget as HTMLElement | null)?.releasePointerCapture?.(e.pointerId)
  }

  function onPointerCancel(e: PointerEvent) {
    onPointerUp(e)
  }

  /**
   * 导出当前视口所见为方形 data URL
   *
   * 视口显示的是 displaySize/source 大小的源图区域,原样画到 size×size 画布。
   *
   * @param size 导出边长(默认 512)
   */
  function exportSquare(size = DEFAULT_EXPORT_SIZE): string {
    if (!hasImage()) throw new Error('没有可导出的图片')
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建画布')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    const srcSize = displaySize / scale.value
    const sx = -offsetX.value / scale.value
    const sy = -offsetY.value / scale.value
    ctx.drawImage(img.value!, sx, sy, srcSize, srcSize, 0, 0, size, size)
    try {
      return canvas.toDataURL('image/webp', 0.9)
    } catch {
      // webp 编码不可用时回退 png
      return canvas.toDataURL('image/png')
    }
  }

  return {
    img,
    loading,
    hasImage,
    imageStyle,
    zoomRatio,
    loadFile,
    loadUrl,
    clear,
    zoomBy,
    setScaleFromRatio,
    exportSquare,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  }
}