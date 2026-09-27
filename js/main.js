// CanvasOS bootstrap. The only script tag in index.html.

import { Renderer }     from "./systems/Renderer.js";
import { InputHandler } from "./systems/InputHandler.js";
import { HitTester }    from "./systems/HitTester.js";
import { EventRouter }  from "./systems/EventRouter.js";
import { AppManager }   from "./systems/AppManager.js";
import { Viewport }     from "./systems/Viewport.js";
import { OSApp }        from "./apps/OSApp.js";

Viewport.detect();

const canvas = document.getElementById("screen");
const ctx    = canvas.getContext("2d");

const renderer    = new Renderer(canvas, ctx, Viewport.width, Viewport.height);
const input       = new InputHandler(canvas, Viewport.width, Viewport.height);
const hitTester   = new HitTester();
const eventRouter = new EventRouter(hitTester);
const appManager  = new AppManager(renderer, eventRouter);

input.setTransformProvider(() => renderer.getTransform());

input.onEvent((e) => eventRouter.route(e, appManager.currentApp));

appManager.onLaunch = (AppClass) => {
  const app = new AppClass();
  app.attach(appManager);
  app.init();
  appManager.currentApp = app;
  return app;
};

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