<script setup lang="ts">
// =============================================================================
// 设置弹窗(SettingsDialog)
// -----------------------------------------------------------------------------
// 点击设置按钮(login_btn_setting)打开弹窗,内含自动播放消息间隔滑动条。
// 范围 0.5~5 秒,默认 2 秒。
// 仅编辑模式显示。
// 状态由 store.messageInterval 持有,localStorage 持久化。
// =============================================================================
import { computed } from 'vue'
import { useChatStore } from '../../stores/chat'
import { storeToRefs } from 'pinia'
import { MATERIALS } from '../../constants/materials'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const chatStore = useChatStore()
const { messageInterval, loadingDuration } = storeToRefs(chatStore)

const displayInterval = computed(() => messageInterval.value.toFixed(1))
const displayLoading = computed(() => loadingDuration.value.toFixed(1))

function onIntervalInput(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  chatStore.setMessageInterval(Math.round(v * 10) / 10)
}

function onLoadingInput(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  chatStore.setLoadingDuration(Math.round(v * 10) / 10)
}
</script>

<template>
  <Transition name="sd">
    <div v-if="open" class="sd" @click.self="emit('close')">
      <div class="sd__panel">
        <img class="sd__corner sd__corner--tl" :src="MATERIALS.editPopDecoTl" alt="" />
        <img class="sd__corner sd__corner--br" :src="MATERIALS.editPopDecoBr" alt="" />
        <button class="sd__close" type="button" aria-label="关闭" @click="emit('close')">×</button>
        <h2 class="sd__title">播放设置</h2>

        <div class="sd__body">
          <label class="sd__row">
            <span class="sd__label">消息间隔</span>
            <input
              class="sd__range"
              type="range"
              min="0.5"
              max="5"
              step="0.5"
              :value="messageInterval"
              @input="onIntervalInput"
            />
            <span class="sd__value">{{ displayInterval }}s</span>
          </label>
          <p class="sd__hint">两条消息之间出现的间隔秒数</p>

          <label class="sd__row sd__row--mt">
            <span class="sd__label">加载动画</span>
            <input
              class="sd__range"
              type="range"
              min="0.2"
              max="3"
              step="0.1"
              :value="loadingDuration"
              @input="onLoadingInput"
            />
            <span class="sd__value">{{ displayLoading }}s</span>
          </label>
          <p class="sd__hint">加载气泡（正在输入）的显示时长</p>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped lang="scss">
@use '../../styles/variables' as *;
@use '../../styles/mixins' as *;

@include dialog-shell(sd, 420px, 60%, 16px);

.sd {
  &__body {
    margin: 0;
  }

  &__row {
    display: flex;
    align-items: center;
    gap: 12px;

    &--mt {
      margin-top: 18px;
    }
  }

  &__label {
    font-family: $font-harmony;
    font-size: 15px;
    color: $color-text-primary;
    white-space: nowrap;
    min-width: 72px;
  }

  &__range {
    flex: 1;
    height: 4px;
    appearance: none;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 2px;
    outline: none;
    cursor: pointer;

    &::-webkit-slider-thumb {
      appearance: none;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: $color-subcard-selected;
      cursor: pointer;
    }

    &::-moz-range-thumb {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: $color-subcard-selected;
      border: none;
      cursor: pointer;
    }
  }

  &__value {
    font-family: $font-harmony;
    font-size: 15px;
    color: $color-subcard-selected;
    min-width: 32px;
    text-align: right;
    font-weight: 600;
  }

  &__hint {
    margin: 10px 0 0;
    font-family: $font-harmony;
    font-size: 13px;
    color: $color-speaker-name;
  }
}
</style>
