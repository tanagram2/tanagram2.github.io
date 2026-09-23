// Owns the current app. Swaps it on launch/exit.
//
// AppManager doesn't import any specific app. main.js supplies
// onLaunch (instantiate + attach + init) and onExitToDefault (OSApp),
// keeping the dependency arrow pointing one way.

export class AppManager {
  constructor(renderer, eventRouter) {
    this.renderer    = renderer;
    this.eventRouter = eventRouter;

    this.currentApp = null;

    this.onLaunch        = null;
    this.onExitToDefault = null;
  }

  launch(AppClass) {
    // Clear hover/press state BEFORE swapping - otherwise the router
    // holds references into the outgoing tree.
    this.eventRouter.clearHoverState();
    this.currentApp = null;

    if (!this.onLaunch) {
      throw new Error("AppManager.onLaunch not wired. Set it in main.js.");
    }

    return this.onLaunch(AppClass);
  }

  exit() {
    if (!this.onExitToDefault) {
      throw new Error("AppManager.onExitToDefault not wired. Set it in main.js.");
    }
    this.eventRouter.clearHoverState();
    this.currentApp = null;
    this.onLaunch(this.onExitToDefault);
  }
}