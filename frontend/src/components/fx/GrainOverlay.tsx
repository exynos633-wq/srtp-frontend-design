import styles from './GrainOverlay.module.css'

/**
 * 全站颗粒层（动效设计 v2.1 §2.2 规律 02）。
 * 静态、不参与指针与读屏；用极低透明度把纯色深底变成“展墙材质”。
 */
export function GrainOverlay() {
  return <div className={styles.grain} aria-hidden="true" data-grain-overlay="true" />
}
