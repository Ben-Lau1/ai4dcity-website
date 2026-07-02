/**
 * InputSnapshot.js — 统一输入快照
 * 每帧由 InputController 生成，各模式消费
 */
(function() {
  'use strict';

  function InputSnapshot() {
    this.dt = 0;

    // 移动方向（摇杆/WASD 归一化 -1..1）
    this.moveX = 0;
    this.moveZ = 0;

    // 视角旋转增量（鼠标/触控拖拽）
    this.yawDelta = 0;
    this.pitchDelta = 0;
    this.lookActive = false;

    // 滚轮
    this.scrollDelta = 0;

    // 按键（按下为 true）
    this.jump = false;
    this.sprint = false;
    this.qe = 0;       // Q=-1, E=1
    this.rf = 0;       // R=1, F=-1

    // 鼠标按钮状态
    this.mouseButton = -1;  // -1=无, 0=左, 1=中, 2=右

    // 视角回正
    this.resetView = false;

    // 触控状态
    this.isTouchDevice = false;

    // 每帧重置
    this.reset = function() {
      this.yawDelta = 0;
      this.pitchDelta = 0;
      this.lookActive = false;
      this.scrollDelta = 0;
      this.moveX = 0;
      this.moveZ = 0;
      this.jump = false;
      this.sprint = false;
      this.qe = 0;
      this.rf = 0;
      this.mouseButton = -1;
      this.resetView = false;
      this.isTouchDevice = false;
    };
  }

  window.InputSnapshot = InputSnapshot;
})();
