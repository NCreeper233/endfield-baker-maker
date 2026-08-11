<script setup lang="ts">
// =============================================================================
// 删除对话确认弹窗(DeleteConfirmDialog)
// -----------------------------------------------------------------------------
// 样式与数据管理菜单的清空确认页一致:半透明遮罩 + 居中深色面板 +
// 右上角 × 关闭 + 确认/取消两个按钮(替代原三张 delete 图片素材的背景/按钮)。
// 打开/关闭状态由父组件 App 持有(删除按钮 toggle 逻辑不变)。
//
// props: open(是否展开);emits: confirm(确认删除) / cancel(取消)。
// - 确认/取消、×、遮罩点击均触发关闭;其中 confirm 由 App 执行删除。
//
// 未选中对话时(activeSub === null):与「导出聊天截图」弹窗同款空态——只提示
// "请先在左侧选中一段对话",不出现确认/取消按钮,避免"确认后无操作地空转"
// (store.deleteActiveConversation 对 null activeSub 直接 return)。
// =============================================================================
import { computed } from 'vue'
import { useChatStore } from '../../stores/chat'
import { MATERIALS } from '../../constants/materials'
defineProps<{
  /** 是否展开(由 App 的删除按钮 toggle) */
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'confirm'): void
  (e: 'cancel'): void
}>()

const chatStore = useChatStore()

/** 是否有已选中对话(未选中时仅提示"请先选中",不出现确认操作) */
const hasSub = computed(() => chatStore.activeSub !== null)
</script>

<template>
  <Transition name="dc">
    <div v-if="open" class="dc" @click.self="emit('cancel')">
      <div class="dc__panel">
        <!-- 背景装饰:左上角 + 右下角两张,原始尺寸原样贴角 -->
        <img class="dc__corner dc__corner--tl" :src="MATERIALS.editPopDecoTl" alt="" />
        <img class="dc__corner dc__corner--br" :src="MATERIALS.editPopDecoBr" alt="" />
        <!-- 右上角 × 关闭按钮(撤销 = 取消) -->
        <button class="dc__close" type="button" aria-label="关闭" @click="emit('cancel')">×</button>
        <h2 class="dc__title">删除对话</h2>

        <!-- 未选中对话:提示先行选中,不出现确认/取消按钮 -->
        <p v-if="!hasSub" class="dc__empty-hint">请先在左侧选中一段对话，再进行删除。</p>

        <template v-else>
          <p class="dc__text">是否删除这个会话？</p>
          <div class="dc__actions">
            <button class="dc__btn dc__btn--primary" type="button" @click="emit('confirm')">确认</button>
            <button class="dc__btn" type="button" @click="emit('cancel')">取消</button>
          </div>
        </template>
      </div>
    </div>
  </Transition>
</template>

<style scoped lang="scss">
@use '../../styles/variables' as *;
@use '../../styles/mixins' as *;

// 遮罩 + 居中深色面板(与数据管理菜单清空确认页完全同款样式)
@include dialog-shell(dc, 348px, 70%, 10px);

// 未选中对话的空态提示(与「导出聊天截图」弹窗的 ce__empty-hint 同款视觉)
.dc {
  &__empty-hint {
    margin: 0 0 18px;
    font-family: $font-harmony;
    font-size: 15px;
    color: $color-subcard-text;
  }
}
</style>