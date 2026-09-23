// CanvasOS bootstrap. The only script tag in index.html.
// Everything else is reached via imports from here.
//
// Adding an app means adding a file under js/apps/ and one line in
// js/apps/registry.js. Never touch HTML or this file.

import { Renderer }     from "./systems/Renderer.js";
import { InputHandler } from "./systems/InputHandler.js";
import { HitTester }    from "./systems/HitTester.js";
import { EventRouter }  from "./systems/EventRouter.js";
import { AppManager }   from "./systems/AppManager.js";
import { OSApp }        from "./apps/OSApp.js";

// Virtual resolution. The one place it lives.
export const VIRTUAL_WIDTH  = 1280;
export const VIRTUAL_HEIGHT = 720;

const canvas = document.getElementById("screen");
const ctx    = canvas.getContext("2d");

const renderer    = new Renderer(canvas, ctx, VIRTUAL_WIDTH, VIRTUAL_HEIGHT);
const input       = new InputHandler(canvas, VIRTUAL_WIDTH, VIRTUAL_HEIGHT);
const hitTester   = new HitTester();
const eventRouter = new EventRouter(hitTester);
const appManager  = new AppManager(renderer, eventRouter);

// Renderer owns the virtual->device transform; InputHandler needs its
// inverse. A getter avoids a circular import.
input.setTransformProvider(() => renderer.getTransform());

input.onEvent((e) => eventRouter.route(e, appManager.currentApp));

// AppManager doesn't import any specific app. main.js supplies the
// instantiate-and-attach step so "which apps exist" lives in one place.
appManager.onLaunch = (AppClass) => {
  const app = new AppClass();
  app.attach(appManager);
  app.init();
  appManager.currentApp = app;
  return app;
};

// Exit always returns to OSApp. Registered here so AppManager stays
// ignorant of specific app classes.
appManager.onExitToDefault = OSApp;

appManager.launch(OSApp);

let lastTime = performance.now();

function frame(now) {
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  const app = appManager.currentApp;
  if (app) {
    app.update(dt);
    renderer.draw(app.root);
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);