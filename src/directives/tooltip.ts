// src/directives/tooltip.ts
import type { Directive } from 'vue'

interface TooltipElement extends HTMLElement {
  _tooltipEl?: HTMLDivElement
  _tooltipShow?: () => void
  _tooltipHide?: () => void
}

const tooltipDirective: Directive = {
  mounted(el: TooltipElement, binding) {
    const text = binding.value as string
    
    // 创建 tooltip 元素
    const tooltip = document.createElement('div')
    tooltip.className = 'custom-tooltip'
    tooltip.textContent = text
    tooltip.style.cssText = `
      position: fixed;
      z-index: 9999;
      padding: 6px 12px;
      background: rgba(0, 0, 0, 0.85);
      color: #fff;
      font-size: 12px;
      line-height: 1.5;
      border-radius: 4px;
      white-space: nowrap;
      pointer-events: none;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.15s ease, visibility 0.15s ease;
    `
    
    // 添加箭头
    const arrow = document.createElement('div')
    arrow.style.cssText = `
      position: absolute;
      top: 100%;
      left: 50%;
      transform: translateX(-50%);
      width: 0;
      height: 0;
      border: 5px solid transparent;
      border-top-color: rgba(0, 0, 0, 0.85);
    `
    tooltip.appendChild(arrow)
    
    document.body.appendChild(tooltip)
    el._tooltipEl = tooltip
    
    // 显示 tooltip
    const showTooltip = () => {
      const rect = el.getBoundingClientRect()
      const tooltipRect = tooltip.getBoundingClientRect()
      
      tooltip.style.left = `${rect.left + rect.width / 2 - tooltipRect.width / 2}px`
      tooltip.style.top = `${rect.top - tooltipRect.height - 8}px`
      
      tooltip.style.opacity = '1'
      tooltip.style.visibility = 'visible'
    }
    
    // 隐藏 tooltip
    const hideTooltip = () => {
      tooltip.style.opacity = '0'
      tooltip.style.visibility = 'hidden'
    }
    
    el._tooltipShow = showTooltip
    el._tooltipHide = hideTooltip
    
    el.addEventListener('mouseenter', showTooltip)
    el.addEventListener('mouseleave', hideTooltip)
  },
  
  updated(el: TooltipElement, binding) {
    if (el._tooltipEl) {
      el._tooltipEl.textContent = binding.value as string
    }
  },
  
  unmounted(el: TooltipElement) {
    if (el._tooltipShow) {
      el.removeEventListener('mouseenter', el._tooltipShow)
    }
    if (el._tooltipHide) {
      el.removeEventListener('mouseleave', el._tooltipHide)
    }
    if (el._tooltipEl) {
      el._tooltipEl.remove()
    }
  }
}

export default tooltipDirective