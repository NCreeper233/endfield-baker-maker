<script setup lang="ts">
// =============================================================================
// 角色头像选择弹窗(CharacterPicker)
// -----------------------------------------------------------------------------
// 职责:渲染全部干员头像网格(每行 12 个,可滚动),点击后上报选择结果。
// 从 EditModePanel 壳拆出,聚焦"选择目标 + 网格渲染":
//   - avatarTarget 非空:该弹窗用于更换目标消息身份,管理员(男/女)一律置灰禁用
//   - avatarTarget 为空:更新"我"的发送身份,仅当前全局性别对应的管理员可选
//     (与页面最上方工具栏的头像切换保持一致,保证能设回我方管理员身份);
//     另一性别的管理员置灰禁用,避免两处性别入口冲突
// 选中高亮由壳计算传入(selectedAvatar,与聊天区解析链一致)。
// =============================================================================
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { CHARACTERS } from '../../constants/character'
import type { Character } from '../../constants/character'
import { isAdminName } from '../../stores/chat'
import { useChatStore } from '../../stores/chat'

const chatStore = useChatStore()
const { adminGender } = storeToRefs(chatStore)

const props = defineProps<{
  /** 消息头像更换目标:被点击头像的消息 id(null = 更新"我"的发送身份) */
  avatarTarget: number | null
  /** 当前弹窗内应高亮的头像 URL(与聊天区渲染解析链一致) */
  selectedAvatar: string
}>()

const emit = defineEmits<{
  /** 点击某个干员头像(由壳决定更换消息身份 / 更新发送身份) */
  select: [character: Character]
}>()

/** 当前全局性别对应的管理员角色名 */
const currentAdminName = computed(() =>
  adminGender.value === 'female' ? '管理员 (女)' : '管理员 (男)',
)

/**
 * 管理员禁用判定:
 * - 更换他人消息身份(avatarTarget 非空):一律禁用
 * - 更新"我"的身份:仅允许当前全局性别对应的管理员,另一性别禁用
 */
function isAdminDisabled(name: string): boolean {
  return isAdminName(name) && (props.avatarTarget !== null || name !== currentAdminName.value)
}
</script>

<template>
  <!-- 角色头像选择:全部干员每行 12 个,可滚动;点击选择后更新头像按钮。
       管理员:更换他人消息身份时一律置灰;更新"我"的身份时仅当前全局性别
       对应的管理员可选(与右上角性别切换同步),另一性别置灰 -->
  <div class="character-picker__grid">
    <button
      v-for="c in CHARACTERS"
      :key="c.name"
      class="character-picker__cell"
      :class="{
        'is-selected': c.avatar === selectedAvatar,
        'is-disabled': isAdminDisabled(c.name),
      }"
      :disabled="isAdminDisabled(c.name)"
      type="button"
      @click="emit('select', c)"
    >
      <img class="character-picker__cell-img" :src="c.avatar" alt="" />
    </button>
  </div>
</template>

<style scoped lang="scss">
@use '../../styles/variables' as *;

// 角色头像网格:每行 12 个,超出面板高度时可滚动
.character-picker__grid {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 24px;
  box-sizing: border-box;
  display: grid;
  grid-template-columns: repeat(12, 88px);
  justify-content: center;
  // 12 × 88 + 11 × 19 = 1265px,不超出面板可用宽(1320 - 24×2 = 1272)
  column-gap: 19px;
  row-gap: 16px;
  align-content: start;
  scrollbar-width: thin;
  scrollbar-color: $color-scrollbar-chat transparent;
  // 面板不拦截事件,网格需可交互
  pointer-events: auto;
}

// 单个角色头像:圆形裁切(与聊天区头像一致),点击选择
.character-picker__cell {
  width: 88px;
  height: 88px;
  border: none;
  border-radius: 50%;
  padding: 0;
  overflow: hidden;
  cursor: pointer;
  background: transparent;
  position: relative;

  // 选中角色:黄色圆环高亮(同子卡选中色)
  &.is-selected {
    box-shadow: 0 0 0 3px $color-subcard-selected;
  }

  // 管理员(男/女)置灰禁用:更换他人消息身份时一律禁用;更新"我"身份时
  // 仅禁用非当前全局性别的管理员(性别由右上角切换)
  &.is-disabled {
    opacity: 0.35;
    filter: grayscale(1);
    cursor: not-allowed;

    // 抑制悬停白色遮罩
    &::after {
      opacity: 0;
    }
  }

  // 悬停白色半透明遮罩(同主卡/子卡 hover 白层)
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

  &-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    // 头像原图为竖长方形,取上端正方形区域显示(与 ChatAvatar 一致)
    object-position: center top;
    display: block;
  }
}
</style>
