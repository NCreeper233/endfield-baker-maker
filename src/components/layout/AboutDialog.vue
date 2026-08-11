<script setup lang="ts">
// =============================================================================
// 关于/菜单弹窗(AboutDialog)
// -----------------------------------------------------------------------------
// 编辑模式右上角按钮列左侧的"警告铃铛"(icon_btn_lv3_warn 旋转 180°)按钮触发。
// 内容:应用标题 + 更新日志 + GitHub / B站 链接 + 结尾鸣谢文案(占位)。
// 打开/关闭状态由父组件 App 持有。
// =============================================================================
import { MATERIALS } from "../../constants/materials";

defineProps<{
  /** 是否展开(App 的菜单按钮 toggle) */
  open: boolean;
}>();

const emit = defineEmits<{
  (e: "close"): void;
}>();
</script>

<template>
  <Transition name="ab">
    <div v-if="open" class="ab" @click.self="emit('close')">
      <div class="ab__panel">
        <!-- 背景装饰:左上角 + 右下角两张,原始尺寸原样贴角 -->
        <img
          class="ab__corner ab__corner--tl"
          :src="MATERIALS.editPopDecoTl"
          alt=""
        />
        <img
          class="ab__corner ab__corner--br"
          :src="MATERIALS.editPopDecoBr"
          alt=""
        />
        <!-- 右上角 × 关闭按钮 -->
        <button
          class="ab__close"
          type="button"
          aria-label="关闭"
          @click="emit('close')"
        >
          ×
        </button>
        <h2 class="ab__title">明日方舟：终末地 Baker 模拟器</h2>

        <div class="ab__body">
          <section class="ab__section">
            <h3 class="ab__sub">更新日志</h3>
            <ul class="ab__log">
              <li class="ab__log-item">
                <p class="ab__log-date">2026-08-11</p>
                <p class="ab__log-desc">添加了多项自定义功能</p>
                <p class="ab__log-desc">添加了名称显示</p>
                <p class="ab__log-desc">修复了清空对话的Bug（可能大概也许是修复了？</p>
                <p class="ab__log-desc"><del>移除了Herobrine</del></p>
                <p class="ab__log-date">2026-08-10</p>
                <p class="ab__log-desc">预览版上线</p>
              </li>
            </ul>
          </section>

          <section class="ab__section">
            <h3 class="ab__sub">相关链接</h3>
            <ul class="ab__links">
              <li>
                <a
                  href="https://github.com/NCreeper233/endfield-baker-maker"
                  target="_blank"
                  rel="noopener"
                  >GitHub</a
                >
              </li>
              <li>
                <a
                  href="https://space.bilibili.com/1143315127"
                  target="_blank"
                  rel="noopener"
                  >哔哩哔哩</a
                >
              </li>
            </ul>
          </section>

          <section class="ab__section">
            <h3 class="ab__sub">相关项目</h3>
            <ul class="ab__links">
              <li>
                <a
                  href="https://ark.ncreeper.top/"
                  target="_blank"
                  rel="noopener"
                  >明日方舟：终末地风格LOGO生成器</a
                >
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped lang="scss">
@use "../../styles/variables" as *;
@use "../../styles/mixins" as *;

// 关于菜单:半透明遮罩 + 居中深色面板(复用弹窗外壳,类前缀 ab)
@include dialog-shell(ab, 520px, 55%, 16px);

.ab {
  // 正文滚动区(内容可能超出时滚动)
  &__body {
    margin: 0 0 16px;
    max-height: 320px;
    overflow-y: auto;
  }

  &__section {
    margin-bottom: 16px;

    &:last-child {
      margin-bottom: 0;
    }
  }

  &__sub {
    margin: 0 0 8px;
    font-family: $font-harmony;
    font-size: 16px;
    font-weight: 500;
    color: $color-text-primary;
  }

  &__log {
    margin: 0;
    padding: 0;
    font-family: $font-harmony;
    list-style: none;
  }

  // 每条日志:日期独占一行(放大),描述在下一行可多行排布
  &__log-item {
    margin-bottom: 14px;

    &:last-child {
      margin-bottom: 0;
    }
  }

  // 日期:放大加粗,独立一行
  &__log-date {
    margin: 0 0 4px;
    font-size: 18px;
    font-weight: 600;
    color: $color-text-primary;
    line-height: 1.4;
  }

  // 日志描述:小号,允许多行(br 换行);相对日期右缩 10px
  &__log-desc {
    margin: 0;
    padding-left: 10px;
    font-size: 14px;
    color: $color-subcard-text;
    line-height: 1.8;
  }

  // 链接列表:无圆点、无左缩进
  &__links {
    margin: 0;
    padding: 0;
    font-family: $font-harmony;
    font-size: 14px;
    color: $color-subcard-text;
    line-height: 1.8;
    list-style: none;
  }

  &__links a {
    color: #fcf33f;
    text-decoration: none;

    &:hover {
      color: #fff983;
      text-decoration: none;
    }
  }
}
</style>
