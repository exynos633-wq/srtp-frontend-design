import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

/**
 * 滚动驱动动效的统一入口（动效设计 v2.1 §5.1）：
 * ScrollTrigger 是 gsap 包内免费插件，只在这里注册一次；
 * 组件从本模块取 `gsap` / `ScrollTrigger`，避免各自注册导致重复初始化。
 */
gsap.registerPlugin(ScrollTrigger)

export { gsap, ScrollTrigger }
