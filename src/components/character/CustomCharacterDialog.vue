<script setup lang="ts">
// =============================================================================
// 添加自定义角色弹窗(CustomCharacterDialog)
// -----------------------------------------------------------------------------
// 由角色选择面板末尾的 + 按钮触发(事件链 EditModePanel → ChatArea → App)。
// 布局:上=方形裁剪预览(上传 + 拖拽平移 + 缩放),中=名称输入 + 他/她/它选择,
//       下=添加 / 取消。
// 确认后产出 CustomCharacter(id 由本组件生成),由 App 写入 store 注册表。
// =============================================================================
import { ref, useTemplateRef, watch } from 'vue'
import { MATERIALS } from '../../constants/materials'
import type { CustomCharacter, PronounGender } from '../../constants/character'
import { useSquareCrop } from '../../composables/useSquareCrop'

/** 裁剪视口方形边长(px,须与 useSquareCrop 的 displaySize 一致) */
const CROP_SIZE = 220

const props = defineProps<{
  /** 是否展开(由 App 的 + 按钮控制) */
  open: boolean
}>()

const emit = defineEmits<{
  /** 点"添加"成功创建自定义角色 */
  (e: 'created', c: CustomCharacter): void
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

/** 角色名称(trim 后非空才可添加) */
const name = ref('')
/** 称呼代词(他/她/它,默认"她") */
const gender = ref<PronounGender>('female')

/** 生成唯一 id(crypto.randomUUID,不支持时降级) */
function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `custom-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** 每次展开弹窗重置表单(名称 / 代词 / 裁剪区) */
watch(
  () => props.open,
  (open) => {
    if (open) {
      name.value = ''
      gender.value = 'female'
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
  try {
    await loadFile(file)
  } catch (err) {
    console.warn('[CustomCharacterDialog] 图片读取失败', err)
  }
}

/** 滚轮缩放:@wheel.prevent 阻止页面滚动;向下滚 zoomBy(-1) 缩小 */
function onWheel(e: WheelEvent) {
  zoomBy(e.deltaY < 0 ? 1 : -1)
}

/** 点"添加":裁剪导出方形头像 + 校验名称后上抛 created */
function onCreate() {
  const trimmed = name.value.trim()
  if (!trimmed || !hasImage()) return
  const avatar = exportSquare(512)
  emit('created', { id: genId(), name: trimmed, avatar, gender: gender.value })
  emit('close')
}
</script>

<template>
  <Transition name="cc">
    <div v-if="open" class="cc" @click.self="emit('close')">
      <div class="cc__panel">
        <!-- 背景装饰:左上角 + 右下角两张,原始尺寸原样贴角 -->
        <img class="cc__corner cc__corner--tl" :src="MATERIALS.editPopDecoTl" alt="" />
        <img class="cc__corner cc__corner--br" :src="MATERIALS.editPopDecoBr" alt="" />
        <!-- 右上角 × 关闭按钮 -->
        <button class="cc__close" type="button" aria-label="关闭" @click="emit('close')">×</button>
        <h2 class="cc__title">添加自定义角色</h2>

        <!-- 方形裁剪预览区 -->
        <div class="cc__preview">
          <div
            v-if="hasImage()"
            class="cc__crop"
            :style="{ width: CROP_SIZE + 'px', height: CROP_SIZE + 'px' }"
            @wheel.prevent="onWheel"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointercancel="onPointerCancel"
          >
            <img class="cc__crop-img" :style="imageStyle" :src="cropImg?.src" alt="" />
            <!-- 提示拖动 / 滚轮缩放 -->
            <p class="cc__crop-hint">拖动移动 · 滚轮缩放</p>
          </div>

          <div v-else class="cc__empty" :style="{ width: CROP_SIZE + 'px', height: CROP_SIZE + 'px' }">
            <button class="cc__empty-btn" type="button" @click="onPickFile">上传图片</button>
            <p class="cc__empty-hint">将图片裁剪为方形头像</p>
          </div>
        </div>

        <!-- 缩放控制(仅已上传时显示) -->
        <div v-if="hasImage()" class="cc__zoom">
          <button class="cc__zoom-btn" type="button" aria-label="缩小" @click="zoomBy(-1)">−</button>
          <input
            class="cc__zoom-range"
            type="range"
            min="0"
            max="1"
            step="0.01"
            :value="zoomRatio"
            @input="setScaleFromRatio(parseFloat(($event.target as HTMLInputElement).value))"
          />
          <button class="cc__zoom-btn" type="button" aria-label="放大" @click="zoomBy(1)">＋</button>
          <button class="cc__zoom-repick" type="button" @click="onPickFile">重新上传</button>
        </div>
        <input
          ref="fileInput"
          type="file"
          accept="image/*"
          class="cc__file-input"
          @change="onFileChange"
        />

        <!-- 名称输入 -->
        <div class="cc__field">
          <label class="cc__field-label" for="cc-name">角色名称</label>
          <input
            id="cc-name"
            v-model="name"
            class="cc__field-input"
            type="text"
            placeholder="输入角色名"
          />
        </div>

        <!-- 称呼代词选择 -->
        <div class="cc__gender">
          <span class="cc__gender-label">称呼</span>
          <div class="cc__gender-opts">
            <button
              v-for="g in (['male', 'female', 'it'] as PronounGender[])"
              :key="g"
              class="cc__gender-opt"
              :class="{ 'is-active': g === gender }"
              type="button"
              @click="gender = g"
            >
              {{ g === 'male' ? '他' : g === 'female' ? '她' : '它' }}
            </button>
          </div>
        </div>

        <!-- 添加 / 取消 -->
        <div class="cc__actions">
          <button
            class="cc__btn cc__btn--primary"
            type="button"
            :disabled="!hasImage() || !name.trim()"
            @click="onCreate"
          >
            添加
          </button>
          <button class="cc__btn" type="button" @click="emit('close')">取消</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped lang="scss">
@use '../../styles/variables' as *;
@use '../../styles/mixins' as *;

// 弹窗外壳复用 dialog-shell(遮罩 / 面板 / 角饰 / 关闭钮 / 标题 / 按钮 / 转场)
@include dialog-shell(cc, 460px, 70%, 10px);

// 本弹窗可能由其它弹窗嵌套触发(如"我方身份"选择弹窗的角色菜单 → ＋ → 此处):
// 兄弟弹窗同为 dialog-shell 的 z-index:200,故本弹窗要略微抬高,保证盖在最上层
.cc {
  z-index: 210;
}

.cc {
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

  // ---- 名称输入 --------------------------------------------------------
  &__field {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 10px;
  }

  &__field-label {
    flex-shrink: 0;
    font-family: $font-harmony;
    font-size: 15px;
    color: $color-subcard-text;
  }

  &__field-input {
    flex: 1;
    min-width: 0;
    height: 36px;
    padding: 0 14px;
    box-sizing: border-box;
    border: 1px solid $color-chat-frame;
    border-radius: 8px;
    background: $color-btn-bg;
    color: #1c1c1c;
    font-family: $font-harmony;
    font-size: 16px;
    outline: none;

    &:focus {
      border-color: $color-subcard-selected;
    }

    &::placeholder {
      color: #9b9b9b;
      opacity: 1;
    }
  }

  // ---- 称呼代词 --------------------------------------------------------
  &__gender {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
  }

  &__gender-label {
    flex-shrink: 0;
    font-family: $font-harmony;
    font-size: 15px;
    color: $color-subcard-text;
  }

  &__gender-opts {
    display: flex;
    gap: 8px;
  }

  &__gender-opt {
    width: 44px;
    height: 32px;
    padding: 0;
    border: 1px solid $color-chat-frame;
    border-radius: 999px;
    background: $color-btn-bg;
    color: $color-btn-icon;
    font-family: $font-harmony;
    font-size: 15px;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;

    &.is-active {
      background: $color-subcard-selected;
      color: #1c1c1c;
    }

    &:hover:not(.is-active) {
      filter: brightness(0.92);
    }
  }
}
</style>