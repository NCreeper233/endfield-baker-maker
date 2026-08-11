<script setup lang="ts">
// =============================================================================
// 创建父级对话的"我方身份"设置弹窗(IdentityDialog)
// -----------------------------------------------------------------------------
// 需求:新建父级对话(非二级子卡)时弹窗选择本卡"我方身份"。
// 形态:一个圆形头像按钮(当前选择),点击展开悬浮圆角矩形菜单
// (复用 CharacterPicker 角色网格,同一套数据/逻辑),点"确定"才创建。
//   - 默认身份 = 管理员 (男)
//   - 每次打开重置为默认(身份创建后不可改,弹窗只在创建时出现)
//   - 底部菜单为"更新我"的发送身份语义(avatarTarget=null),不禁止任何角色
//   - ＋ 上抛 open-custom-character,由 App 打开 CustomCharacterDialog(复用)
// 事件:confirm(identity) → App 创建父卡并关闭;close → 取消。
// =============================================================================
import { onBeforeUnmount, onMounted, computed, ref, watch } from 'vue'
import { DEFAULT_MY_IDENTITY, adminDisplayName, useChatStore } from '../../stores/chat'
import type { CardIdentity } from '../../types/chat'
import type { CharacterSelection } from '../../constants/character'
import { MATERIALS } from '../../constants/materials'
import CharacterPicker from './CharacterPicker.vue'

const props = defineProps<{
  /** 是否展开(由 App 的聊天按钮控制) */
  open: boolean
}>()

const emit = defineEmits<{
  /** 点"确定":上报本卡"我方身份" */
  (e: 'confirm', identity: CardIdentity): void
  /** 关闭弹窗(取消 / 遮罩 / ×) */
  (e: 'close'): void
  /** 点击角色网格末尾 ＋按钮:请求打开"添加自定义角色"弹窗(上抛到 App) */
  (e: 'open-custom-character'): void
}>()

const chatStore = useChatStore()

/** 当前选择的身份(每次打开重置为默认管理员·男) */
const picked = ref<CardIdentity>({ ...DEFAULT_MY_IDENTITY })

/** 悬浮圆角矩形菜单是否展开(点击圆形头像按钮切换) */
const menuOpen = ref(false)

/** 当前选择身份的显示名(管理员(男/女)归一化显示"管理员") */
const pickedLabel = computed(() => adminDisplayName(picked.value.name))

watch(
  () => props.open,
  (open) => {
    if (open) {
      picked.value = { ...DEFAULT_MY_IDENTITY }
      menuOpen.value = false
    }
  },
)

/** 点击角色头像:更新当前选择(菜单保持展开,可连续查看调整;点"确定"提交) */
function selectCharacter(c: CharacterSelection) {
  picked.value = {
    name: c.name,
    avatar: c.avatar,
    ...(c.customId ? { customId: c.customId } : {}),
  }
}

/** 删除自定义角色(格内 ×);已引用的消息 / 卡片仍保留各自头像 */
function removeCustomCharacter(id: string) {
  chatStore.removeCustomCharacter(id)
}

/** 点"确定":上报当前选择,由 App 创建父卡 */
function onConfirm() {
  emit('confirm', {
    name: picked.value.name,
    avatar: picked.value.avatar,
    ...(picked.value.customId ? { customId: picked.value.customId } : {}),
  })
}

/**
 * 点击弹窗内部(头像按钮 / 菜单以外)收起悬浮菜单
 *
 * 点遮罩(弹窗外部)由 overlay 的 @click.self 关闭整个弹窗。
 */
function onDocPointerDown(event: PointerEvent) {
  if (!props.open) return
  const target = event.target as Node
  if (!(target instanceof Element)) return
  if (
    target.closest('.identity-dialog__menu') ||
    target.closest('.identity-dialog__trigger') ||
    !target.closest('.identity-dialog')
  ) {
    return
  }
  menuOpen.value = false
}

onMounted(() => document.addEventListener('pointerdown', onDocPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocPointerDown))
</script>

<template>
  <Transition name="id">
    <div v-if="open" class="identity-dialog" @click.self="emit('close')">
      <div class="identity-dialog__panel">
        <!-- 背景装饰:左上角 + 右下角两张,原始尺寸原样贴角 -->
        <img class="identity-dialog__corner identity-dialog__corner--tl" :src="MATERIALS.editPopDecoTl" alt="" />
        <img class="identity-dialog__corner identity-dialog__corner--br" :src="MATERIALS.editPopDecoBr" alt="" />
        <!-- 右上角 × 关闭按钮 -->
        <button class="identity-dialog__close" type="button" aria-label="关闭" @click="emit('close')">×</button>
        <h2 class="identity-dialog__title">选择你在这段对话中的身份</h2>
        <p class="identity-dialog__hint">身份只对这张卡片生效,创建后不可修改</p>

        <!-- 圆形头像按钮:点击展开/收起悬浮角色菜单 -->
        <div class="identity-dialog__stage">
          <button
            class="identity-dialog__trigger"
            type="button"
            :aria-label="'当前身份:' + pickedLabel"
            @click="menuOpen = !menuOpen"
          >
            <img class="identity-dialog__trigger-img" :src="picked.avatar" alt="" />
          </button>
          <p class="identity-dialog__picked">{{ pickedLabel }}</p>
        </div>

        <!-- 确定 / 取消 -->
        <div class="identity-dialog__actions">
          <button class="identity-dialog__btn identity-dialog__btn--primary" type="button" @click="onConfirm">确定</button>
          <button class="identity-dialog__btn" type="button" @click="emit('close')">取消</button>
        </div>
      </div>

      <!-- 悬浮圆角矩形菜单:复用 CharacterPicker 角色网格(avatarTarget=null,
           底部"更新我"语义,不禁止任何角色);选中格由 picked.avatar 高亮 -->
      <Transition name="identity-menu">
        <div v-if="menuOpen" class="identity-dialog__menu">
          <CharacterPicker
            :avatar-target="null"
            :selected-avatar="picked.avatar"
            @select="selectCharacter"
            @remove="removeCustomCharacter"
            @add-custom="emit('open-custom-character')"
          />
        </div>
      </Transition>
    </div>
  </Transition>
</template>

<style scoped lang="scss">
@use '../../styles/variables' as *;
@use '../../styles/mixins' as *;

// 弹窗外壳(遮罩 / 面板 / 角饰 / 关闭钮 / 标题 / 提示行 / 按钮 / 转场);
// 覆盖遮罩为纵向排列:紧凑面板在上,悬浮菜单在下面弹出
@include dialog-shell(identity-dialog, 480px, 70%, 10px, 'hint');

.identity-dialog {
  flex-direction: column;
  gap: 16px;

  // 圆形头像按钮:96px,点击展开悬浮角色菜单(裁切方式与聊天区头像一致)
  &__stage {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    margin-bottom: 6px;
  }

  &__trigger {
    width: 96px;
    height: 96px;
    padding: 0;
    border: none;
    border-radius: 50%;
    overflow: hidden;
    cursor: pointer;
    background: transparent;
    position: relative;
    box-shadow: 0 0 0 3px $color-subcard-selected;

    // 悬停白色半透明遮罩(同角色格)
    &::after {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: 50%;
      background: $color-hover-overlay;
      opacity: 0;
      transition: opacity 0.15s ease;
    }

    &:hover::after {
      opacity: 1;
    }
  }

  &__trigger-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    // 头像原图为竖长方形,取上端正方形区域显示(与 ChatAvatar 一致)
    object-position: center top;
    display: block;
  }

  &__picked {
    margin: 0;
    font-family: $font-harmony;
    font-size: 17px;
    color: $color-text-primary;
  }

  // 悬浮圆角矩形菜单:1320 宽,内容为 CharacterPicker 网格(inset:0 铺满)
  &__menu {
    position: relative;
    width: 1320px;
    max-width: calc(100vw - 32px);
    height: 430px;
    border-radius: 14px;
    background: #dedcdc;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    overflow: hidden;
    pointer-events: auto;
  }

  // 菜单从上方滑入展开 / 收起
  .identity-menu-enter-active,
  .identity-menu-leave-active {
    transition: transform 0.2s ease-out, opacity 0.2s ease-out;
    transform-origin: top center;
  }

  .identity-menu-enter-from,
  .identity-menu-leave-to {
    transform: scaleY(0.6);
    opacity: 0;
  }
}
</style>
