// Base class for everything that gets launched.
//
// An App owns a root Composite (its scene tree). init() once,
// update(dt) every frame, onEvent(e) for anything the EventRouter
// didn't consume. Override what you need.
//
// Subclasses must:
//   1. Provide `static displayName = "Something";` (the label OSApp
//      puts on the menu button). No default on purpose: a forgotten
//      displayName should show up as `undefined`, not be papered over.
//   2. Be added to js/apps/registry.js. If it isn't listed there, it
//      doesn't appear in the menu.

import { Composite } from "../composites/Composite.js";

export class App {
  constructor() {
    this.root       = new Composite({ w: "100%", h: "100%" });
    this.appManager = null;
  }

  // Called by main.js's onLaunch hook before init().
  attach(appManager) {
    this.appManager = appManager;
  }

  launch(AppClass) {
    this.appManager.launch(AppClass);
  }

  exit() {
    this.appManager.exit();
  }

  init() {}
  update(dt) {}
  onEvent(e) {}
}