import type { ModelViewer } from './ModelViewer'

/** 查看器现有工具栏需要的行为；本地 Three 与远程节点共用。 */
export type ViewerController = Pick<ModelViewer,
  | 'load' | 'reload' | 'dispose' | 'setDprCap' | 'setSourceUp'
  | 'setBloom' | 'setBloomStrength' | 'setUniformTone' | 'setSplatScale'
  | 'setSoftLight' | 'setEmission' | 'setFlySpeed' | 'setWalkSpeed'
  | 'rotateOrientation' | 'resetOrientation' | 'getWalkDefaults' | 'configureWalk'
  | 'beginParameterInteraction' | 'endParameterInteraction' | 'clearUserInput'
  | 'setAutoRotate' | 'setTouchEnabled' | 'resetDisplay' | 'resetView' | 'setMode'
  | 'capturePng' | 'isRecording' | 'startRecording' | 'stopRecording'>

export const REMOTE_COMMANDS = [
  'setSourceUp', 'setBloom', 'setBloomStrength', 'setUniformTone', 'setSplatScale',
  'setSoftLight', 'setEmission', 'setFlySpeed', 'setWalkSpeed', 'rotateOrientation',
  'resetOrientation', 'configureWalk', 'beginParameterInteraction', 'endParameterInteraction',
  'clearUserInput', 'setAutoRotate', 'resetDisplay', 'resetView', 'setMode',
] as const
export type RemoteCommand = typeof REMOTE_COMMANDS[number]
