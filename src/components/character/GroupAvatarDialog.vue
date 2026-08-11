<script setup lang="ts">
// =============================================================================
// 自定义群聊头像弹窗(GroupAvatarDialog)
// -----------------------------------------------------------------------------
// 由编辑模式点击"父级群聊卡片头像"触发(事件链 CharacterCardItem →
// CharacterCardList → App)。布局与"添加自定义角色"弹窗的裁剪区完全一致:
// 上=方形裁剪预览(上传 + 拖拽平移 + 缩放),下=保存 / 取消。
// 确认后产出方形 dataURL(512×512),由 App 写入对应卡片(groupAvatar);
// 已存在自定义头像时打开会预载入便于微调,并可"恢复默认"清除。
// =============================================================================
import { ref, useTemplateRef, watch } from 'vue'
import { MATERIALS } from '../../constants/materials'
import { useSquareCrop } from '../../composables/useSquareCrop'

/** 裁剪视口方形边长(px,须与 useSquareCrop 的 displaySize 一致) */
const CROP_SIZE = 220

const props = defineProps<{
  /** 是否展开(由 App 的卡片头像点击控制) */
  open: boolean
  /** 已保存的自定义群聊头像 dataURL(未设置时 undefined;存在时显示"恢复默认") */
  currentAvatar?: string
  /**
   * 已保存头像的原始源图 dataURL(裁剪前)
   *
   * 存在时优先预载入它重新裁剪,保留框外原始内容;
   * 缺失(旧数据)时回退预载入 currentAvatar。
   */
  currentAvatarSource?: string
}>()

const emit = defineEmits<{
  /** 点"保存"裁出新的方形群聊头像(附裁剪前的原始源图) */
  (e: 'saved', avatar: string, source?: string): void
  /** 点"恢复默认":清除该卡片自定义头像(回退默认群聊图) */
  (e: 'reset'): void
  /** 关闭弹窗(取消 / 遮罩 / ×) */
  (e: 'close'): void
}>()

/** 裁剪组合式:拖拽平移 / 缩放 / 导出,指针事件由模板绑定在裁剪视口上 */
const {
  img: cropImg,
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
} = useSquareCrop({ displaySize: CROP_SIZE })

/** 隐藏的文件选择 input(由"上传图片"触发) */
const fileInput = useTemplateRef<HTMLInputElement>('fileInput')

/**
 * 载入代次计数:用来作废"过期的异步载入结果"
 *
 * open 时的预载入(currentAvatarSource/currentAvatar)与用户上传都是异步收尾
 * (await loadUrl → 最终 img.value = el)。若不隔离,慢速的预载入会在用户上传
 * 新图之后才完成,把用户刚选中的新图静默覆盖成旧头像。每次 open / 用户上传
 * 递增代次,await 返回后代次不一致即丢弃结果。
 */
let loadEpoch = 0

/**
 * 每次展开弹窗:
 * - 已有自定义头像 → 预载入其**原始源图**(保留框外内容,可重新裁剪);
 *   旧数据无源图时回退预载入已裁好的方形头像
 * - 无自定义头像 → 从空裁剪区开始(必须重新选图)
 */
watch(
  () => props.open,
  async (open) => {
    if (!open) return
    const epoch = ++loadEpoch
    const preset = props.currentAvatarSource ?? props.currentAvatar
    if (preset) {
      try {
        await loadUrl(preset)
        if (epoch !== loadEpoch) return
      } catch (err) {
        if (epoch !== loadEpoch) return
        console.warn('[GroupAvatarDialog] 预载入现有头像失败', err)
        clear()
      }
    } else {
      clear()
    }
  },
)

function onPickFile() {
  fileInput.value?.click()
}

/** 上传图片 → 载入裁剪区(失败保留原图不变) */
async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  // 用户主动上传:立即作废任何在途的 open 预载入,防止旧图迟到覆盖新图
  loadEpoch++
  try {
    await loadFile(file)
  } catch (err) {
    console.warn('[GroupAvatarDialog] 图片读取失败', err)
  }
}

/** 滚轮缩放:@wheel.prevent 阻止页面滚动;向下滚 zoomBy(-1) 缩小 */
function onWheel(e: WheelEvent) {
  zoomBy(e.deltaY < 0 ? 1 : -1)
}

/** 点"保存":裁剪导出方形群聊头像后上抛 saved(附原始源图供再次微调) */
function onSave() {
  if (!hasImage()) return
  // 源图 = 当前裁剪区载入的原图(保留框外内容),随保存一并上抛
  emit('saved', exportSquare(512), cropImg.value?.src)
  emit('close')
}

/** 点"恢复默认":清除自定义头像并关闭弹窗 */
function onReset() {
  emit('reset')
  emit('close')
}
</script>

<template>
  <Transition name="ga">
    <div v-if="open" class="ga" @click.self="emit('close')">
      <div class="ga__panel">
        <!-- 背景装饰:左上角 + 右下角两张,原始尺寸原样贴角 -->
        <img class="ga__corner ga__corner--tl" :src="MATERIALS.editPopDecoTl" alt="" />
        <img class="ga__corner ga__corner--br" :src="MATERIALS.editPopDecoBr" alt="" />
        <!-- 右上角 × 关闭按钮 -->
        <button class="ga__close" type="button" aria-label="关闭" @click="emit('close')">×</button>
        <h2 class="ga__title">自定义群聊头像</h2>

        <!-- 方形裁剪预览区 -->
        <div class="ga__preview">
          <div
            v-if="hasImage()"
            class="ga__crop"
            :style="{ width: CROP_SIZE + 'px', height: CROP_SIZE + 'px' }"
            @wheel.prevent="onWheel"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointercancel="onPointerCancel"
          >
            <img class="ga__crop-img" :style="imageStyle" :src="cropImg?.src" alt="" />
            <!-- 提示拖动 / 滚轮缩放 -->
            <p class="ga__crop-hint">拖动移动 · 滚轮缩放</p>
          </div>

          <div v-else class="ga__empty" :style="{ width: CROP_SIZE + 'px', height: CROP_SIZE + 'px' }">
            <button class="ga__empty-btn" type="button" @click="onPickFile">上传图片</button>
            <p class="ga__empty-hint">将图片裁剪为方形群聊头像</p>
          </div>
        </div>

        <!-- 缩放控制(仅已上传时显示) -->
        <div v-if="hasImage()" class="ga__zoom">
          <button class="ga__zoom-btn" type="button" aria-label="缩小" @click="zoomBy(-1)">−</button>
          <input
            class="ga__zoom-range"
            type="range"
            min="0"
            max="1"
            step="0.01"
            :value="zoomRatio"
            @input="setScaleFromRatio(parseFloat(($event.target as HTMLInputElement).value))"
          />
          <button class="ga__zoom-btn" type="button" aria-label="放大" @click="zoomBy(1)">＋</button>
          <button class="ga__zoom-repick" type="button" @click="onPickFile">重新上传</button>
        </div>
        <input
          ref="fileInput"
          type="file"
          accept="image/*"
          class="ga__file-input"
          @change="onFileChange"
        />

        <!-- 保存 / 取消 / 恢复默认 -->
        <div class="ga__actions">
          <button
            class="ga__btn ga__btn--primary"
            type="button"
            :disabled="!hasImage()"
            @click="onSave"
          >
            保存
          </button>
          <button class="ga__btn" type="button" @click="emit('close')">取消</button>
          <button v-if="currentAvatar" class="ga__btn ga__btn--reset" type="button" @click="onReset">
            恢复默认
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped lang="scss">
@use '../../styles/variables' as *;
@use '../../styles/mixins' as *;

// 弹窗外壳复用 dialog-shell(遮罩 / 面板 / 角饰 / 关闭钮 / 标题 / 按钮 / 转场)
// 操作区不换行:三个按钮(保存/恢复默认/取消)始终同一排,
// 宽度由组件内 .ga__actions/.ga__btn 的 flex 分配决定
@include dialog-shell(ga, 460px, 70%, 10px);

.ga {
  // ---- 操作区:三个按钮(保存/恢复默认/取消)始终同一排 --------------------
  &__actions {
    flex-wrap: nowrap;
  }

  &__btn {
    // 平均分摊行宽,允许按钮收窄到内容宽度以内(默认 min-width 132px 过宽
    // 会迫使第三个按钮换行)
    flex: 1 1 0;
    min-width: 0;
  }

  // ---- 裁剪预览 --------------------------------------------------------
  &__preview {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-bottom: 14px;
  }

  &__crop {
    position: relative;
    overflow: hidden;
    border-radius: 10px;
    border: 1px solid $color-chat-frame;
    background: #111;
    cursor: grab;
    touch-action: none;

    &:active {
      cursor: grabbing;
    }
  }

  &__crop-img {
    position: absolute;
    display: block;
    user-select: none;
    -webkit-user-drag: none;
  }

  &__crop-hint {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 8px;
    margin: 0;
    text-align: center;
    font-family: $font-harmony;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.82);
    pointer-events: none;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
  }

  &__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    border-radius: 10px;
    border: 1px dashed $color-chat-frame;
    background: rgba(255, 255, 255, 0.04);
  }

  &__empty-btn {
    padding: 8px 20px;
    border: none;
    border-radius: 999px;
    background: $color-btn-bg;
    color: $color-btn-icon;
    font-family: $font-harmony;
    font-size: 15px;
    cursor: pointer;

    &:hover {
      filter: brightness(0.92);
    }
  }

  &__empty-hint {
    margin: 0;
    font-family: $font-harmony;
    font-size: 13px;
    color: $color-subcard-text;
  }

  // ---- 缩放控制 --------------------------------------------------------
  &__zoom {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: -4px 0 14px;
  }

  &__zoom-btn {
    flex-shrink: 0;
    width: 26px;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: $color-btn-bg;
    color: $color-btn-icon;
    font-family: $font-harmony;
    font-size: 17px;
    line-height: 1;
    cursor: pointer;

    &:hover {
      filter: brightness(0.92);
    }
  }

  &__zoom-range {
    flex: 1;
    max-width: 160px;
    accent-color: $color-subcard-selected;
  }

  &__zoom-repick {
    margin-left: auto;
    padding: 4px 12px;
    border: none;
    border-radius: 999px;
    background: $color-btn-bg;
    color: $color-btn-icon;
    font-family: $font-harmony;
    font-size: 13px;
    cursor: pointer;

    &:hover {
      filter: brightness(0.92);
    }
  }

  // 隐藏的 file input(由"上传图片 / 重新上传"触发)
  &__file-input {
    position: fixed;
    width: 0;
    height: 0;
    opacity: 0;
    pointer-events: none;
  }

  // ---- 恢复默认按钮:次级按钮(与"取消"同底色,仅加描边区分于主按钮) -------
  &__btn--reset {
    background: $color-btn-bg;
    border: 1px solid $color-chat-frame;
  }
}
</style>
